// État global de l'interface (zustand).

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import type { GitInfo, RepoEntry, RepoSummary, RepoUi, Settings } from "../lib/types";
import { useGraph } from "./graph";
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
  settings: Settings;
  summaries: Record<string, SummaryState>;
  /** Préférences d'affichage par dépôt (absent = valeurs par défaut). */
  repoUi: Record<string, RepoUi>;
  /** Dernière erreur à afficher (code backend ou message). */
  error: string | null;

  init(): Promise<void>;
  recheckGit(): Promise<void>;
  openPath(path: string): Promise<void>;
  pickAndOpen(title: string): Promise<void>;
  activate(path: string | null): void;
  closeTab(path: string): void;
  cycleTab(delta: number): void;
  /** Déplace l'onglet `path` à la position `index` (bornée). */
  moveTab(path: string, index: number): void;
  forget(path: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  /** Change des tailles (`null` = retour à la valeur par défaut). Pendant un glisser,
   *  `persist: false` évite d'écrire l'état à chaque mouvement ; on enregistre au relâcher. */
  setLayout(patch: Record<string, number | null>, persist?: boolean): void;
  refreshSummary(path: string): Promise<void>;
  /** Résumé, graphe et copie de travail (F5, retour du focus). */
  refreshRepo(path: string): void;
  setRepoUi(path: string, ui: RepoUi): void;
  dismissError(): void;
}

function persistSession(tabs: string[], active: string | null) {
  api.setSession({ openTabs: tabs, active }).catch(() => {});
}

/** Dernière requête de résumé lancée par dépôt : une réponse plus ancienne qui
 *  arriverait après une plus récente est ignorée. */
const summaryRequest: Record<string, number> = {};

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  git: null,
  repos: [],
  tabs: [],
  active: null,
  settings: { theme: "system", language: "system" },
  summaries: {},
  repoUi: {},
  error: null,

  async init() {
    let state, git;
    try {
      [state, git] = await Promise.all([api.getState(), api.gitInfo()]);
    } catch (e) {
      // Ne jamais laisser une fenêtre vide : on démarre sur l'accueil avec l'erreur affichée.
      set({ ready: true, error: errorCode(e) });
      return;
    }
    const known = new Set(state.repos.map((r) => r.path));
    const tabs = state.session.openTabs.filter((p) => known.has(p));
    const active = state.session.active && tabs.includes(state.session.active) ? state.session.active : null;
    set({ ready: true, git, repos: state.repos, tabs, active, settings: state.settings, repoUi: state.repoUi ?? {} });
    if (active) get().refreshSummary(active);
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
      });
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

  activate(path) {
    set({ active: path });
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
    } catch (e) {
      apply({ loading: false, error: errorCode(e) });
    }
  },

  refreshRepo(path) {
    get().refreshSummary(path);
    useGraph.getState().refresh(path);
    useWork.getState().refresh(path);
  },

  setRepoUi(path, ui) {
    set((s) => ({ repoUi: { ...s.repoUi, [path]: ui } }));
    api.setRepoUi(path, ui).catch(() => {});
  },

  dismissError() {
    set({ error: null });
  },
}));

/** Couleur stable associée à un dépôt (pastille d'onglet, liste). */
export function repoColor(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return `var(--l${Math.abs(h) % 4})`;
}
