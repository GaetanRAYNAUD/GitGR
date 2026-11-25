// État du graphe de chaque dépôt ouvert : historique chargé par pages, refs,
// commit sélectionné, détails et diff affichés.

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import { rangeShas } from "../lib/multiSelect";
import type { Commit, CommitDetails, FileChange, FileDiff, RefsInfo } from "../lib/types";

/** Taille d'une page d'historique. */
export const PAGE_SIZE = 1000;
/** Pseudo-SHA de la ligne « modifications en cours ». */
export const WIP = "WIP";
/** Nombre de détails de commit gardés en cache. */
const DETAILS_CACHE = 200;

export interface RepoGraph {
  commits: Commit[];
  refs: RefsInfo | null;
  /** Une page est en cours de chargement. */
  loading: boolean;
  /** Tout l'historique est chargé. */
  done: boolean;
  /** Échec du premier chargement : rien à montrer. */
  error?: string;
  /** Échec d'une page suivante : l'historique déjà chargé reste affiché. */
  pageError?: string;
  /** SHA sélectionné, `WIP`, ou rien. Avec une sélection multiple : le point de départ
   *  des plages (Maj+clic). */
  selected: string | null;
  /** Sélection multiple (Ctrl+clic, Maj+clic) : au moins deux commits, sinon vide. */
  picked: string[];
  /** Bout de la plage étendue au clavier (Maj+↑ / Maj+↓). */
  focus: string | null;
  /** Empreinte des refs au dernier chargement : si elle ne change pas, inutile de relire le log. */
  fingerprint: string;
}

export interface Loadable<T> {
  data?: T;
  error?: string;
}

export interface OpenDiff extends Loadable<FileDiff> {
  sha: string;
  file: FileChange;
  /** Diff cumulé de plusieurs commits : départ (un commit ou l'arbre vide), `sha` en est le bout. */
  base?: string;
}

interface GraphStore {
  graphs: Record<string, RepoGraph>;
  /** Clé `${path}\n${sha}`. */
  details: Record<string, Loadable<CommitDetails>>;
  diffs: Record<string, OpenDiff | undefined>;

  /** Relit les refs, et l'historique s'il a changé (ou n'est pas encore chargé). */
  refresh(path: string): Promise<void>;
  loadMore(path: string): Promise<void>;
  /** Nouvel essai après l'échec d'une page suivante. */
  retryMore(path: string): Promise<void>;
  select(path: string, sha: string | null): void;
  /** Ctrl+clic : ajoute ou retire un commit de la sélection. */
  togglePick(path: string, sha: string): void;
  /** Maj+clic (ou Maj+flèche) : la plage du graphe entre le point de départ et `sha`. */
  pickRange(path: string, sha: string): void;
  /** Charge les pages nécessaires jusqu'à trouver `sha`, puis le sélectionne. Faux si introuvable. */
  reveal(path: string, sha: string): Promise<boolean>;
  loadDetails(path: string, sha: string): Promise<void>;
  /** `base` : diff cumulé depuis ce commit (sélection multiple). */
  openDiff(path: string, sha: string, file: FileChange, base?: string): Promise<void>;
  closeDiff(path: string): void;
  /** Oublie tout ce qui concerne ce dépôt (onglet fermé). */
  drop(path: string): void;
}

const empty = (): RepoGraph => ({
  commits: [],
  refs: null,
  loading: false,
  done: false,
  selected: null,
  picked: [],
  focus: null,
  fingerprint: "",
});

/** Génération par dépôt : une page arrivée après un rechargement complet est ignorée. */
const generation: Record<string, number> = {};
/** Page en cours de chargement, avec la génération qui l'a demandée : après un
 *  rechargement complet, elle ne bloque plus la demande de la page suivante. */
const pending: Record<string, { gen: number; run: Promise<void> } | undefined> = {};

export const detailsKey = (path: string, sha: string) => `${path}\n${sha}`;

export function fingerprint(refs: RefsInfo): string {
  return JSON.stringify([refs.head, refs.headBranch, refs.refs.map((r) => [r.name, r.target])]);
}

export const useGraph = create<GraphStore>((set, get) => {
  const patch = (path: string, p: Partial<RepoGraph>) =>
    set((s) => ({ graphs: { ...s.graphs, [path]: { ...(s.graphs[path] ?? empty()), ...p } } }));

  return {
    graphs: {},
    details: {},
    diffs: {},

    async refresh(path) {
      let refs: RefsInfo;
      try {
        refs = await api.repoRefs(path);
      } catch (e) {
        patch(path, { error: errorCode(e), loading: false });
        return;
      }
      const fp = fingerprint(refs);
      const cur = get().graphs[path];
      if (cur && cur.fingerprint === fp && cur.commits.length > 0 && !cur.error) {
        // F5 réessaie aussi une page suivante en échec.
        patch(path, { refs, pageError: undefined });
        return;
      }
      const gen = (generation[path] ?? 0) + 1;
      generation[path] = gen;
      patch(path, { refs, loading: true, error: undefined, pageError: undefined });
      try {
        const commits = await api.repoLog(path, 0, PAGE_SIZE);
        if (generation[path] !== gen) return;
        const selected = get().graphs[path]?.selected ?? null;
        const keep = selected === WIP || (selected !== null && commits.some((c) => c.sha === selected));
        const known = new Set(commits.map((c) => c.sha));
        const picked = (get().graphs[path]?.picked ?? []).filter((s) => known.has(s));
        patch(path, {
          picked: picked.length > 1 ? picked : [],
          commits,
          loading: false,
          done: commits.length < PAGE_SIZE,
          fingerprint: fp,
          selected: keep ? selected : null,
        });
      } catch (e) {
        if (generation[path] === gen) patch(path, { loading: false, error: errorCode(e) });
      }
    },

    loadMore(path) {
      const g = get().graphs[path];
      if (!g || g.done || g.error || g.pageError) return Promise.resolve();
      const gen = generation[path];
      const inFlight = pending[path];
      if (inFlight && inFlight.gen === gen) return inFlight.run;
      // Affecté avant que le `finally` ne s'exécute (il y a toujours un `await` avant).
      let run!: Promise<void>;
      run = (async () => {
        patch(path, { loading: true });
        try {
          const page = await api.repoLog(path, g.commits.length, PAGE_SIZE);
          if (generation[path] !== gen) return;
          const cur = get().graphs[path];
          const seen = new Set(cur.commits.map((c) => c.sha));
          patch(path, {
            commits: [...cur.commits, ...page.filter((c) => !seen.has(c.sha))],
            loading: false,
            done: page.length < PAGE_SIZE,
          });
        } catch (e) {
          if (generation[path] === gen) patch(path, { loading: false, pageError: errorCode(e) });
        } finally {
          if (pending[path]?.run === run) pending[path] = undefined;
        }
      })();
      pending[path] = { gen, run };
      return run;
    },

    retryMore(path) {
      if (!get().graphs[path]?.pageError) return Promise.resolve();
      patch(path, { pageError: undefined });
      return get().loadMore(path);
    },

    select(path, sha) {
      patch(path, { selected: sha, picked: [], focus: null });
      if (get().diffs[path]) get().closeDiff(path);
      if (sha && sha !== WIP) get().loadDetails(path, sha);
    },

    togglePick(path, sha) {
      const g = get().graphs[path];
      if (!g || sha === WIP) return;
      const start = g.picked.length ? g.picked : g.selected && g.selected !== WIP ? [g.selected] : [];
      const next = start.includes(sha) ? start.filter((s) => s !== sha) : [...start, sha];
      if (next.length < 2) return get().select(path, next[0] ?? null);
      if (get().diffs[path]) get().closeDiff(path);
      // Le dernier ajouté devient le départ des plages.
      patch(path, { picked: next, selected: start.includes(sha) ? g.selected : sha, focus: null });
    },

    pickRange(path, sha) {
      const g = get().graphs[path];
      if (!g || sha === WIP) return;
      const anchor = g.selected && g.selected !== WIP ? g.selected : sha;
      const next = rangeShas(g.commits, anchor, sha);
      if (next.length < 2) return get().select(path, sha);
      if (get().diffs[path]) get().closeDiff(path);
      patch(path, { picked: next, selected: anchor, focus: sha });
    },

    async reveal(path, sha) {
      for (;;) {
        const g = get().graphs[path];
        if (!g) return false;
        if (g.commits.some((c) => c.sha === sha)) {
          get().select(path, sha);
          return true;
        }
        if (g.done || g.error || g.pageError) return false;
        const before = g.commits.length;
        await get().loadMore(path);
        if ((get().graphs[path]?.commits.length ?? 0) === before && !get().graphs[path]?.done) return false;
      }
    },

    async loadDetails(path, sha) {
      const key = detailsKey(path, sha);
      const hit = get().details[key];
      if (hit?.data) return;
      try {
        const data = await api.commitDetails(path, sha);
        set((s) => {
          const next = { ...s.details, [key]: { data } };
          const keys = Object.keys(next);
          for (const k of keys.slice(0, Math.max(0, keys.length - DETAILS_CACHE))) delete next[k];
          return { details: next };
        });
      } catch (e) {
        set((s) => ({ details: { ...s.details, [key]: { error: errorCode(e) } } }));
      }
    },

    async openDiff(path, sha, file, base) {
      const open: OpenDiff = { sha, file, base };
      set((s) => ({ diffs: { ...s.diffs, [path]: open } }));
      let next: OpenDiff;
      try {
        const data = base
          ? await api.rangeDiff(path, base, sha, file.path, file.oldPath)
          : await api.commitDiff(path, sha, file.path, file.oldPath);
        next = { sha, file, base, data };
      } catch (e) {
        next = { sha, file, base, error: errorCode(e) };
      }
      // Ignoré si un autre fichier a été ouvert (ou le diff fermé) entre-temps.
      if (get().diffs[path] === open) set((s) => ({ diffs: { ...s.diffs, [path]: next } }));
    },

    closeDiff(path) {
      set((s) => ({ diffs: { ...s.diffs, [path]: undefined } }));
    },

    drop(path) {
      generation[path] = (generation[path] ?? 0) + 1;
      set((s) => {
        const graphs = { ...s.graphs };
        delete graphs[path];
        const diffs = { ...s.diffs };
        delete diffs[path];
        const details = Object.fromEntries(Object.entries(s.details).filter(([k]) => !k.startsWith(`${path}\n`)));
        return { graphs, diffs, details };
      });
    },
  };
});
