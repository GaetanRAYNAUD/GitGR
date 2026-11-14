// État du graphe de chaque dépôt ouvert : historique chargé par pages, refs,
// commit sélectionné, détails et diff affichés.

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
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
  error?: string;
  /** SHA sélectionné, `WIP`, ou rien. */
  selected: string | null;
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
}

interface GraphStore {
  graphs: Record<string, RepoGraph>;
  /** Clé `${path}\n${sha}`. */
  details: Record<string, Loadable<CommitDetails>>;
  diffs: Record<string, OpenDiff | undefined>;

  /** Relit les refs, et l'historique s'il a changé (ou n'est pas encore chargé). */
  refresh(path: string): Promise<void>;
  loadMore(path: string): Promise<void>;
  select(path: string, sha: string | null): void;
  /** Charge les pages nécessaires jusqu'à trouver `sha`, puis le sélectionne. Faux si introuvable. */
  reveal(path: string, sha: string): Promise<boolean>;
  loadDetails(path: string, sha: string): Promise<void>;
  openDiff(path: string, sha: string, file: FileChange): Promise<void>;
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
        patch(path, { refs });
        return;
      }
      const gen = (generation[path] ?? 0) + 1;
      generation[path] = gen;
      patch(path, { refs, loading: true, error: undefined });
      try {
        const commits = await api.repoLog(path, 0, PAGE_SIZE);
        if (generation[path] !== gen) return;
        const selected = get().graphs[path]?.selected ?? null;
        const keep = selected === WIP || (selected !== null && commits.some((c) => c.sha === selected));
        patch(path, {
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
      if (!g || g.done || g.error) return Promise.resolve();
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
          if (generation[path] === gen) patch(path, { loading: false, error: errorCode(e) });
        } finally {
          if (pending[path]?.run === run) pending[path] = undefined;
        }
      })();
      pending[path] = { gen, run };
      return run;
    },

    select(path, sha) {
      patch(path, { selected: sha });
      if (get().diffs[path]) get().closeDiff(path);
      if (sha && sha !== WIP) get().loadDetails(path, sha);
    },

    async reveal(path, sha) {
      for (;;) {
        const g = get().graphs[path];
        if (!g) return false;
        if (g.commits.some((c) => c.sha === sha)) {
          get().select(path, sha);
          return true;
        }
        if (g.done || g.error) return false;
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

    async openDiff(path, sha, file) {
      const open: OpenDiff = { sha, file };
      set((s) => ({ diffs: { ...s.diffs, [path]: open } }));
      let next: OpenDiff;
      try {
        next = { sha, file, data: await api.commitDiff(path, sha, file.path, file.oldPath) };
      } catch (e) {
        next = { sha, file, error: errorCode(e) };
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
