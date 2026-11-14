// Façade unique vers le backend.
//
// Dans l'app Tauri, chaque appel passe par `invoke()` (Rust).
// Dans un simple navigateur (`npm run dev` sans Tauri), une implémentation
// factice en mémoire prend le relais : pratique pour travailler l'interface.

import { mockCommit, mockDetails, mockDiff, mockHeadMessage, mockHistory } from "./mockHistory";
import {
  mockChangeCount,
  mockCommitIndex,
  mockDiscard,
  mockDiscardAll,
  mockStage,
  mockStageAll,
  mockStageLines,
  mockStatus,
  mockWorkDiff,
} from "./mockWorktree";
import type {
  AppState,
  Commit,
  CommitDetails,
  DiffArea,
  FileDiff,
  GitInfo,
  LineRef,
  RefsInfo,
  RepoEntry,
  RepoSummary,
  RepoUi,
  Session,
  Settings,
  WorkStatus,
} from "./types";

export interface Api {
  gitInfo(): Promise<GitInfo>;
  getState(): Promise<AppState>;
  openRepo(path: string): Promise<RepoEntry>;
  forgetRepo(path: string): Promise<void>;
  setSession(session: Session): Promise<void>;
  setSettings(settings: Settings): Promise<void>;
  setRepoUi(path: string, ui: RepoUi): Promise<void>;
  repoSummary(path: string): Promise<RepoSummary>;
  /** Une page de l'historique (toutes refs, enfants avant parents). */
  repoLog(path: string, skip: number, limit: number): Promise<Commit[]>;
  repoRefs(path: string): Promise<RefsInfo>;
  commitDetails(path: string, sha: string): Promise<CommitDetails>;
  /** Diff d'un fichier d'un commit par rapport à son premier parent. */
  commitDiff(path: string, sha: string, file: string, oldFile: string | null): Promise<FileDiff>;
  // Copie de travail
  workStatus(path: string): Promise<WorkStatus>;
  workDiff(path: string, file: string, oldFile: string | null, area: DiffArea): Promise<FileDiff>;
  stageFiles(path: string, files: string[]): Promise<void>;
  unstageFiles(path: string, files: string[]): Promise<void>;
  stageAll(path: string): Promise<void>;
  unstageAll(path: string): Promise<void>;
  /** Abandonne les modifications non indexées ; les fichiers non suivis sont supprimés. */
  discardFiles(path: string, tracked: string[], untracked: string[]): Promise<void>;
  discardAll(path: string): Promise<void>;
  stashAll(path: string, message: string): Promise<void>;
  /** Indexe (ou retire de l'index si `unstage`) des lignes ; `fingerprint` = celle du diff affiché. */
  stageLines(path: string, file: string, oldFile: string | null, lines: LineRef[], fingerprint: string, unstage: boolean): Promise<void>;
  discardLines(path: string, file: string, lines: LineRef[], fingerprint: string): Promise<void>;
  /** Renvoie le SHA du commit créé. */
  commit(path: string, message: string, amend: boolean): Promise<string>;
  headMessage(path: string): Promise<string>;
  /** Ouvre un sélecteur de dossier ; `null` si annulé. */
  pickFolder(title: string): Promise<string | null>;
  openUrl(url: string): Promise<void>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

async function currentWindow() {
  const w = await import("@tauri-apps/api/window");
  return w.getCurrentWindow();
}

const tauriApi: Api = {
  gitInfo: () => invoke("git_info"),
  getState: () => invoke("get_state"),
  openRepo: (path) => invoke("open_repo", { path }),
  forgetRepo: (path) => invoke("forget_repo", { path }),
  setSession: (session) => invoke("set_session", { session }),
  setSettings: (settings) => invoke("set_settings", { settings }),
  setRepoUi: (path, ui) => invoke("set_repo_ui", { path, ui }),
  repoSummary: (path) => invoke("repo_summary", { path }),
  repoLog: (path, skip, limit) => invoke("repo_log", { path, skip, limit }),
  repoRefs: (path) => invoke("repo_refs", { path }),
  commitDetails: (path, sha) => invoke("commit_details", { path, sha }),
  commitDiff: (path, sha, file, oldFile) => invoke("commit_diff", { path, sha, file, oldFile }),
  workStatus: (path) => invoke("work_status", { path }),
  workDiff: (path, file, oldFile, area) => invoke("work_diff", { path, file, oldFile, area }),
  stageFiles: (path, files) => invoke("stage_files", { path, files }),
  unstageFiles: (path, files) => invoke("unstage_files", { path, files }),
  stageAll: (path) => invoke("stage_all", { path }),
  unstageAll: (path) => invoke("unstage_all", { path }),
  discardFiles: (path, tracked, untracked) => invoke("discard_files", { path, tracked, untracked }),
  discardAll: (path) => invoke("discard_all", { path }),
  stashAll: (path, message) => invoke("stash_all", { path, message }),
  stageLines: (path, file, oldFile, lines, fingerprint, unstage) =>
    invoke("stage_lines", { path, file, oldFile, lines, fingerprint, unstage }),
  discardLines: (path, file, lines, fingerprint) => invoke("discard_lines", { path, file, lines, fingerprint }),
  commit: (path, message, amend) => invoke("commit", { path, message, amend }),
  headMessage: (path) => invoke("head_message", { path }),
  async pickFolder(title) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false, title });
    return typeof res === "string" ? res : null;
  },
  async openUrl(url) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  window: {
    minimize: async () => (await currentWindow()).minimize(),
    toggleMaximize: async () => (await currentWindow()).toggleMaximize(),
    close: async () => (await currentWindow()).close(),
  },
};

// ---------------------------------------------------------------------------
// Implémentation factice (navigateur uniquement)
// ---------------------------------------------------------------------------

const MOCK_KEY = "gitgr.mock-state";
const MOCK_FOLDERS = [
  "C:/Users/demo/Projects/GitGR",
  "C:/Users/demo/work/api-backend",
  "C:/Users/demo/dotfiles",
  "C:/Users/demo/Documents/pas-un-depot",
];
let mockPick = 0;

function mockLoad(): AppState {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    /* stockage indisponible : état vide */
  }
  return { repos: [], session: { openTabs: [], active: null }, settings: { theme: "system", language: "system" } };
}

function mockSave(s: AppState) {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(s));
  } catch {
    /* ignoré */
  }
}

/** Petite latence simulée, pour voir les états de chargement. */
const mockDelay = () => new Promise((r) => setTimeout(r, 30));

const mockApi: Api = {
  gitInfo: async () => ({ found: true, version: "2.45.1 (simulé)" }),
  getState: async () => mockLoad(),
  async openRepo(path) {
    if (path.includes("pas-un-depot")) throw "not_a_repo";
    const s = mockLoad();
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    const entry: RepoEntry = { path, name, lastOpened: Date.now() };
    s.repos = [entry, ...s.repos.filter((r) => r.path !== path)];
    mockSave(s);
    return entry;
  },
  async forgetRepo(path) {
    const s = mockLoad();
    s.repos = s.repos.filter((r) => r.path !== path);
    s.session.openTabs = s.session.openTabs.filter((p) => p !== path);
    if (s.repoUi) delete s.repoUi[path];
    if (s.session.active === path) s.session.active = null;
    mockSave(s);
  },
  async setSession(session) {
    mockSave({ ...mockLoad(), session });
  },
  async setSettings(settings) {
    mockSave({ ...mockLoad(), settings });
  },
  async setRepoUi(path, ui) {
    const s = mockLoad();
    mockSave({ ...s, repoUi: { ...s.repoUi, [path]: ui } });
  },
  async repoSummary(path) {
    const { refs } = mockHistory(path);
    return {
      branch: refs.headBranch,
      head: refs.head,
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      changes: mockChangeCount(path),
      remoteUrl: "git@gitlab.exemple.fr:demo/" + (path.split("/").pop() ?? "repo") + ".git",
    };
  },
  async repoLog(path, skip, limit) {
    await mockDelay();
    return mockHistory(path).commits.slice(skip, skip + limit);
  },
  async repoRefs(path) {
    return mockHistory(path).refs;
  },
  async commitDetails(path, sha) {
    await mockDelay();
    return mockDetails(path, sha);
  },
  async commitDiff(_path, sha, file) {
    await mockDelay();
    return mockDiff(sha, file);
  },
  async workStatus(path) {
    return mockStatus(path);
  },
  async workDiff(path, file, _oldFile, area) {
    await mockDelay();
    return mockWorkDiff(path, file, area);
  },
  async stageFiles(path, files) {
    mockStage(path, files, false);
  },
  async unstageFiles(path, files) {
    mockStage(path, files, true);
  },
  async stageAll(path) {
    mockStageAll(path, false);
  },
  async unstageAll(path) {
    mockStageAll(path, true);
  },
  async discardFiles(path, tracked, untracked) {
    mockDiscard(path, [...tracked, ...untracked]);
  },
  async discardAll(path) {
    mockDiscardAll(path);
  },
  async stashAll(path) {
    mockDiscardAll(path);
  },
  async stageLines(path, file, _oldFile, lines, _fingerprint, unstage) {
    mockStageLines(path, file, lines, unstage);
  },
  async discardLines(path, file, lines) {
    mockDiscard(path, [file], lines);
  },
  async commit(path, message, amend) {
    if (!message.trim()) throw "empty_message";
    if (!mockCommitIndex(path, amend)) throw "nothing_to_commit";
    return mockCommit(path, message, amend);
  },
  async headMessage(path) {
    return mockHeadMessage(path);
  },
  async pickFolder() {
    const p = MOCK_FOLDERS[mockPick % MOCK_FOLDERS.length];
    mockPick += 1;
    return p;
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener");
  },
  window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {} },
};

export const api: Api = inTauri ? tauriApi : mockApi;

/** Normalise une erreur reçue du backend (string ou Error) en code/message. */
export function errorCode(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
