// Façade unique vers le backend.
//
// Dans l'app Tauri, chaque appel passe par `invoke()` (Rust).
// Dans un simple navigateur (`npm run dev` sans Tauri), une implémentation
// factice en mémoire prend le relais : pratique pour travailler l'interface.

import {
  mockAddRemote,
  mockRemoveRemote,
  mockRenameRemote,
  mockSetRemoteUrl,
  mockCheckout,
  mockCheckoutDetached,
  mockCheckoutRemote,
  mockCreateBranch,
  mockDeleteBranch,
  mockDeleteRemoteBranch,
  mockPull,
  mockPullFrom,
  mockPush,
  mockRenameBranch,
  mockAutostash,
  mockStashCount,
  mockStashPop,
  mockStashPush,
} from "./mockBranches";
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
import { joinPath, validFolderName } from "./clone";
import { instance, withAccount } from "./providers";
import type {
  Account,
  AccountKey,
  AccountKeyKind,
  AppState,
  CloneProgress,
  DevicePollResult,
  DeviceStart,
  Commit,
  ColorValue,
  CommitDetails,
  DiffArea,
  FileDiff,
  GitInfo,
  GpgKey,
  LineRef,
  NewPull,
  OpResult,
  Profile,
  ProviderKind,
  Pull,
  PullDraft,
  PullStrategy,
  ProviderRepo,
  RefsInfo,
  RepoList,
  RepoEntry,
  RepoProfiles,
  RepoSummary,
  RepoUi,
  Session,
  Settings,
  SshKeyInfo,
  WorkStatus,
} from "./types";

export interface Api {
  gitInfo(): Promise<GitInfo>;
  getState(): Promise<AppState>;
  openRepo(path: string): Promise<RepoEntry>;
  forgetRepo(path: string): Promise<void>;
  /** Nom affiché (vide / `null` = nom du dossier). */
  renameRepo(path: string, alias: string | null): Promise<void>;
  /** Couleur de la pastille d'onglet (`null` = automatique). */
  setRepoColor(path: string, color: ColorValue | null): Promise<void>;
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
  // Branches et réseau. `autoStash` : modifications mises de côté puis réappliquées.
  checkout(path: string, branch: string, autoStash: boolean): Promise<OpResult>;
  /** Passe sur la branche locale qui suit `branch` (`origin/x`), créée au besoin ; renvoie aussi son nom. */
  checkoutRemote(path: string, branch: string, autoStash: boolean): Promise<[OpResult, string]>;
  checkoutDetached(path: string, sha: string, autoStash: boolean): Promise<OpResult>;
  /** `start` : SHA ou nom de ref (`null` : HEAD). */
  createBranch(path: string, name: string, start: string | null, checkout: boolean, autoStash: boolean): Promise<OpResult>;
  renameBranch(path: string, oldName: string, newName: string): Promise<void>;
  deleteBranch(path: string, branch: string, force: boolean): Promise<void>;
  deleteRemoteBranch(path: string, branch: string): Promise<void>;
  fetch(path: string): Promise<void>;
  pull(path: string, strategy: PullStrategy, autoStash: boolean): Promise<OpResult>;
  /** Tire la branche `branch` du remote `remote` dans la branche courante. */
  pullFrom(path: string, remote: string, branch: string, strategy: PullStrategy, autoStash: boolean): Promise<OpResult>;
  /** Sans branche distante, la crée et la suit ; `force` : `--force-with-lease`. `remote` :
   *  destination choisie (`null` : celle de la branche suivie, sinon `origin`). */
  push(path: string, force: boolean, remote: string | null): Promise<void>;
  // Remotes
  addRemote(path: string, name: string, url: string): Promise<void>;
  renameRemote(path: string, oldName: string, newName: string): Promise<void>;
  /** Nouvelle URL (fetch, et push si le remote n'a pas d'URL de push à part). */
  setRemoteUrl(path: string, name: string, url: string): Promise<void>;
  /** Supprime le remote, ses branches distantes et le suivi des branches locales. */
  removeRemote(path: string, name: string): Promise<void>;
  stashPop(path: string): Promise<OpResult>;
  abortOperation(path: string): Promise<void>;
  continueOperation(path: string): Promise<OpResult>;
  /** Surveille ce dépôt sur disque (un seul à la fois ; `null` : aucun). */
  watchRepo(path: string | null): Promise<void>;
  /** Appelé quand le dépôt surveillé change sur disque ; renvoie de quoi se désabonner. */
  onRepoChanged(cb: (path: string) => void): Promise<() => void>;
  // Profils
  /** Remplace la liste des profils ; renvoie les profils des dépôts (ceux supprimés retirés). */
  setProfiles(profiles: Profile[]): Promise<Record<string, RepoProfiles>>;
  setRepoProfiles(path: string, profiles: RepoProfiles): Promise<void>;
  /** Dossier personnel (avec des `/`), `null` s'il est inconnu. */
  homeDir(): Promise<string | null>;
  sshKeyInfo(path: string): Promise<SshKeyInfo>;
  /** Clé ed25519 sans phrase de passe ; refuse d'écraser un fichier (`key_exists`). */
  generateSshKey(path: string, comment: string, passphrase: string | null): Promise<SshKeyInfo>;
  /** Vérifie puis range la phrase de passe dans le trousseau du système (`null` : l'oublie). */
  setKeyPassphrase(path: string, passphrase: string | null): Promise<SshKeyInfo>;
  /** Écrit l'identité et la signature du profil actif dans `.git/config` du dépôt. */
  applyIdentity(path: string): Promise<void>;
  /** Clés GPG secrètes de l'utilisateur. */
  gpgKeys(): Promise<GpgKey[]>;
  // Comptes providers
  /** Vérifie le token auprès de l'instance (`url` vide : github.com / gitlab.com), le range dans
   *  le trousseau et lie le compte au profil (à la place de celui de la même instance). */
  connectAccount(profile: string, kind: ProviderKind, url: string, token: string): Promise<Account>;
  /** Retire le compte du profil ; son token est oublié si aucun autre profil ne le porte. */
  disconnectAccount(profile: string, account: string): Promise<void>;
  /** Le token enregistré est-il toujours valable ? (`token_missing`, `token_invalid`…) */
  checkAccount(account: string): Promise<Account>;
  /** Connexion OAuth à github.com (device flow) : code à saisir sur GitHub. */
  githubDeviceStart(): Promise<DeviceStart>;
  /** Le token est-il prêt ? Une fois donné, le compte est lié au profil. Rejette avec
   *  `device_expired` / `device_denied`. */
  githubDevicePoll(profile: string, flowId: number): Promise<DevicePollResult>;
  githubDeviceCancel(flowId: number): Promise<void>;
  /** Avatar (data URL) d'un propriétaire de dépôt sur une instance ; `null` s'il n'en a pas.
   *  `account` : compte dont le token est joint (seulement s'il est de cette instance). */
  ownerAvatar(kind: ProviderKind, url: string, owner: string, account: string | null): Promise<string | null>;
  /** Avatars des auteurs (adresse en minuscules → data URL, ou `null`). `kind` / `url` / `repo`
   *  (`propriétaire/nom`) : provider et dépôt du remote `origin`, s'il est connu. */
  authorAvatars(kind: ProviderKind | null, url: string | null, repo: string | null, account: string | null, emails: string[]): Promise<Record<string, string | null>>;
  /** Dépôts accessibles au compte (les siens, ceux de ses organisations / groupes…). */
  listAccountRepos(account: string): Promise<RepoList>;
  /** Clés du profil (enregistré) et leur présence sur le compte. */
  accountKeys(profile: string, account: string): Promise<AccountKey[]>;
  /** Ajoute au compte la clé `kind` du profil. */
  addAccountKey(profile: string, account: string, kind: AccountKeyKind): Promise<void>;
  // Pull requests / merge requests
  /** Commits de `source` absents de `target` (refs locales) et modèle de PR / MR du dépôt. */
  pullDraft(path: string, source: string, target: string, kind: ProviderKind | null): Promise<PullDraft>;
  /** Branche par défaut du dépôt `repo` (`propriétaire/nom`), avec le token du compte. */
  remoteDefaultBranch(kind: ProviderKind, url: string, repo: string, account: string | null): Promise<string>;
  /** Crée la PR / MR, ou renvoie celle qui existe déjà pour ces branches (`existing`). */
  createPull(kind: ProviderKind, url: string, account: string | null, request: NewPull): Promise<Pull>;
  // Clone
  /** Clone `url` dans `parent/name` avec la clé SSH du profil `profile` (`null` : configuration
   *  ssh habituelle) ; renvoie la racine du nouveau dépôt. Un seul clone à la fois. */
  cloneRepo(url: string, parent: string, name: string, profile: string | null): Promise<string>;
  /** Arrête le clone en cours : il échoue avec `clone_cancelled`. */
  cancelClone(): Promise<void>;
  /** Avancement du clone en cours ; renvoie de quoi se désabonner. */
  onCloneProgress(cb: (p: CloneProgress) => void): Promise<() => void>;
  /** Ouvre un sélecteur de dossier ; `null` si annulé. */
  pickFolder(title: string): Promise<string | null>;
  /** Ouvre un sélecteur de fichier (dans `dir` si donné) ; `null` si annulé. */
  pickFile(title: string, dir?: string | null): Promise<string | null>;
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
  renameRepo: (path, alias) => invoke("rename_repo", { path, alias }),
  setRepoColor: (path, color) => invoke("set_repo_color", { path, color }),
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
  checkout: (path, branch, autoStash) => invoke("checkout", { path, branch, autoStash }),
  checkoutRemote: (path, branch, autoStash) => invoke("checkout_remote", { path, branch, autoStash }),
  checkoutDetached: (path, sha, autoStash) => invoke("checkout_detached", { path, sha, autoStash }),
  createBranch: (path, name, start, checkout, autoStash) => invoke("create_branch", { path, name, start, checkout, autoStash }),
  renameBranch: (path, oldName, newName) => invoke("rename_branch", { path, old: oldName, new: newName }),
  deleteBranch: (path, branch, force) => invoke("delete_branch", { path, branch, force }),
  deleteRemoteBranch: (path, branch) => invoke("delete_remote_branch", { path, branch }),
  fetch: (path) => invoke("fetch", { path }),
  pull: (path, strategy, autoStash) => invoke("pull", { path, strategy, autoStash }),
  pullFrom: (path, remote, branch, strategy, autoStash) => invoke("pull_from", { path, remote, branch, strategy, autoStash }),
  push: (path, force, remote) => invoke("push", { path, force, remote }),
  addRemote: (path, name, url) => invoke("add_remote", { path, name, url }),
  renameRemote: (path, oldName, newName) => invoke("rename_remote", { path, old: oldName, new: newName }),
  setRemoteUrl: (path, name, url) => invoke("set_remote_url", { path, name, url }),
  removeRemote: (path, name) => invoke("remove_remote", { path, name }),
  stashPop: (path) => invoke("stash_pop", { path }),
  abortOperation: (path) => invoke("abort_operation", { path }),
  continueOperation: (path) => invoke("continue_operation", { path }),
  watchRepo: (path) => invoke("watch_repo", { path }),
  async onRepoChanged(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("repo-changed", (e) => cb(e.payload));
  },
  setProfiles: (profiles) => invoke("set_profiles", { profiles }),
  setRepoProfiles: (path, profiles) => invoke("set_repo_profiles", { path, profiles }),
  homeDir: () => invoke("home_dir"),
  sshKeyInfo: (path) => invoke("ssh_key_info", { path }),
  generateSshKey: (path, comment, passphrase) => invoke("generate_ssh_key", { path, comment, passphrase }),
  setKeyPassphrase: (path, passphrase) => invoke("set_key_passphrase", { path, passphrase }),
  applyIdentity: (path) => invoke("apply_identity", { path }),
  gpgKeys: () => invoke("gpg_keys"),
  connectAccount: (profile, kind, url, token) => invoke("connect_account", { profile, kind, url, token }),
  disconnectAccount: (profile, account) => invoke("disconnect_account", { profile, account }),
  checkAccount: (account) => invoke("check_account", { account }),
  listAccountRepos: (account) => invoke("list_account_repos", { account }),
  githubDeviceStart: () => invoke("github_device_start"),
  githubDevicePoll: (profile, flowId) => invoke("github_device_poll", { profile, flowId }),
  githubDeviceCancel: (flowId) => invoke("github_device_cancel", { flowId }),
  ownerAvatar: (kind, url, owner, account) => invoke("owner_avatar", { kind, url, owner, account }),
  authorAvatars: (kind, url, repo, account, emails) => invoke("author_avatars", { kind, url, repo, account, emails }),
  pullDraft: (path, source, target, kind) => invoke("pull_draft", { path, source, target, kind }),
  remoteDefaultBranch: (kind, url, repo, account) => invoke("remote_default_branch", { kind, url, repo, account }),
  createPull: (kind, url, account, request) => invoke("create_pull", { kind, url, account, request }),
  accountKeys: (profile, account) => invoke("account_keys", { profile, account }),
  addAccountKey: (profile, account, kind) => invoke("add_account_key", { profile, account, kind }),
  cloneRepo: (url, parent, name, profile) => invoke("clone_repo", { url, parent, name, profile }),
  cancelClone: () => invoke("cancel_clone"),
  async onCloneProgress(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<CloneProgress>("clone-progress", (e) => cb(e.payload));
  },
  async pickFolder(title) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false, title });
    return typeof res === "string" ? res : null;
  },
  async pickFile(title, dir) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: false, multiple: false, title, defaultPath: dir ?? undefined });
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

/** Backend simulé : abonnés à « dépôt modifié sur disque » (cf. `emitMockRepoChanged`). */
const mockRepoListeners = new Set<(path: string) => void>();

/** Simule une modification du dépôt faite en dehors de l'app (tests). */
export function emitMockRepoChanged(path: string) {
  for (const cb of mockRepoListeners) cb(path);
}

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

/** Backend simulé : clés générées (chemin → commentaire). `~/.ssh/id_ed25519` existe d'office,
 *  `…locked…` est protégée par une phrase de passe. */
const mockKeys = new Map<string, string>();
/** Clés générées avec une phrase de passe, et phrases rangées « dans le trousseau ». La phrase
 *  de passe des clés `…locked…` est `secret`. */
const mockLocked = new Map<string, string>();
const mockPassphrases = new Set<string>();

function mockKeyInfo(path: string): SshKeyInfo;
function mockKeyInfo(path: string, probe: true): SshKeyInfo | null;
function mockKeyInfo(path: string, probe = false): SshKeyInfo | null {
  const builtin = /[\\/]\.ssh[\\/](id_ed25519|locked_ed25519)$/.test(path);
  if (!mockKeys.has(path) && !builtin) {
    if (probe) return null;
    throw "key_not_found";
  }
  const comment = mockKeys.get(path) ?? "demo@exemple.fr";
  let h = 0;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) | 0;
  const fp = Math.abs(h).toString(36).padEnd(8, "x");
  return {
    kind: "ED25519",
    bits: 256,
    fingerprint: `SHA256:${fp}${fp}`,
    comment,
    publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${fp} ${comment}`,
    encrypted: path.includes("locked") || mockLocked.has(path),
    passphraseStored: mockPassphrases.has(path),
  };
}

/** Backend simulé : connexions GitHub en cours (identifiant → demandes déjà faites). */
let mockDeviceSeq = 0;
const mockDevicePolls = new Map<number, number>();

/** Backend simulé : clés ajoutées aux comptes (`compte|type|clé`). */
const mockAccountKeys = new Set<string>();
/** PR / MR créées par le backend simulé (lues par les tests e2e via `window`). */
const mockPulls: NewPull[] = [];
if (!inTauri && typeof window !== "undefined") (window as unknown as { __mockPulls: NewPull[] }).__mockPulls = mockPulls;

/** Backend simulé : abonnés à l'avancement du clone, et annulation demandée. */
const mockCloneListeners = new Set<(p: CloneProgress) => void>();
let mockCloneCancel: (() => void) | null = null;

/** Backend simulé : dépôts d'un compte. */
function mockAccountRepos(account: Account): ProviderRepo[] {
  const host = account.url.replace(/^https?:\/\//, "");
  const make = (fullName: string, extra: Partial<ProviderRepo> = {}): ProviderRepo => ({
    fullName,
    name: fullName.split("/").pop()!,
    description: null,
    private: false,
    fork: false,
    archived: false,
    httpUrl: `https://${host}/${fullName}.git`,
    sshUrl: `git@${host}:${fullName}.git`,
    updatedAt: "2026-11-10T09:00:00Z",
    ...extra,
  });
  const me = account.login;
  return [
    make(`${me}/dotfiles`, { description: "Mes fichiers de configuration" }),
    make(`${me}/site-perso`, { private: true }),
    make(`acme/api-backend`, { private: true, description: "Serveur de l'application" }),
    make(`acme/front`, { private: true }),
    make(`${me}/fork-outil`, { fork: true }),
    make(`acme/ancien-projet`, { archived: true }),
  ];
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
    const prev = s.repos.find((r) => r.path === path);
    const entry: RepoEntry = { path, name, lastOpened: Date.now(), alias: prev?.alias, color: prev?.color };
    s.repos = [entry, ...s.repos.filter((r) => r.path !== path)];
    mockSave(s);
    return entry;
  },
  async forgetRepo(path) {
    const s = mockLoad();
    s.repos = s.repos.filter((r) => r.path !== path);
    s.session.openTabs = s.session.openTabs.filter((p) => p !== path);
    if (s.repoUi) delete s.repoUi[path];
    if (s.repoProfiles) delete s.repoProfiles[path];
    if (s.session.active === path) s.session.active = null;
    mockSave(s);
  },
  async renameRepo(path, alias) {
    const s = mockLoad();
    const a = alias?.trim() || undefined;
    s.repos = s.repos.map((r) => (r.path === path ? { ...r, alias: a } : r));
    mockSave(s);
  },
  async setRepoColor(path, color) {
    const s = mockLoad();
    s.repos = s.repos.map((r) => (r.path === path ? { ...r, color: color ?? undefined } : r));
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
    const cur = refs.refs.find((r) => r.kind === "local" && r.short === refs.headBranch);
    return {
      branch: refs.headBranch,
      head: refs.head,
      upstream: cur?.upstream ?? null,
      ahead: cur?.ahead ?? 0,
      behind: cur?.behind ?? 0,
      changes: mockChangeCount(path),
      remoteUrl: refs.remotes.find((r) => r.name === "origin")?.url ?? null,
    };
  },
  async repoLog(path, skip, limit) {
    await mockDelay();
    return mockHistory(path).commits.slice(skip, skip + limit);
  },
  async repoRefs(path) {
    return { ...mockHistory(path).refs, stashes: mockStashCount(path), autostash: mockAutostash(path) };
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
  async stashAll(path, message) {
    mockStashPush(path, message);
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
  checkout: async (path, branch, autoStash) => mockCheckout(path, branch, autoStash),
  checkoutRemote: async (path, branch, autoStash) => mockCheckoutRemote(path, branch, autoStash),
  checkoutDetached: async (path, sha, autoStash) => mockCheckoutDetached(path, sha, autoStash),
  createBranch: async (path, name, start, checkout, autoStash) => mockCreateBranch(path, name, start, checkout, autoStash),
  renameBranch: async (path, oldName, newName) => mockRenameBranch(path, oldName, newName),
  deleteBranch: async (path, branch, force) => mockDeleteBranch(path, branch, force),
  async deleteRemoteBranch(path, branch) {
    await mockDelay();
    mockDeleteRemoteBranch(path, branch);
  },
  async fetch() {
    await mockDelay();
  },
  async pull(path, strategy, autoStash) {
    await mockDelay();
    return mockPull(path, strategy, autoStash);
  },
  async pullFrom(path, remote, branch, strategy, autoStash) {
    await mockDelay();
    return mockPullFrom(path, remote, branch, strategy, autoStash);
  },
  async push(path, force, remote) {
    await mockDelay();
    mockPush(path, force, remote);
  },
  addRemote: async (path, name, url) => mockAddRemote(path, name, url),
  renameRemote: async (path, oldName, newName) => mockRenameRemote(path, oldName, newName),
  setRemoteUrl: async (path, name, url) => mockSetRemoteUrl(path, name, url),
  removeRemote: async (path, name) => mockRemoveRemote(path, name),
  stashPop: async (path) => mockStashPop(path),
  async abortOperation() {
    throw "no_operation";
  },
  async continueOperation() {
    throw "no_operation";
  },
  async watchRepo() {},
  async onRepoChanged(cb) {
    mockRepoListeners.add(cb);
    return () => mockRepoListeners.delete(cb);
  },
  async setProfiles(profiles) {
    const s = mockLoad();
    const ids = new Set(profiles.map((p) => p.id));
    const repoProfiles: Record<string, RepoProfiles> = {};
    for (const [path, b] of Object.entries(s.repoProfiles ?? {})) {
      repoProfiles[path] = { active: b.active && ids.has(b.active) ? b.active : null, allowed: b.allowed.filter((id) => ids.has(id)) };
      // Le remote d'un profil supprimé retrouve le choix automatique.
      if (b.remotes) repoProfiles[path].remotes = Object.fromEntries(Object.entries(b.remotes).filter(([, id]) => id === null || ids.has(id)));
    }
    mockSave({ ...s, profiles, repoProfiles });
    return repoProfiles;
  },
  async setRepoProfiles(path, profiles) {
    const s = mockLoad();
    mockSave({ ...s, repoProfiles: { ...s.repoProfiles, [path]: profiles } });
  },
  homeDir: async () => "C:/Users/demo",
  async sshKeyInfo(path) {
    return mockKeyInfo(path);
  },
  async generateSshKey(path, comment, passphrase) {
    if (mockKeys.has(path) || mockKeyInfo(path, true)) throw "key_exists";
    mockKeys.set(path, comment);
    if (passphrase) {
      mockLocked.set(path, passphrase);
      mockPassphrases.add(path);
    }
    return mockKeyInfo(path);
  },
  async setKeyPassphrase(path, passphrase) {
    const info = mockKeyInfo(path);
    if (passphrase === null) mockPassphrases.delete(path);
    else if (info.encrypted && passphrase !== (mockLocked.get(path) ?? "secret")) throw "wrong_passphrase";
    else mockPassphrases.add(path);
    return mockKeyInfo(path);
  },
  async applyIdentity() {},
  async gpgKeys() {
    return [
      { id: "5E8B7C4CFAC5417C", fingerprint: "CD44BED4A958CD21393CB06C5E8B7C4CFAC5417C", uids: ["Camille Dupont <camille@boulot.fr>"], unusable: false },
      { id: "1111222233334444", fingerprint: "9999999999999999999999991111222233334444", uids: ["Demo <demo@exemple.fr>"], unusable: false },
      { id: "AAAA0000BBBB1111", fingerprint: "0000000000000000000000000000AAAA0000BBBB1111", uids: ["Ancienne <old@exemple.fr>"], unusable: true },
    ];
  },
  // Backend simulé : tout token est accepté sauf `bad…` (refusé) ; le compte est `octo-demo`
  // (GitHub) ou `camille.dupont` (GitLab), ou `<login>` avec un token `as:<login>`. Une instance
  // dont l'adresse contient `injoignable` ne répond pas ; un compte `revoked…` a perdu son token.
  async connectAccount(profile, kind, url, token) {
    await mockDelay();
    const inst = instance(kind, url);
    if (!inst) throw "invalid_instance_url";
    if (inst.url.includes("injoignable")) throw "provider_unreachable";
    const secret = token.trim();
    if (!secret || /\s/.test(secret) || secret.startsWith("bad")) throw "token_invalid";
    const login = secret.startsWith("as:") ? secret.slice(3) : kind === "github" ? "octo-demo" : "camille.dupont";
    const account: Account = { id: `${kind}|${inst.url}|${login.toLowerCase()}`, kind, url: inst.url, login, name: kind === "github" ? "Octo Démo" : null };
    const s = mockLoad();
    if (!s.profiles?.some((p) => p.id === profile)) throw "no_profile";
    mockSave({ ...s, profiles: s.profiles.map((p) => (p.id === profile ? { ...p, accounts: withAccount(p.accounts, account) } : p)) });
    return account;
  },
  async disconnectAccount(profile, account) {
    const s = mockLoad();
    mockSave({ ...s, profiles: s.profiles?.map((p) => (p.id === profile ? { ...p, accounts: p.accounts?.filter((a) => a.id !== account) } : p)) });
  },
  async checkAccount(account) {
    await mockDelay();
    const found = mockLoad().profiles?.flatMap((p) => p.accounts ?? []).find((a) => a.id === account);
    if (!found) throw "account_not_found";
    if (found.login.startsWith("revoked")) throw "token_invalid";
    return found;
  },
  // Backend simulé : un compte `revoked…` a perdu son token, une instance `injoignable` ne
  // répond pas.
  async listAccountRepos(account) {
    await mockDelay();
    const found = mockLoad().profiles?.flatMap((p) => p.accounts ?? []).find((a) => a.id === account);
    if (!found) throw "account_not_found";
    if (found.login.startsWith("revoked")) throw "token_invalid";
    if (found.url.includes("injoignable")) throw "provider_unreachable";
    return { repos: mockAccountRepos(found), truncated: false };
  },
  // Backend simulé : une URL qui contient `introuvable` n'existe pas, `refuse` est refusée ; un
  // dossier déjà connu (dépôt récent) est occupé. Le clone avance en une seconde environ.
  async cloneRepo(url, parent, name) {
    if (!url.trim() || url.trim().startsWith("-")) throw "invalid_remote_url";
    if (!validFolderName(name)) throw "invalid_folder_name";
    if (mockCloneCancel) throw "clone_busy";
    const path = joinPath(parent, name);
    if (mockLoad().repos.some((r) => r.path === path)) throw "clone_dest_exists";
    let cancelled = false;
    mockCloneCancel = () => (cancelled = true);
    try {
      const steps: CloneProgress[] = [
        { phase: "counting", percent: 100 },
        { phase: "receiving", percent: 30 },
        { phase: "receiving", percent: 70 },
        { phase: "receiving", percent: 100 },
        { phase: "resolving", percent: 100 },
        { phase: "checkout", percent: 100 },
      ];
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 150));
        if (cancelled) throw "clone_cancelled";
        if (url.includes("introuvable")) throw "remote_not_found";
        if (url.includes("refuse")) throw "auth_failed";
        for (const cb of mockCloneListeners) cb(step);
      }
    } finally {
      mockCloneCancel = null;
    }
    return path;
  },
  // Backend simulé : la connexion GitHub aboutit à la 4e demande (compte `octo-demo`).
  async githubDeviceStart() {
    await mockDelay();
    const flowId = ++mockDeviceSeq;
    mockDevicePolls.set(flowId, 0);
    return { flowId, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 0.3 };
  },
  async githubDevicePoll(profile, flowId) {
    await mockDelay();
    const n = mockDevicePolls.get(flowId);
    if (n === undefined) throw "device_expired";
    const s = mockLoad();
    const p = s.profiles?.find((x) => x.id === profile);
    if (!p) throw "no_profile";
    if (n < 3) {
      mockDevicePolls.set(flowId, n + 1);
      return { account: null, interval: null };
    }
    mockDevicePolls.delete(flowId);
    const account: Account = { id: "github|https://github.com|octo-demo", kind: "github", url: "https://github.com", login: "octo-demo", name: "Octo Démo" };
    mockSave({ ...s, profiles: s.profiles?.map((x) => (x.id === profile ? { ...x, accounts: withAccount(x.accounts, account) } : x)) });
    return { account, interval: null };
  },
  async githubDeviceCancel(flowId) {
    mockDevicePolls.delete(flowId);
  },
  // Backend simulé : un avatar coloré d'après le nom, sauf pour un propriétaire `sans-avatar`.
  async ownerAvatar(_kind, _url, owner) {
    if (owner.includes("sans-avatar") || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let h = 0;
    for (const c of owner) h = (h * 31 + c.charCodeAt(0)) % 360;
    ctx.fillStyle = `hsl(${h} 60% 45%)`;
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner[0]?.toUpperCase() ?? "?", 16, 17);
    return canvas.toDataURL();
  },
  // Backend simulé : un avatar coloré pour chaque auteur, sauf ceux dont l'adresse contient
  // `sans-avatar` (et aucun sans environnement graphique).
  async authorAvatars(_kind, _url, _repo, _account, emails) {
    const out: Record<string, string | null> = {};
    for (const e of emails) out[e.toLowerCase()] = e.includes("sans-avatar") ? null : await this.ownerAvatar("github", "", e, null);
    return out;
  },
  // Backend simulé : deux commits sur la branche, pas de modèle sauf pour une cible `develop`.
  async pullDraft(_path, source, target) {
    return {
      commits: [
        { subject: `Début de ${source}`, body: "Premier jet." },
        { subject: `Fin de ${source}`, body: "" },
      ],
      template: target.endsWith("/develop") ? "## Quoi\n\n## Pourquoi" : null,
    };
  },
  async remoteDefaultBranch(_kind, _url, _repo, account) {
    if (!account) throw "account_missing";
    return "main";
  },
  // Une branche source dont le nom contient `deja` a déjà sa PR / MR.
  async createPull(kind, url, account, request) {
    if (!account) throw "account_missing";
    if (!request.title.trim()) throw "pull_title_missing";
    const existing = request.sourceBranch.includes("deja");
    const number = existing ? 7 : 42;
    const page = kind === "github" ? `pull/${number}` : `-/merge_requests/${number}`;
    const title = kind === "gitlab" && request.draft ? `Draft: ${request.title}` : request.title;
    mockPulls.push(request);
    return { number, url: `${url}/${request.targetRepo}/${page}`, title, existing };
  },
  // Backend simulé : clés tirées du profil enregistré ; aucune n'est sur le compte au départ.
  // Un compte `noscope…` n'a pas les droits sur les clés ; une clé dont le chemin contient
  // `ailleurs` est déjà sur un autre compte.
  async accountKeys(profile, account) {
    await mockDelay();
    const p = mockLoad().profiles?.find((x) => x.id === profile);
    const a = p?.accounts?.find((x) => x.id === account);
    if (!p || !a) throw "account_not_found";
    if (a.login.startsWith("noscope")) throw "token_scope_missing";
    const keys: AccountKey[] = [];
    const entry = (kind: AccountKeyKind, path: string, label: string): AccountKey => ({ kind, label, present: mockAccountKeys.has(`${account}|${kind}|${path}`), error: null });
    if (p.sshKey) keys.push(entry("auth", p.sshKey, mockKeyInfo(p.sshKey, true)?.fingerprint ?? "SHA256:demo"));
    const signing = p.signing === "ssh" ? (p.signingKey || p.sshKey) : null;
    if (signing) keys.push(entry("signing", signing, mockKeyInfo(signing.replace(/\.pub$/, ""), true)?.fingerprint ?? "SHA256:demo"));
    if (p.signing === "gpg") keys.push(entry("gpg", p.signingKey || p.userEmail, "5E8B7C4CFAC5417C"));
    return keys;
  },
  async addAccountKey(profile, account, kind) {
    await mockDelay();
    const p = mockLoad().profiles?.find((x) => x.id === profile);
    if (!p) throw "no_profile";
    const path = kind === "auth" ? p.sshKey : kind === "signing" ? p.signingKey || p.sshKey : p.signingKey || p.userEmail;
    if (!path) throw "key_not_found";
    if (path.includes("ailleurs")) throw "key_in_use";
    mockAccountKeys.add(`${account}|${kind}|${path}`);
  },
  async cancelClone() {
    mockCloneCancel?.();
  },
  async onCloneProgress(cb) {
    mockCloneListeners.add(cb);
    return () => mockCloneListeners.delete(cb);
  },
  async pickFolder() {
    const p = MOCK_FOLDERS[mockPick % MOCK_FOLDERS.length];
    mockPick += 1;
    return p;
  },
  async pickFile() {
    return "C:/Users/demo/.ssh/id_ed25519";
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
