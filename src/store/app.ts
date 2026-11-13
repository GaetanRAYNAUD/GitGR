// État global de l'interface (zustand).

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import type { GitInfo, RepoEntry, RepoSummary, Settings } from "../lib/types";

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
  /** Dernière erreur à afficher (code backend ou message). */
  error: string | null;

  init(): Promise<void>;
  recheckGit(): Promise<void>;
  openPath(path: string): Promise<void>;
  pickAndOpen(title: string): Promise<void>;
  activate(path: string | null): void;
  closeTab(path: string): void;
  cycleTab(delta: number): void;
  forget(path: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  refreshSummary(path: string): Promise<void>;
  dismissError(): void;
}

function persistSession(tabs: string[], active: string | null) {
  api.setSession({ openTabs: tabs, active }).catch(() => {});
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  git: null,
  repos: [],
  tabs: [],
  active: null,
  settings: { theme: "system", language: "system" },
  summaries: {},
  error: null,

  async init() {
    const [state, git] = await Promise.all([api.getState(), api.gitInfo()]);
    const known = new Set(state.repos.map((r) => r.path));
    const tabs = state.session.openTabs.filter((p) => known.has(p));
    const active = state.session.active && tabs.includes(state.session.active) ? state.session.active : null;
    set({ ready: true, git, repos: state.repos, tabs, active, settings: state.settings });
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
    const path = await api.pickFolder(title);
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
  },

  cycleTab(delta) {
    // L'accueil (null) fait partie du cycle, en dernière position.
    const { tabs, active } = get();
    const ring: (string | null)[] = [...tabs, null];
    const i = ring.indexOf(active);
    get().activate(ring[(i + delta + ring.length) % ring.length]);
  },

  async forget(path) {
    await api.forgetRepo(path);
    const { repos, tabs, active } = get();
    const nextTabs = tabs.filter((p) => p !== path);
    set({
      repos: repos.filter((r) => r.path !== path),
      tabs: nextTabs,
      active: active === path ? null : active,
    });
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    api.setSettings(settings).catch(() => {});
  },

  async refreshSummary(path) {
    set((s) => ({ summaries: { ...s.summaries, [path]: { ...s.summaries[path], loading: true } } }));
    try {
      const data = await api.repoSummary(path);
      set((s) => ({ summaries: { ...s.summaries, [path]: { loading: false, data } } }));
    } catch (e) {
      set((s) => ({ summaries: { ...s.summaries, [path]: { loading: false, error: errorCode(e) } } }));
    }
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
