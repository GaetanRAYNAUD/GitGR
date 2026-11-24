// État global de l'interface (zustand).

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import { colorCss } from "../lib/colors";
import type { ColorValue, GitInfo, RepoEntry, RepoSummary, RepoUi, Settings } from "../lib/types";
import { useGraph } from "./graph";
import { useProfiles } from "./profiles";
import { useWork } from "./worktree";

export interface SummaryState {
  loading: boolean;
  data?: RepoSummary;
  error?: string;
}

interface AppStore {
  ready: boolean;
  git: GitInfo | null;
  repos: RepoEntry[];
  /** Chemins des dépôts ouverts en onglets. */
  tabs: string[];
  /** Onglet actif ; `null` = écran d'accueil. */
  active: string | null;
  /** Page des paramètres affichée (par-dessus l'onglet actif). */
  settingsOpen: boolean;
  settings: Settings;
  summaries: Record<string, SummaryState>;
  /** Préférences d'affichage par dépôt (absent = valeurs par défaut). */
  repoUi: Record<string, RepoUi>;
  /** Dernière erreur à afficher (code backend ou message). */
  error: string | null;
  /** Message d'information ; `sticky` : reste affiché jusqu'à ce qu'on le ferme. */
  notice: { text: string; sticky: boolean; id: number; actions?: NoticeAction[] } | null;

  init(): Promise<void>;
  recheckGit(): Promise<void>;
  openPath(path: string): Promise<void>;
  pickAndOpen(title: string): Promise<void>;
  activate(path: string | null): void;
  openSettings(): void;
  closeSettings(): void;
  closeTab(path: string): void;
  cycleTab(delta: number): void;
  /** Déplace l'onglet `path` à la position `index` (bornée). */
  moveTab(path: string, index: number): void;
  forget(path: string): Promise<void>;
  /** Nom affiché d'un dépôt (vide / `null` = nom du dossier). */
  rename(path: string, alias: string | null): void;
  /** Couleur de la pastille d'onglet (`null` = automatique). */
  setRepoColor(path: string, color: ColorValue | null): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Change des tailles (`null` = retour à la valeur par défaut). Pendant un glisser,
   *  `persist: false` évite d'écrire l'état à chaque mouvement ; on enregistre au relâcher. */
  setLayout(patch: Record<string, number | null>, persist?: boolean): void;
  refreshSummary(path: string): Promise<void>;
  /** Résumé, graphe puis copie de travail (F5, retour du focus, modification sur disque).
   *  Un appel pendant un rafraîchissement en cours en relance un seul à la fin. */
  refreshRepo(path: string): Promise<void>;
  setRepoUi(path: string, ui: RepoUi): void;
  dismissError(): void;
  /** `actions` : boutons du message (Ouvrir, Copier le lien…) ; il reste alors affiché plus longtemps. */
  notify(text: string, sticky?: boolean, actions?: NoticeAction[]): void;
  dismissNotice(): void;
}

let noticeSeq = 0;

/** Bouton d'un message : un clic lance l'action ; keep le laisse ouvert (Copier le lien). */
export interface NoticeAction {
  label: string;
  onClick: () => void;
  keep?: boolean;
}

function persistSession(tabs: string[], active: string | null) {
  api.setSession({ openTabs: tabs, active }).catch(() => {});
}

/** Dernière requête de résumé lancée par dépôt : une réponse plus ancienne qui
 *  arriverait après une plus récente est ignorée. */
const summaryRequest: Record<string, number> = {};

/** Rafraîchissement complet en cours par dépôt ; `again` : redemandé entre-temps. */
const repoRefresh: Record<string, { again: boolean; done: Promise<void> }> = {};

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  git: null,
  repos: [],
  tabs: [],
  settingsOpen: false,
  active: null,
  settings: { theme: "system", language: "system" },
  summaries: {},
  repoUi: {},
  error: null,
  notice: null,

  async init() {
    let state, git, home;
    try {
      [state, git, home] = await Promise.all([api.getState(), api.gitInfo(), api.homeDir().catch(() => null)]);
    } catch (e) {
      // Ne jamais laisser une fenêtre vide : on démarre sur l'accueil avec l'erreur affichée.
      set({ ready: true, error: errorCode(e) });
      return;
    }
    const known = new Set(state.repos.map((r) => r.path));
    const tabs = state.session.openTabs.filter((p) => known.has(p));
    const active = state.session.active && tabs.includes(state.session.active) ? state.session.active : null;
    useProfiles.getState().load(state, home);
    set({ ready: true, git, repos: state.repos, tabs, active, settings: state.settings, repoUi: state.repoUi ?? {} });
    // Tous les onglets : leur indicateur de travail en attente (barre d'onglets) en dépend.
    for (const p of tabs) get().refreshSummary(p);
  },

  async recheckGit() {
    set({ git: await api.gitInfo() });
  },

  async openPath(path) {
    try {
      const entry = await api.openRepo(path);
      const { repos, tabs } = get();
      const nextTabs = tabs.includes(entry.path) ? tabs : [...tabs, entry.path];
      set({
        repos: [entry, ...repos.filter((r) => r.path !== entry.path)],
        tabs: nextTabs,
        active: entry.path,
        error: null,
        settingsOpen: false,
      });
      useProfiles.getState().closePage();
      persistSession(nextTabs, entry.path);
      get().refreshSummary(entry.path);
    } catch (e) {
      set({ error: errorCode(e) });
    }
  },

  async pickAndOpen(title) {
    let path: string | null;
    try {
      path = await api.pickFolder(title);
    } catch (e) {
      set({ error: errorCode(e) });
      return;
    }
    if (path) await get().openPath(path);
  },

  openSettings() {
    useProfiles.getState().closePage();
    set({ settingsOpen: true });
  },

  closeSettings() {
    set({ settingsOpen: false });
  },

  activate(path) {
    set({ active: path, settingsOpen: false });
    useProfiles.getState().closePage();
    persistSession(get().tabs, path);
    if (path) get().refreshSummary(path);
  },

  closeTab(path) {
    const { tabs, active } = get();
    const idx = tabs.indexOf(path);
    if (idx < 0) return;
    const nextTabs = tabs.filter((p) => p !== path);
    let nextActive = active;
    if (active === path) nextActive = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
    set({ tabs: nextTabs, active: nextActive });
    persistSession(nextTabs, nextActive);
    useGraph.getState().drop(path);
    useWork.getState().drop(path);
  },

  cycleTab(delta) {
    // L'accueil (null) fait partie du cycle, en dernière position.
    const { tabs, active } = get();
    const ring: (string | null)[] = [...tabs, null];
    const i = ring.indexOf(active);
    get().activate(ring[(i + delta + ring.length) % ring.length]);
  },

  moveTab(path, index) {
    const { tabs, active } = get();
    const from = tabs.indexOf(path);
    const to = Math.max(0, Math.min(index, tabs.length - 1));
    if (from < 0 || from === to) return;
    const next = [...tabs];
    next.splice(from, 1);
    next.splice(to, 0, path);
    set({ tabs: next });
    persistSession(next, active);
  },

  async forget(path) {
    try {
      await api.forgetRepo(path);
    } catch (e) {
      set({ error: errorCode(e) });
      return;
    }
    const { repos, tabs, active, repoUi } = get();
    const nextTabs = tabs.filter((p) => p !== path);
    const nextUi = { ...repoUi };
    delete nextUi[path];
    set({
      repos: repos.filter((r) => r.path !== path),
      tabs: nextTabs,
      active: active === path ? null : active,
      repoUi: nextUi,
    });
    useGraph.getState().drop(path);
    useWork.getState().drop(path);
    useProfiles.getState().forget(path);
  },

  rename(path, alias) {
    const a = alias?.trim() || undefined;
    patchRepo(set, get, path, { alias: a }, () => api.renameRepo(path, a ?? null));
  },

  setRepoColor(path, color) {
    patchRepo(set, get, path, { color: color ?? undefined }, () => api.setRepoColor(path, color));
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    api.setSettings(settings).catch(() => {});
  },

  setLayout(patch, persist = true) {
    const layout = { ...get().settings.layout };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete layout[k];
      // NaN / Infinity deviendraient `null` en JSON et feraient échouer l'enregistrement côté Rust.
      else if (Number.isFinite(v)) layout[k] = Math.round(v * 1000) / 1000;
    }
    const settings = { ...get().settings, layout };
    set({ settings });
    if (persist) api.setSettings(settings).catch(() => {});
  },

  async refreshSummary(path) {
    const req = (summaryRequest[path] ?? 0) + 1;
    summaryRequest[path] = req;
    const apply = (next: SummaryState) => {
      if (summaryRequest[path] !== req) return; // une requête plus récente a été lancée
      set((s) => ({ summaries: { ...s.summaries, [path]: next } }));
    };
    set((s) => ({ summaries: { ...s.summaries, [path]: { ...s.summaries[path], loading: true } } }));
    try {
      apply({ loading: false, data: await api.repoSummary(path) });
      // Le remote est connu : profil choisi d'après les règles si le dépôt n'en a pas.
      if (summaryRequest[path] === req) useProfiles.getState().autoSelect(path);
    } catch (e) {
      apply({ loading: false, error: errorCode(e) });
    }
  },

  refreshRepo(path) {
    const running = repoRefresh[path];
    if (running) {
      running.again = true;
      return running.done;
    }
    const run = { again: false, done: Promise.resolve() };
    repoRefresh[path] = run;
    run.done = (async () => {
      try {
        do {
          run.again = false;
          get().refreshSummary(path);
          // Les refs avant l'état de la copie de travail : lus en parallèle, un commit fait
          // ailleurs entre les deux lectures donnait le nouveau commit dans le graphe ET ses
          // fichiers encore « en cours ». Dans cet ordre, l'état est toujours au moins aussi
          // récent que le graphe (et la vue sélectionne le nouveau HEAD, cf. worktree.after).
          await useGraph.getState().refresh(path);
          await useWork.getState().refresh(path);
          await useWork.getState().reloadDiff(path);
        } while (run.again);
      } finally {
        delete repoRefresh[path];
      }
    })();
    return run.done;
  },

  setRepoUi(path, ui) {
    set((s) => ({ repoUi: { ...s.repoUi, [path]: ui } }));
    api.setRepoUi(path, ui).catch(() => {});
  },

  dismissError() {
    set({ error: null });
  },

  notify(text, sticky = false, actions) {
    set({ notice: { text, sticky, id: ++noticeSeq, actions } });
  },

  dismissNotice() {
    set({ notice: null });
  },
}));

/** Change une entrée de dépôt tout de suite, l'enregistre, et revient en arrière si
 *  l'enregistrement échoue (l'interface ne montre pas un nom ou une couleur perdus). */
function patchRepo(
  set: (p: Partial<AppStore>) => void,
  get: () => AppStore,
  path: string,
  patch: Pick<RepoEntry, "alias" | "color">,
  save: () => Promise<void>,
) {
  const before = get().repos.find((r) => r.path === path);
  if (!before) return;
  const swap = (entry: RepoEntry) => set({ repos: get().repos.map((r) => (r.path === path ? entry : r)) });
  swap({ ...before, ...patch });
  save().catch((e) => {
    swap(before);
    set({ error: errorCode(e) });
  });
}

/** Nom affiché d'un dépôt : celui choisi dans l'app, sinon le nom du dossier. */
export function repoName(r: RepoEntry): string {
  return r.alias || r.name;
}

/** Couleur d'un dépôt (pastille d'onglet, liste) : celle choisie, sinon une couleur stable
 *  tirée du chemin. */
export function repoColor(path: string, color?: ColorValue): string {
  if (color !== undefined) return colorCss(color);
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return `var(--l${Math.abs(h) % 4})`;
}
