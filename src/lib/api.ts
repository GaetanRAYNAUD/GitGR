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
  mockBisectMark,
  mockRebasePlan,
  mockInteractiveRebase,
  mockListWorktrees,
  mockSuggestWorktreeDir,
  mockAddWorktree,
  mockRemoveWorktree,
  mockPruneWorktrees,
  mockBisectReset,
  mockBisectState,
  mockCheckoutRemote,
  mockCreateBranch,
  mockDeleteBranch,
  mockDeleteRemoteBranch,
  mockCreateTag,
  mockDeleteTag,
  mockTagRemote,
  mockPull,
  mockPullFrom,
  mockPush,
  mockPushBranch,
  mockFastForward,
  mockSetUpstream,
  mockMergeOrRebase,
  mockMoveBranch,
  mockSetBranchTip,
  mockRenameBranch,
  mockAutostash,
  mockStashCount,
  mockListStashes,
  mockStashChanges,
  mockStashApply,
  mockCherryPick,
  mockRevert,
  mockSquash,
  mockReflog,
  mockResetTo,
  mockStashDrop,
  mockStashRename,
  mockStashPop,
  mockStashPush,
} from "./mockBranches";
import { mockAuthors, mockBlobPreview, mockCommit, mockDetails, mockDiff, mockHeadMessage, mockHistory, mockIgnoreWs } from "./mockHistory";
import { mockMarkNotificationRead, mockPollNotifications, mockSeenNotifications, mockSystemNotifications } from "./mockNotifications";
import { mockListPulls, mockPullAct, mockPullActions, mockPullDetail, mockPullFileDiff, mockPullFiles, mockPullsPath } from "./mockPulls";
import { mockAddConflict, mockConflictSides, mockConflictVersions, mockResolveConflict, mockResolveConflictWith,
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
import { validRepoName } from "./publish";
import type {
  DiffOpts,
  Account,
  ReflogEntry,
  FileHistoryEntry,
  Blame,
  ResetMode,
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
  FileChange,
  FileDiff,
  NotificationPoll,
  GitInfo,
  GpgKey,
  InstallKind,
  LineRef,
  NewPull,
  OpResult,
  Profile,
  ProviderKind,
  Pull,
  PullAction,
  PullDetail,
  PullDraft,
  PullList,
  PullOptions,
  PullStrategy,
  RangeChanges,
  RangeDirection,
  NewRepo,
  Namespace,
  ProviderRepo,
  RefsInfo,
  RepoList,
  RepoEntry,
  UpdateInfo,
  RepoProfiles,
  RepoSummary,
  RepoUi,
  Session,
  Settings,
  SshKeyInfo,
  WorkStatus,
  StashChanges,
  StashEntry,
  ConflictVersions,
  IssueSummary,
  IssueDetail,
  IssueAction,
  CiRun,
  CommitSignature,
  RebasePlan,
  RebaseStep,
  ReleaseDraft,
  NewRelease,
  CreatedRelease,
  ConflictSides,
  BisectState,
  Worktree,
  Author,
  BlobPreview,
  BlobSide,
} from "./types";

/** Verdict d'un bisect. */
export type BisectVerdict = "good" | "bad" | "skip";

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
  /** `ignoreWs` : sans les changements d'espaces (`git diff -w`). */
  commitDiff(path: string, sha: string, file: string, oldFile: string | null, opts?: DiffOpts): Promise<FileDiff>;
  /** Commits et fichiers qui partent au push ou arrivent au pull (branche suivie). */
  rangeChanges(path: string, direction: RangeDirection): Promise<RangeChanges>;
  /** Commits qui ajoutent ou retirent `text` (`git log -S`, ou `-G` si `regex`), toutes branches. */
  searchChanges(path: string, text: string, regex: boolean, file: string | null): Promise<Commit[]>;
  /** Fichiers du commit `sha` où `text` apparaît ou disparaît (même règle que `searchChanges`). */
  searchFiles(path: string, sha: string, text: string, regex: boolean, file: string | null): Promise<FileChange[]>;
  /** Commits de la branche courante qui modifient `file`, renommages suivis, le plus récent d'abord. */
  fileHistory(path: string, file: string): Promise<FileHistoryEntry[]>;
  /** Commit de chaque ligne de `file` : au commit `rev`, ou dans la copie de travail (`null`). */
  blame(path: string, file: string, rev: string | null): Promise<Blame>;
  /** Positions passées de HEAD (`"HEAD"`) ou d'une branche locale, la plus récente d'abord. */
  reflog(path: string, refname: string): Promise<ReflogEntry[]>;
  /** Auteurs de l'historique (toutes branches), du plus actif au moins actif. */
  repoAuthors(path: string): Promise<Author[]>;
  /** SHA des commits (toutes branches) de ces auteurs (e-mails, sans casse). */
  authorCommits(path: string, emails: string[]): Promise<string[]>;
  /** Une version d'un fichier binaire pour l'aperçu du diff ; `null` si absente de cette version. */
  blobPreview(path: string, side: BlobSide): Promise<BlobPreview | null>;
  /** Déplace la branche courante sur `sha` (soft / mixed / hard). */
  resetTo(path: string, sha: string, mode: ResetMode): Promise<void>;
  /** Fichiers modifiés entre deux commits (`base` : un commit ou l'arbre vide). */
  compareFiles(path: string, base: string, tip: string): Promise<FileChange[]>;
  /** Réunit une suite contiguë de commits (du plus récent au plus ancien) en un seul. */
  squash(path: string, shas: string[], message: string, allowPushed: boolean, autoStash: boolean): Promise<OpResult>;
  /** Annule les commits donnés (du plus récent au plus ancien) par de nouveaux commits. */
  revert(path: string, shas: string[], autoStash: boolean): Promise<OpResult>;
  /** Cherry-pick des commits donnés, du plus ancien au plus récent, sur la branche courante. */
  cherryPick(path: string, shas: string[], autoStash: boolean): Promise<OpResult>;
  /** Diff cumulé d'un fichier entre `base` et `tip`. */
  rangeDiff(path: string, base: string, tip: string, file: string, oldFile: string | null, opts?: DiffOpts): Promise<FileDiff>;
  // Copie de travail
  workStatus(path: string): Promise<WorkStatus>;
  workDiff(path: string, file: string, oldFile: string | null, area: DiffArea, opts?: DiffOpts): Promise<FileDiff>;
  stageFiles(path: string, files: string[]): Promise<void>;
  /** Les trois versions d'un fichier en conflit (commune, nôtre, autre) et le fichier tel
   *  qu'il est sur le disque, avec les marqueurs de git. */
  conflictVersions(path: string, file: string): Promise<ConflictVersions>;
  /** Identité qu'aurait un commit fait maintenant (profil actif, sinon config git) ; `null` : aucune. */
  commitIdentity(path: string): Promise<{ name: string; email: string } | null>;
  /** Écrit la résolution d'un conflit et marque le fichier résolu (`git add`). */
  resolveConflict(path: string, file: string, content: string): Promise<void>;
  /** Versions d'un fichier en conflit binaire ou supprimé d'un côté. */
  conflictSides(path: string, file: string): Promise<ConflictSides>;
  /** Résout un conflit en entier : garder notre version, l'autre, ou supprimer le fichier. */
  resolveConflictWith(path: string, file: string, choice: "ours" | "theirs" | "delete"): Promise<void>;
  unstageFiles(path: string, files: string[]): Promise<void>;
  stageAll(path: string): Promise<void>;
  unstageAll(path: string): Promise<void>;
  /** Abandonne les modifications non indexées ; les fichiers non suivis sont supprimés. */
  discardFiles(path: string, tracked: string[], untracked: string[]): Promise<void>;
  discardAll(path: string): Promise<void>;
  /** Ajoute un motif au `.gitignore` du dépôt ; faux s'il y était déjà. */
  addToGitignore(path: string, pattern: string): Promise<boolean>;
  /** Ne plus suivre un fichier (gardé sur le disque) et ajouter `pattern` au `.gitignore`. */
  untrackFile(path: string, file: string, pattern: string): Promise<void>;
  stashAll(path: string, message: string): Promise<void>;
  /** Stash partiel : seulement ces fichiers. */
  stashFiles(path: string, message: string, files: string[]): Promise<void>;
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
  /** Commits (toutes branches) qui touchent un fichier ou un dossier. */
  fileCommits(path: string, file: string): Promise<string[]>;
  /** Cherry-pick sur une autre branche sans la checkout (nombre de commits ajoutés) ;
   *  `needs_checkout` quand ce n'est pas possible ainsi (conflit…). */
  cherryPickToBranch(path: string, branch: string, shas: string[]): Promise<number>;
  /** Signature d'un commit, vérifiée par git. */
  commitSignature(path: string, sha: string): Promise<CommitSignature>;
  /** Commits de la branche courante après `base` (`null` : depuis le premier commit). */
  rebasePlan(path: string, base: string | null, onto: boolean): Promise<RebasePlan>;
  /** Rebase interactif selon les étapes (dans leur ordre). */
  interactiveRebase(path: string, base: string | null, onto: boolean, steps: RebaseStep[], autoStash: boolean): Promise<OpResult>;
  /** Worktrees du dépôt (principal compris, en premier). */
  listWorktrees(path: string): Promise<Worktree[]>;
  /** Dossier proposé pour un worktree de `branch`, à côté du dépôt principal. */
  suggestWorktreeDir(path: string, branch: string): Promise<string>;
  /** Crée un worktree : branche existante, ou nouvelle branche (depuis `start`), ou détaché sur `start`. */
  addWorktree(path: string, dir: string, opts: { branch?: string; newBranch?: string; start?: string }): Promise<void>;
  removeWorktree(path: string, dir: string, force: boolean): Promise<void>;
  pruneWorktrees(path: string): Promise<void>;
  /** Bisect en cours (`null` : aucun). */
  bisectState(path: string): Promise<BisectState | null>;
  /** Marque `sha` (HEAD si `null`) bon, mauvais ou à passer ; commence le bisect au besoin. */
  bisectMark(path: string, verdict: BisectVerdict, sha: string | null, autoStash: boolean): Promise<[OpResult, BisectState]>;
  /** Arrête le bisect (retour à la branche de départ). */
  bisectReset(path: string, autoStash: boolean): Promise<OpResult>;
  /** `start` : SHA ou nom de ref (`null` : HEAD). */
  createBranch(path: string, name: string, start: string | null, checkout: boolean, autoStash: boolean): Promise<OpResult>;
  renameBranch(path: string, oldName: string, newName: string): Promise<void>;
  deleteBranch(path: string, branch: string, force: boolean): Promise<void>;
  deleteRemoteBranch(path: string, branch: string): Promise<void>;
  /** Tag sur `target` (HEAD si `null`) : annoté si `message` est donné, léger sinon. */
  createTag(path: string, name: string, target: string | null, message: string | null): Promise<void>;
  deleteTag(path: string, name: string): Promise<void>;
  /** Pousse un tag vers `remote` (`origin` ou le premier si `null`) ; renvoie le remote. */
  pushTag(path: string, name: string, remote: string | null): Promise<string>;
  /** Supprime un tag sur `remote` (`origin` ou le premier si `null`) ; renvoie le remote. */
  deleteRemoteTag(path: string, name: string, remote: string | null): Promise<string>;
  fetch(path: string): Promise<void>;
  pull(path: string, strategy: PullStrategy, autoStash: boolean): Promise<OpResult>;
  /** Tire la branche `branch` du remote `remote` dans la branche courante. */
  pullFrom(path: string, remote: string, branch: string, strategy: PullStrategy, autoStash: boolean): Promise<OpResult>;
  /** Sans branche distante, la crée et la suit ; `force` : `--force-with-lease`. `remote` :
   *  destination choisie (`null` : celle de la branche suivie, sinon `origin`). */
  push(path: string, force: boolean, remote: string | null): Promise<void>;
  /** Pousse une branche locale, courante ou non (mêmes règles que `push`). */
  pushBranch(path: string, branch: string, force: boolean, remote: string | null): Promise<void>;
  /** Avance rapide d'une autre branche que la courante depuis sa branche suivie (sans checkout). */
  fastForwardBranch(path: string, branch: string): Promise<boolean>;
  /** Branche suivie par `branch` (`upstream` : `origin/x` ; `null` : plus aucune). */
  setUpstream(path: string, branch: string, upstream: string | null): Promise<void>;
  /** Fusionne la branche `branch` (nom complet : `refs/heads/x`, `refs/remotes/o/x`) dans la courante. */
  mergeBranch(path: string, branch: string, autoStash: boolean): Promise<OpResult>;
  /** Annuler / rétablir : `branch` (`null` : HEAD détachée) de `expected` à `target` ; `expected`
   *  `null` : la branche est recréée ; `target` `null` : supprimée. `undo_stale` si elle a bougé. */
  setBranchTip(path: string, branch: string | null, expected: string | null, target: string | null, mode: "soft" | "keep"): Promise<void>;
  /** Déplace une branche qui n'est pas la courante sur `sha` (`git branch -f`). */
  moveBranch(path: string, branch: string, sha: string): Promise<void>;
  /** Rebase la branche courante sur la branche `branch` (nom complet). */
  rebaseOnto(path: string, branch: string, autoStash: boolean): Promise<OpResult>;
  // Remotes
  addRemote(path: string, name: string, url: string): Promise<void>;
  renameRemote(path: string, oldName: string, newName: string): Promise<void>;
  /** Nouvelle URL (fetch, et push si le remote n'a pas d'URL de push à part). */
  setRemoteUrl(path: string, name: string, url: string): Promise<void>;
  /** Supprime le remote, ses branches distantes et le suivi des branches locales. */
  removeRemote(path: string, name: string): Promise<void>;
  stashPop(path: string): Promise<OpResult>;
  listStashes(path: string): Promise<StashEntry[]>;
  /** Réapplique un stash ; `drop` : le retire aussi de la pile (sauf conflit). */
  stashApply(path: string, sha: string, drop: boolean): Promise<OpResult>;
  stashDrop(path: string, sha: string): Promise<void>;
  /** Nouveau message ; le stash passe en haut de la pile. */
  stashRename(path: string, sha: string, message: string): Promise<void>;
  /** Fichiers d'un stash ; diff de chacun avec `rangeDiff` (non suivis : depuis l'arbre vide). */
  stashChanges(path: string, sha: string): Promise<StashChanges>;
  /** `git stash branch` : nouvelle branche extraite sur le commit du stash, stash réappliqué. */
  stashBranch(path: string, sha: string, name: string): Promise<void>;
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
  /** Où le compte peut créer un dépôt : lui-même d'abord, puis ses organisations / groupes. */
  listAccountNamespaces(account: string): Promise<Namespace[]>;
  /** Crée un dépôt distant vide sur le compte ; renvoie ses adresses. */
  createAccountRepo(account: string, repo: NewRepo): Promise<ProviderRepo>;
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
  /** Issues ouvertes (`assignee` : seulement celles de ce login). */
  listIssues(kind: ProviderKind, url: string, account: string | null, repo: string, assignee: string | null): Promise<IssueSummary[]>;
  issueDetail(kind: ProviderKind, url: string, account: string | null, repo: string, number: number): Promise<IssueDetail>;
  issueAction(kind: ProviderKind, url: string, account: string | null, repo: string, number: number, action: IssueAction): Promise<void>;
  /** Nom de branche proposé pour une issue (`12-titre-court`, préfixe éventuel). */
  issueBranchName(number: number, title: string, prefix: string): Promise<string>;
  /** Dernières exécutions de CI du dépôt (`branch` : seulement celle-là). */
  ciRuns(kind: ProviderKind, url: string, account: string | null, repo: string, branch: string | null): Promise<CiRun[]>;
  /** Relance les jobs en échec d'une exécution. */
  ciRetry(kind: ProviderKind, url: string, account: string | null, repo: string, id: number): Promise<void>;
  /** Commits de la release d'un tag (depuis le tag précédent). */
  releaseDraft(path: string, tag: string): Promise<ReleaseDraft>;
  /** Crée la release d'un tag déjà poussé, avec le compte donné. */
  createRelease(kind: ProviderKind, url: string, account: string | null, request: NewRelease): Promise<CreatedRelease>;
  /** Personnes et étiquettes du dépôt en cache (sinon celles des autres dépôts du même
   *  propriétaire, `fromOwner`) ; `null` : rien de connu. Ne demande rien au provider. */
  cachedPullOptions(kind: ProviderKind, url: string, repo: string): Promise<PullOptions | null>;
  /** Relit les personnes et étiquettes sur le provider (et met le cache à jour). */
  refreshPullOptions(kind: ProviderKind, url: string, repo: string, account: string | null): Promise<PullOptions>;
  /** PR / MR ouvertes du dépôt (100 au plus, les plus récemment mises à jour d'abord). */
  listPulls(kind: ProviderKind, url: string, repo: string, account: string | null): Promise<PullList>;
  pullDetail(kind: ProviderKind, url: string, repo: string, number: number, account: string | null): Promise<PullDetail>;
  /** Action sur une PR / MR (commentaire, relecture, merge…). */
  pullAct(kind: ProviderKind, url: string, repo: string, number: number, account: string | null, action: PullAction): Promise<void>;
  /** Récupère le commit de tête sha s'il manque (depuis la référence de la PR / MR sur `remote`). */
  ensurePullHead(path: string, remote: string, kind: ProviderKind, number: number, sha: string): Promise<void>;
  /** Fichiers modifiés par la PR / MR : de l'ancêtre commun avec `target` (origin/main) à head. */
  pullFiles(path: string, target: string, head: string): Promise<FileChange[]>;
  pullFileDiff(path: string, target: string, head: string, file: string, oldFile: string | null, opts?: DiffOpts): Promise<FileDiff>;
  /** Passe sur la branche de la PR / MR (fork : pr/<n> / mr/<n>) ; renvoie aussi son nom. */
  checkoutPull(path: string, remote: string, kind: ProviderKind, number: number, branch: string, fork: boolean, autoStash: boolean): Promise<[OpResult, string]>;
  /** Images des personnes (adresses de l'API → data URL, ou `null`). */
  personAvatars(kind: ProviderKind, url: string, account: string | null, urls: string[]): Promise<Record<string, string | null>>;
  // Notifications
  /** Lit les notifications du compte (requête conditionnelle : `changed: false` si rien de neuf). */
  pollNotifications(account: string): Promise<NotificationPoll>;
  /** Marque comme lue chez le provider une notification, ou toutes (`id` à `null`). */
  markNotificationRead(account: string, id: string | null): Promise<void>;
  /** Clés des notifications vues (gardées en local). */
  notificationsSeen(): Promise<string[]>;
  addNotificationsSeen(keys: string[]): Promise<void>;
  /** Notification du système (permission demandée au premier usage). */
  systemNotify(title: string, body: string): Promise<void>;
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
  // Mises à jour de GitGR
  /** Paquet par lequel GitGR est installé : dit si l'app peut se mettre à jour seule. */
  installKind(): Promise<InstallKind>;
  /** Lit le manifeste de la dernière release : la version plus récente, `null` si à jour. */
  checkUpdate(): Promise<UpdateInfo | null>;
  /** Télécharge en arrière-plan la version trouvée par le dernier `checkUpdate`, sans
   *  l'installer. `no_update` : rien à télécharger. */
  downloadUpdate(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
  /** Installe la version trouvée par le dernier `checkUpdate` (téléchargée d'abord si besoin).
   *  `restart` : GitGR redémarre ensuite (sous Windows, l'installateur ferme l'app et la
   *  relance) ; sinon l'installation se fait sans relance, à la fermeture de l'app.
   *  `no_update` : rien à installer. */
  installUpdate(onProgress: (downloaded: number, total: number | null) => void, restart?: boolean): Promise<void>;
  /** Fichier `file` (relatif au dépôt) : ouvert avec le programme par défaut du système, ou
   *  montré dans l'explorateur (son dossier s'il n'existe plus). `file_missing` : rien à ouvrir. */
  openRepoFile(path: string, file: string, how: "open" | "reveal"): Promise<void>;
  /** Ouvre un fichier du dépôt avec l'éditeur des réglages (ligne de commande). */
  openInEditor(path: string, file: string, editor: string): Promise<void>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    /** Fenêtre agrandie : `cb` à chaque changement (et une fois au départ). Renvoie le désabonnement. */
    onMaximizedChange(cb: (maximized: boolean) => void): Promise<() => void>;
    startDragging(): Promise<void>;
    close(): Promise<void>;
    hide(): Promise<void>;
    /** `cb` est attendu avant la fermeture de la fenêtre (croix de l'app, Alt+F4…). */
    onCloseRequested(cb: () => Promise<void>): Promise<() => void>;
  };
}


/** Dernier fetch simulé par dépôt (secondes). */
const mockLastFetch = new Map<string, number>();
/** Releases créées par le backend simulé (lues par les tests e2e). */
const mockReleases: (NewRelease & { kind: ProviderKind })[] = [];

/** Issues du backend simulé (modifiées par les actions). */
const mockIssues: IssueDetail[] = [
  { number: 12, title: "Le graphe saute au rechargement", state: "open", author: { id: 8, login: "max", name: "Max", avatar: null }, assignees: [{ id: 7, login: "camille", name: "Camille", avatar: null }], labels: [{ name: "bug", color: "d73a4a", description: null }], comments: 1, url: "https://gitlab.exemple.fr/demo/gitgr/-/issues/12", updated: 1764300000, body: "Après un **fetch**, la sélection revient en haut.", created: 1764200000, milestone: "v0.4", commentsList: [{ id: "1", author: { id: 8, login: "max", name: "Max", avatar: null }, body: "Vu sous Windows.", at: 1764250000 }] },
  { number: 9, title: "Thème sombre : contraste des étiquettes", state: "open", author: { id: 7, login: "camille", name: "Camille", avatar: null }, assignees: [], labels: [], comments: 0, url: "https://gitlab.exemple.fr/demo/gitgr/-/issues/9", updated: 1764100000, body: "", created: 1764000000, milestone: null, commentsList: [] },
];

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

async function currentWindow() {
  const w = await import("@tauri-apps/api/window");
  return w.getCurrentWindow();
}

/** Mise à jour trouvée par le dernier `checkUpdate`, à installer ; `pendingDownloaded` : déjà
 *  téléchargée (`downloadUpdate`). */
let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;
let pendingDownloaded = false;

/** Avancement d'un téléchargement du plugin, en octets reçus / taille totale. */
function downloadProgress(onProgress: (downloaded: number, total: number | null) => void) {
  let downloaded = 0;
  let total: number | null = null;
  return (e: import("@tauri-apps/plugin-updater").DownloadEvent) => {
    if (e.event === "Started") total = e.data.contentLength ?? null;
    else if (e.event === "Progress") downloaded += e.data.chunkLength;
    onProgress(downloaded, total);
  };
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
  commitDiff: (path, sha, file, oldFile, opts) => invoke("commit_diff", { path, sha, file, oldFile, ignoreWs: !!opts?.ignoreWs, full: !!opts?.full }),
  rangeChanges: (path, direction) => invoke("range_changes", { path, direction }),
  rangeDiff: (path, base, tip, file, oldFile, opts) => invoke("range_diff", { path, base, tip, file, oldFile, ignoreWs: !!opts?.ignoreWs, full: !!opts?.full }),
  compareFiles: (path, base, tip) => invoke("compare_files", { path, base, tip }),
  reflog: (path, refname) => invoke("reflog", { path, refname }),
  repoAuthors: (path) => invoke("repo_authors", { path }),
  authorCommits: (path, emails) => invoke("author_commits", { path, emails }),
  blobPreview: (path, side) => invoke("blob_preview", { path, rev: side.rev, file: side.file }),
  searchChanges: (path, text, regex, file) => invoke("search_changes", { path, text, regex, file }),
  searchFiles: (path, sha, text, regex, file) => invoke("search_files", { path, sha, text, regex, file }),
  fileHistory: (path, file) => invoke("file_history", { path, file }),
  blame: (path, file, rev) => invoke("blame", { path, file, rev }),
  resetTo: (path, sha, mode) => invoke("reset_to", { path, sha, mode }),
  cherryPick: (path, shas, autoStash) => invoke("cherry_pick", { path, shas, autoStash }),
  revert: (path, shas, autoStash) => invoke("revert", { path, shas, autoStash }),
  squash: (path, shas, message, allowPushed, autoStash) => invoke("squash", { path, shas, message, allowPushed, autoStash }),
  workStatus: (path) => invoke("work_status", { path }),
  workDiff: (path, file, oldFile, area, opts) => invoke("work_diff", { path, file, oldFile, area, ignoreWs: !!opts?.ignoreWs, full: !!opts?.full }),
  stageFiles: (path, files) => invoke("stage_files", { path, files }),
  conflictVersions: (path, file) => invoke("conflict_versions", { path, file }),
  commitIdentity: (path) => invoke("commit_identity", { path }),
  resolveConflict: (path, file, content) => invoke("resolve_conflict", { path, file, content }),
  conflictSides: (path, file) => invoke("conflict_sides", { path, file }),
  resolveConflictWith: (path, file, choice) => invoke("resolve_conflict_with", { path, file, choice }),
  unstageFiles: (path, files) => invoke("unstage_files", { path, files }),
  stageAll: (path) => invoke("stage_all", { path }),
  unstageAll: (path) => invoke("unstage_all", { path }),
  discardFiles: (path, tracked, untracked) => invoke("discard_files", { path, tracked, untracked }),
  discardAll: (path) => invoke("discard_all", { path }),
  addToGitignore: (path, pattern) => invoke("add_to_gitignore", { path, pattern }),
  untrackFile: (path, file, pattern) => invoke("untrack_file", { path, file, pattern }),
  stashAll: (path, message) => invoke("stash_all", { path, message }),
  stashFiles: (path, message, files) => invoke("stash_files", { path, message, files }),
  stageLines: (path, file, oldFile, lines, fingerprint, unstage) =>
    invoke("stage_lines", { path, file, oldFile, lines, fingerprint, unstage }),
  discardLines: (path, file, lines, fingerprint) => invoke("discard_lines", { path, file, lines, fingerprint }),
  commit: (path, message, amend) => invoke("commit", { path, message, amend }),
  headMessage: (path) => invoke("head_message", { path }),
  checkout: (path, branch, autoStash) => invoke("checkout", { path, branch, autoStash }),
  checkoutRemote: (path, branch, autoStash) => invoke("checkout_remote", { path, branch, autoStash }),
  checkoutDetached: (path, sha, autoStash) => invoke("checkout_detached", { path, sha, autoStash }),
  fileCommits: (path, file) => invoke("file_commits", { path, file }),
  cherryPickToBranch: (path, branch, shas) => invoke("cherry_pick_to_branch", { path, branch, shas }),
  commitSignature: (path, sha) => invoke("commit_signature", { path, sha }),
  rebasePlan: (path, base, onto) => invoke("rebase_plan", { path, base, onto }),
  interactiveRebase: (path, base, onto, steps, autoStash) => invoke("interactive_rebase", { path, base, onto, steps, autoStash }),
  listWorktrees: (path) => invoke("list_worktrees", { path }),
  suggestWorktreeDir: (path, branch) => invoke("suggest_worktree_dir", { path, branch }),
  addWorktree: (path, dir, o) => invoke("add_worktree", { path, dir, branch: o.branch ?? null, newBranch: o.newBranch ?? null, start: o.start ?? null }),
  removeWorktree: (path, dir, force) => invoke("remove_worktree", { path, dir, force }),
  pruneWorktrees: (path) => invoke("prune_worktrees", { path }),
  bisectState: (path) => invoke("bisect_state", { path }),
  bisectMark: (path, verdict, sha, autoStash) => invoke("bisect_mark", { path, verdict, sha, autoStash }),
  bisectReset: (path, autoStash) => invoke("bisect_reset", { path, autoStash }),
  createBranch: (path, name, start, checkout, autoStash) => invoke("create_branch", { path, name, start, checkout, autoStash }),
  renameBranch: (path, oldName, newName) => invoke("rename_branch", { path, old: oldName, new: newName }),
  deleteBranch: (path, branch, force) => invoke("delete_branch", { path, branch, force }),
  deleteRemoteBranch: (path, branch) => invoke("delete_remote_branch", { path, branch }),
  createTag: (path, name, target, message) => invoke("create_tag", { path, name, target, message }),
  deleteTag: (path, name) => invoke("delete_tag", { path, name }),
  pushTag: (path, name, remote) => invoke("push_tag", { path, name, remote }),
  deleteRemoteTag: (path, name, remote) => invoke("delete_remote_tag", { path, name, remote }),
  fetch: (path) => invoke("fetch", { path }),
  pull: (path, strategy, autoStash) => invoke("pull", { path, strategy, autoStash }),
  pullFrom: (path, remote, branch, strategy, autoStash) => invoke("pull_from", { path, remote, branch, strategy, autoStash }),
  push: (path, force, remote) => invoke("push", { path, force, remote }),
  pushBranch: (path, branch, force, remote) => invoke("push_branch", { path, branch, force, remote }),
  fastForwardBranch: (path, branch) => invoke("fast_forward_branch", { path, branch }),
  setUpstream: (path, branch, upstream) => invoke("set_upstream", { path, branch, upstream }),
  mergeBranch: (path, branch, autoStash) => invoke("merge_branch", { path, branch, autoStash }),
  rebaseOnto: (path, branch, autoStash) => invoke("rebase_onto", { path, branch, autoStash }),
  moveBranch: (path, branch, sha) => invoke("move_branch", { path, branch, sha }),
  setBranchTip: (path, branch, expected, target, mode) => invoke("set_branch_tip", { path, branch, expected, target, mode }),
  addRemote: (path, name, url) => invoke("add_remote", { path, name, url }),
  renameRemote: (path, oldName, newName) => invoke("rename_remote", { path, old: oldName, new: newName }),
  setRemoteUrl: (path, name, url) => invoke("set_remote_url", { path, name, url }),
  removeRemote: (path, name) => invoke("remove_remote", { path, name }),
  stashPop: (path) => invoke("stash_pop", { path }),
  listStashes: (path) => invoke("list_stashes", { path }),
  stashApply: (path, sha, drop) => invoke("stash_apply", { path, sha, drop }),
  stashDrop: (path, sha) => invoke("stash_drop", { path, sha }),
  stashRename: (path, sha, message) => invoke("stash_rename", { path, sha, message }),
  stashChanges: (path, sha) => invoke("stash_changes", { path, sha }),
  stashBranch: (path, sha, name) => invoke("stash_branch", { path, sha, name }),
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
  listAccountNamespaces: (account) => invoke("list_account_namespaces", { account }),
  createAccountRepo: (account, repo) => invoke("create_account_repo", { account, repo }),
  githubDeviceStart: () => invoke("github_device_start"),
  githubDevicePoll: (profile, flowId) => invoke("github_device_poll", { profile, flowId }),
  githubDeviceCancel: (flowId) => invoke("github_device_cancel", { flowId }),
  ownerAvatar: (kind, url, owner, account) => invoke("owner_avatar", { kind, url, owner, account }),
  authorAvatars: (kind, url, repo, account, emails) => invoke("author_avatars", { kind, url, repo, account, emails }),
  pullDraft: (path, source, target, kind) => invoke("pull_draft", { path, source, target, kind }),
  remoteDefaultBranch: (kind, url, repo, account) => invoke("remote_default_branch", { kind, url, repo, account }),
  createPull: (kind, url, account, request) => invoke("create_pull", { kind, url, account, request }),
  listIssues: (kind, url, account, repo, assignee) => invoke("list_issues", { kind, url, account, repo, assignee }),
  issueDetail: (kind, url, account, repo, number) => invoke("issue_detail", { kind, url, account, repo, number }),
  issueAction: (kind, url, account, repo, number, action) => invoke("issue_action", { kind, url, account, repo, number, action }),
  issueBranchName: (number, title, prefix) => invoke("issue_branch_name", { number, title, prefix }),
  ciRuns: (kind, url, account, repo, branch) => invoke("ci_runs", { kind, url, account, repo, branch }),
  ciRetry: (kind, url, account, repo, id) => invoke("ci_retry", { kind, url, account, repo, id }),
  releaseDraft: (path, tag) => invoke("release_draft", { path, tag }),
  createRelease: (kind, url, account, request) => invoke("create_release", { kind, url, account, request }),
  cachedPullOptions: (kind, url, repo) => invoke("cached_pull_options", { kind, url, repo }),
  refreshPullOptions: (kind, url, repo, account) => invoke("refresh_pull_options", { kind, url, repo, account }),
  listPulls: (kind, url, repo, account) => invoke("list_pulls", { kind, url, repo, account }),
  pullDetail: (kind, url, repo, number, account) => invoke("pull_detail", { kind, url, repo, number, account }),
  pullAct: (kind, url, repo, number, account, action) => invoke("pull_act", { kind, url, repo, number, account, action }),
  ensurePullHead: (path, remote, kind, number, sha) => invoke("ensure_pull_head", { path, remote, kind, number, sha }),
  pullFiles: (path, target, head) => invoke("pull_files", { path, target, head }),
  pullFileDiff: (path, target, head, file, oldFile, opts) => invoke("pull_file_diff", { path, target, head, file, oldFile, ignoreWs: !!opts?.ignoreWs, full: !!opts?.full }),
  checkoutPull: (path, remote, kind, number, branch, fork, autoStash) => invoke("checkout_pull", { path, remote, kind, number, branch, fork, autoStash }),
  personAvatars: (kind, url, account, urls) => invoke("person_avatars", { kind, url, account, urls }),
  pollNotifications: (account) => invoke("poll_notifications", { account }),
  markNotificationRead: (account, id) => invoke("mark_notification_read", { account, id }),
  notificationsSeen: () => invoke("notifications_seen"),
  addNotificationsSeen: (keys) => invoke("add_notifications_seen", { keys }),
  async systemNotify(title, body) {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (granted) n.sendNotification({ title, body });
  },
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
  installKind: () => invoke("install_kind"),
  async checkUpdate() {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    // L'ancienne mise à jour trouvée libère sa ressource côté Rust.
    await pendingUpdate?.close().catch(() => {});
    pendingUpdate = update;
    pendingDownloaded = false;
    return update ? { version: update.version, notes: update.body ?? null, date: update.date ?? null } : null;
  },
  async downloadUpdate(onProgress) {
    const update = pendingUpdate;
    if (!update) throw "no_update";
    await update.download(downloadProgress(onProgress));
    pendingDownloaded = true;
  },
  async installUpdate(onProgress, restart = true) {
    const update = pendingUpdate;
    if (!update) throw "no_update";
    const options = { restartAfterInstall: restart };
    if (pendingDownloaded) await update.install(options);
    else await update.downloadAndInstall(downloadProgress(onProgress), options);
    if (restart) {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  },
  openRepoFile: (path, file, how) => invoke("open_repo_file", { path, file, how }),
  openInEditor: (path, file, editor) => invoke("open_in_editor", { path, file, editor }),
  window: {
    minimize: async () => (await currentWindow()).minimize(),
    toggleMaximize: async () => (await currentWindow()).toggleMaximize(),
    onMaximizedChange: async (cb) => {
      const w = await currentWindow();
      const check = async () => cb(await w.isMaximized());
      await check();
      return w.onResized(() => void check());
    },
    startDragging: async () => (await currentWindow()).startDragging(),
    close: async () => (await currentWindow()).close(),
    hide: async () => (await currentWindow()).hide(),
    onCloseRequested: async (cb) => (await currentWindow()).onCloseRequested(() => cb()),
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
const mockOptionsCache = new Map<string, PullOptions>();
/** Lectures des personnes / étiquettes sur le « provider » simulé (lues par les tests e2e). */
const mockOptionFetches = { count: 0, delay: 600 };
if (!inTauri && typeof window !== "undefined") {
  Object.assign(window, { __mockReleases: mockReleases, __mockPulls: mockPulls, __mockOptionFetches: mockOptionFetches, __mockPullActions: mockPullActions, __mockConflict: mockAddConflict });
}

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

/** Réglages des tests sur le backend simulé, posés sur `window`. */
function mockWindow() {
  return window as unknown as {
    __mockInstallKind?: InstallKind;
    __mockUpdate?: UpdateInfo | null;
    __mockUpdateError?: string;
    __mockRelaunched?: boolean;
    __mockDownloaded?: boolean;
    __mockDownloadError?: string;
    __mockInstalled?: boolean;
    __mockCloseRequested?: () => Promise<void>;
  };
}

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
      lastFetch: mockLastFetch.get(path) ?? null,
    };
  },
  async repoLog(path, skip, limit) {
    await mockDelay();
    return mockHistory(path).commits.slice(skip, skip + limit);
  },
  async repoRefs(path) {
    mockPullsPath(path);
    return { ...mockHistory(path).refs, stashes: mockStashCount(path), autostash: mockAutostash(path) };
  },
  async commitDetails(path, sha) {
    await mockDelay();
    return mockDetails(path, sha);
  },
  async commitDiff(_path, sha, file, _oldFile, opts) {
    await mockDelay();
    return mockIgnoreWs(mockDiff(sha, file), opts?.ignoreWs);
  },
  async rangeChanges(path, direction) {
    await mockDelay();
    const { commits, refs } = mockHistory(path);
    const cur = refs.refs.find((x) => x.kind === "local" && x.short === refs.headBranch);
    if (!cur?.upstream) throw "no_upstream";
    const up = refs.refs.find((x) => x.kind === "remote" && x.short === cur.upstream);
    // Premiers parents depuis le bout, autant que l'avance (push) ou le retard (pull).
    let sha: string | undefined = direction === "push" ? cur.target : up?.target;
    const tip = sha ?? cur.target;
    const list: Commit[] = [];
    for (let n = direction === "push" ? cur.ahead : cur.behind; n > 0 && sha; n--) {
      const c = commits.find((x) => x.sha === sha);
      if (!c) break;
      list.push(c);
      sha = c.parents[0];
    }
    const files = new Map<string, FileChange>();
    for (const c of list) for (const f of mockDetails(path, c.sha).files) files.set(f.path, f);
    return { base: sha ?? tip, tip, commits: list, files: [...files.values()] };
  },
  async compareFiles(path, base, tip) {
    await mockDelay();
    // Fichiers des commits de `tip` jusqu'à `base` (premiers parents), comme un diff cumulé.
    const { commits } = mockHistory(path);
    const files = new Map<string, FileChange>();
    let sha: string | undefined = tip;
    for (let n = 0; sha && sha !== base && n < 200; n++) {
      const c = commits.find((x) => x.sha === sha);
      if (!c) break;
      for (const f of mockDetails(path, c.sha).files) if (!files.has(f.path)) files.set(f.path, f);
      sha = c.parents[0];
    }
    return [...files.values()];
  },
  cherryPick: async (path, shas, autoStash) => mockCherryPick(path, shas, autoStash),
  revert: async (path, shas, autoStash) => mockRevert(path, shas, autoStash),
  squash: async (path, shas, message, allowPushed) => mockSquash(path, shas, message, allowPushed),
  async searchChanges(path, text, regex, file) {
    await mockDelay();
    if (!text) throw "search_empty";
    let re: RegExp | null = null;
    try {
      re = regex ? new RegExp(text) : null;
    } catch {
      throw "search_bad_regex";
    }
    // Simulé : le texte cherché dans le sujet des commits (et le chemin dans leurs fichiers).
    const { commits } = mockHistory(path);
    return commits
      .filter((c) => (re ? re.test(c.subject) : c.subject.includes(text)))
      .filter((c) => !file || mockDetails(path, c.sha).files.some((f) => f.path.startsWith(file)))
      .slice(0, 200);
  },
  async searchFiles(path, sha, text, _regex, file) {
    await mockDelay();
    if (!text) throw "search_empty";
    // Simulé : les fichiers du commit (sous `file` s'il est donné).
    return mockDetails(path, sha).files.filter((f) => !file || f.path.startsWith(file));
  },
  async fileHistory(path, file) {
    await mockDelay();
    // Simulé : les commits de l'historique dont les fichiers contiennent ce chemin.
    const { commits } = mockHistory(path);
    return commits.flatMap((commit) => {
      const change = mockDetails(path, commit.sha).files.find((f) => f.path === file);
      return change ? [{ commit, change }] : [];
    }).slice(0, 500);
  },
  async blame(path, file, rev) {
    await mockDelay();
    // Simulé : des blocs de lignes répartis sur les commits les plus récents.
    const { commits } = mockHistory(path);
    const from = rev ? Math.max(0, commits.findIndex((c) => c.sha === rev)) : 0;
    const pool = commits.slice(from, from + 6);
    const lines = Array.from({ length: 60 }, (_, i) => {
      const c = !rev && i >= 56 ? null : pool[Math.floor(i / 7) % pool.length];
      return { sha: c ? c.sha : "0".repeat(40), orig: i + 1, text: `ligne ${i + 1} de ${file}` };
    });
    const used = [...new Set(lines.map((l) => l.sha))];
    return {
      commits: used.map((sha) => {
        const c = commits.find((x) => x.sha === sha);
        return c
          ? { sha, author: c.author, email: c.email, time: c.time, summary: c.subject, filename: file, previous: c.parents[0] ? { sha: c.parents[0], filename: file } : null }
          : { sha, author: "Not Committed Yet", email: "not.committed.yet", time: 0, summary: "", filename: file, previous: null };
      }),
      lines,
      truncated: false,
    };
  },
  async reflog(path, refname) {
    await mockDelay();
    return mockReflog(path, refname);
  },
  async repoAuthors(path) {
    await mockDelay();
    return mockAuthors(path);
  },
  async authorCommits(path, emails) {
    await mockDelay();
    const want = new Set(emails.map((e) => e.toLowerCase()));
    return mockHistory(path).commits.filter((c) => want.has(c.email.toLowerCase())).map((c) => c.sha);
  },
  async blobPreview(_path, side) {
    await mockDelay();
    return mockBlobPreview(side);
  },
  resetTo: async (path, sha, mode) => mockResetTo(path, sha, mode),
  async rangeDiff(_path, _base, tip, file, _oldFile, opts) {
    await mockDelay();
    return mockIgnoreWs(mockDiff(tip, file), opts?.ignoreWs);
  },
  async workStatus(path) {
    return mockStatus(path);
  },
  async workDiff(path, file, _oldFile, area, opts) {
    await mockDelay();
    return mockIgnoreWs(mockWorkDiff(path, file, area), opts?.ignoreWs);
  },
  async stageFiles(path, files) {
    mockStage(path, files, false);
  },
  async conflictVersions(path, file) {
    await mockDelay();
    return mockConflictVersions(path, file);
  },
  async commitIdentity(path) {
    // Profil actif du dépôt, sinon la « config git » simulée.
    const s = mockLoad();
    const active = s.repoProfiles?.[path]?.active;
    const p = active ? s.profiles?.find((x) => x.id === active) : undefined;
    return p ? { name: p.userName, email: p.userEmail } : { name: "Démo", email: "demo@exemple.fr" };
  },
  async conflictSides(path, file) {
    await mockDelay();
    return mockConflictSides(path, file);
  },
  async resolveConflictWith(path, file, choice) {
    await mockDelay();
    mockResolveConflictWith(path, file, choice);
  },
  async resolveConflict(path, file, content) {
    await mockDelay();
    mockResolveConflict(path, file, content);
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
  async addToGitignore(_path, pattern) {
    (window as unknown as { __mockIgnored?: string[] }).__mockIgnored ??= [];
    (window as unknown as { __mockIgnored: string[] }).__mockIgnored.push(pattern);
    return true;
  },
  async untrackFile(_path, file, pattern) {
    (window as unknown as { __mockIgnored?: string[] }).__mockIgnored ??= [];
    (window as unknown as { __mockIgnored: string[] }).__mockIgnored.push(pattern);
    (window as unknown as { __mockUntracked?: string[] }).__mockUntracked ??= [];
    (window as unknown as { __mockUntracked: string[] }).__mockUntracked.push(file);
  },
  async stashAll(path, message) {
    mockStashPush(path, message);
  },
  async stashFiles(path, message, files) {
    mockStashPush(path, message, files);
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
  // Simulé : les commits dont les fichiers (simulés) comprennent ce chemin, parmi les 300 premiers.
  fileCommits: async (path, file) => {
    await mockDelay();
    return mockHistory(path)
      .commits.slice(0, 300)
      .filter((c) => mockDetails(path, c.sha).files.some((f) => f.path === file || f.path.startsWith(`${file}/`)))
      .map((c) => c.sha);
  },
  // Simulé : toujours possible sans checkout, sauf vers une branche dont le nom contient « conflit ».
  cherryPickToBranch: async (_path, branch, shas) => {
    if (branch.includes("conflit")) throw "needs_checkout";
    return shas.length;
  },
  // Simulé : le commit le plus récent est signé et vérifié, les autres non signés.
  commitSignature: async (path, sha) =>
    mockHistory(path).commits[0]?.sha === sha
      ? { status: "good", kind: "ssh", signer: "camille@exemple.fr", key: "SHA256:AbCd" }
      : { status: "none", kind: null, signer: null, key: null },
  rebasePlan: async (path, base) => mockRebasePlan(path, base),
  interactiveRebase: async (path, base, _onto, steps, autoStash) => mockInteractiveRebase(path, base, steps, autoStash),
  listWorktrees: async (path) => mockListWorktrees(path),
  suggestWorktreeDir: async (path, branch) => mockSuggestWorktreeDir(path, branch),
  addWorktree: async (path, dir, o) => mockAddWorktree(path, dir, o),
  removeWorktree: async (path, dir, force) => mockRemoveWorktree(path, dir, force),
  pruneWorktrees: async (path) => mockPruneWorktrees(path),
  bisectState: async (path) => mockBisectState(path),
  bisectMark: async (path, verdict, sha, autoStash) => mockBisectMark(path, verdict, sha, autoStash),
  bisectReset: async (path, autoStash) => mockBisectReset(path, autoStash),
  createBranch: async (path, name, start, checkout, autoStash) => mockCreateBranch(path, name, start, checkout, autoStash),
  renameBranch: async (path, oldName, newName) => mockRenameBranch(path, oldName, newName),
  deleteBranch: async (path, branch, force) => mockDeleteBranch(path, branch, force),
  async deleteRemoteBranch(path, branch) {
    await mockDelay();
    mockDeleteRemoteBranch(path, branch);
  },
  createTag: async (path, name, target) => mockCreateTag(path, name, target),
  deleteTag: async (path, name) => mockDeleteTag(path, name),
  async pushTag(path, name, remote) {
    await mockDelay();
    return mockTagRemote(path, name, remote);
  },
  async deleteRemoteTag(path, name, remote) {
    await mockDelay();
    return mockTagRemote(path, name, remote);
  },
  async fetch(path) {
    await mockDelay();
    mockLastFetch.set(path, Math.floor(Date.now() / 1000));
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
  async pushBranch(path, branch, force, remote) {
    await mockDelay();
    mockPushBranch(path, branch, force, remote);
  },
  async fastForwardBranch(path, branch) {
    await mockDelay();
    return mockFastForward(path, branch);
  },
  setUpstream: async (path, branch, upstream) => mockSetUpstream(path, branch, upstream),
  async mergeBranch(path, branch, autoStash) {
    await mockDelay();
    return mockMergeOrRebase(path, branch, false, autoStash);
  },
  async rebaseOnto(path, branch, autoStash) {
    await mockDelay();
    return mockMergeOrRebase(path, branch, true, autoStash);
  },
  moveBranch: async (path, branch, sha) => mockMoveBranch(path, branch, sha),
  setBranchTip: async (path, branch, expected, target) => mockSetBranchTip(path, branch, expected, target),
  addRemote: async (path, name, url) => mockAddRemote(path, name, url),
  renameRemote: async (path, oldName, newName) => mockRenameRemote(path, oldName, newName),
  setRemoteUrl: async (path, name, url) => mockSetRemoteUrl(path, name, url),
  removeRemote: async (path, name) => mockRemoveRemote(path, name),
  stashPop: async (path) => mockStashPop(path),
  listStashes: async (path) => mockListStashes(path),
  stashApply: async (path, sha, drop) => mockStashApply(path, sha, drop),
  stashDrop: async (path, sha) => mockStashDrop(path, sha),
  stashRename: async (path, sha, message) => mockStashRename(path, sha, message),
  stashChanges: async (path, sha) => mockStashChanges(path, sha),
  async stashBranch(path, sha, name) {
    const base = mockListStashes(path).find((s) => s.sha === sha)?.base;
    if (!base) throw "stash_missing";
    mockCreateBranch(path, name, base, true, false);
    mockStashApply(path, sha, true);
  },
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
    // Simulé : un compte GitHub voit une organisation qui n'a pas approuvé l'application.
    return { repos: mockAccountRepos(found), truncated: false, restricted: found.kind === "github" ? [{ org: "acme-fermee", reason: "oauth" }] : [] };
  },
  // Backend simulé : le compte, puis l'organisation / le groupe « acme ».
  async listAccountNamespaces(account) {
    await mockDelay();
    const found = mockLoad().profiles?.flatMap((p) => p.accounts ?? []).find((a) => a.id === account);
    if (!found) throw "account_not_found";
    if (found.login.startsWith("revoked")) throw "token_invalid";
    if (found.url.includes("injoignable")) throw "provider_unreachable";
    return [
      { id: "", path: found.login, kind: "user" },
      found.kind === "github" ? { id: "acme", path: "acme", kind: "org" } : { id: "42", path: "acme", kind: "group" },
    ];
  },
  // Backend simulé : un nom déjà pris parmi les dépôts du compte donne `repo_exists`.
  async createAccountRepo(account, repo) {
    await mockDelay();
    const found = mockLoad().profiles?.flatMap((p) => p.accounts ?? []).find((a) => a.id === account);
    if (!found) throw "account_not_found";
    if (!validRepoName(repo.name)) throw "invalid_repo_name";
    const owner = repo.namespace ? "acme" : found.login;
    const fullName = `${owner}/${repo.name}`;
    if (mockAccountRepos(found).some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) throw "repo_exists";
    const host = found.url.replace(/^https?:\/\//, "");
    return {
      fullName,
      name: repo.name,
      description: repo.description.trim() || null,
      private: repo.private,
      fork: false,
      archived: false,
      httpUrl: `https://${host}/${fullName}.git`,
      sshUrl: `git@${host}:${fullName}.git`,
      updatedAt: null,
    };
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
      // Simulé : deux modèles nommés (choix de modèle dans la fenêtre).
      templates: [
        { name: "bug", body: "## Bug corrigé\n\n## Comment le reproduire" },
        { name: "feature", body: "## Nouveauté\n\n## Captures" },
      ],
    };
  },
  async remoteDefaultBranch(_kind, _url, _repo, account) {
    if (!account) throw "account_missing";
    return "main";
  },
  // Une branche source dont le nom contient `deja` a déjà sa PR / MR.
  async releaseDraft(path, tag) {
    await mockDelay();
    const h = mockHistory(path);
    if (!h.refs.refs.some((r) => r.kind === "tag" && r.short === tag)) throw "tag_not_found";
    return { previous: "v0.7.0", commits: h.commits.slice(0, 6).map((c) => ({ sha: c.sha, subject: c.subject })) };
  },
  async createRelease(kind, _url, account, request) {
    await mockDelay();
    if (!account) throw "account_missing";
    mockReleases.push({ kind, ...request });
    const url = kind === "github" ? `https://github.com/${request.repo}/releases/tag/${request.tag}` : `https://gitlab.com/${request.repo}/-/releases/${request.tag}`;
    return { url, warnings: kind === "gitlab" && request.draft ? ["release_draft_unsupported"] : [] };
  },
  async ciRuns(_kind, _url, account, _repo, branch) {
    await mockDelay();
    if (!account) throw "account_missing";
    const now = Math.floor(Date.now() / 1000);
    const all: CiRun[] = [
      { id: 301, name: "CI", title: "fix: correctif local pas encore poussé", state: "running", branch: "main", sha: "8a3c45c0000000000000000000000000000000aa", event: "push", url: "https://ci.exemple/301", created: now - 120, updated: now - 30 },
      { id: 300, name: "CI", title: "feat(graph): rendu canvas virtualisé", state: "failure", branch: "feature/graph-rendering", sha: "238d75b0000000000000000000000000000000bb", event: "pull_request", url: "https://ci.exemple/300", created: now - 3600, updated: now - 3500 },
      { id: 299, name: "Nuit", title: null, state: "success", branch: "main", sha: "0e79b4f0000000000000000000000000000000cc", event: "schedule", url: "https://ci.exemple/299", created: now - 86400, updated: now - 86000 },
    ];
    return branch ? all.filter((r) => r.branch === branch) : all;
  },
  async ciRetry() {
    await mockDelay();
  },
  async listIssues(_kind, _url, account, _repo, assignee) {
    await mockDelay();
    if (!account) throw "account_missing";
    return mockIssues.filter((i) => i.state === "open" && (!assignee || i.assignees.some((a) => a.login === assignee)));
  },
  async issueDetail(_kind, _url, _account, _repo, number) {
    await mockDelay();
    const i = mockIssues.find((x) => x.number === number);
    if (!i) throw "issue_not_found";
    return i;
  },
  async issueAction(_kind, _url, _account, _repo, number, action) {
    await mockDelay();
    const i = mockIssues.find((x) => x.number === number);
    if (!i) throw "issue_not_found";
    if (action.type === "comment") {
      i.commentsList = [...i.commentsList, { id: String(i.commentsList.length + 1), author: { id: 7, login: "camille", name: "Camille", avatar: null }, body: action.body, at: Math.floor(Date.now() / 1000) }];
      i.comments = i.commentsList.length;
    } else if (action.type === "close") i.state = "closed";
    else if (action.type === "reopen") i.state = "open";
    else i.assignees = [...i.assignees, { id: 7, login: action.login, name: null, avatar: null }];
  },
  async issueBranchName(number, title, prefix) {
    const slug = title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6).join("-");
    return `${prefix}${slug ? `${number}-${slug}` : number}`;
  },
  async createPull(kind, url, account, request) {
    if (!account) throw "account_missing";
    if (!request.title.trim()) throw "pull_title_missing";
    const existing = request.sourceBranch.includes("deja");
    const number = existing ? 7 : 42;
    const page = kind === "github" ? `pull/${number}` : `-/merge_requests/${number}`;
    const title = kind === "gitlab" && request.draft ? `Draft: ${request.title}` : request.title;
    mockPulls.push(request);
    const warnings = request.reviewers.some((r) => r.login === "auteur") ? ["pull_reviewers_failed"] : [];
    return { number, url: `${url}/${request.targetRepo}/${page}`, title, existing, warnings };
  },
  // Backend simulé : une grosse organisation (300 personnes, dont « camille »), lue en 0,6 s ; le
  // cache est gardé en mémoire, avec la réunion des dépôts d'un même propriétaire.
  async cachedPullOptions(kind, url, repo) {
    const own = mockOptionsCache.get(`${kind}|${url}|${repo.toLowerCase()}`);
    if (own) return own;
    const owner = repo.toLowerCase().split("/").slice(0, -1).join("/");
    const others = [...mockOptionsCache.entries()].filter(([k]) => k.startsWith(`${kind}|${url}|${owner}/`)).map(([, v]) => v);
    if (!others.length) return null;
    return { ...others[0], fetchedAt: Math.min(...others.map((o) => o.fetchedAt)), fromOwner: true };
  },
  async refreshPullOptions(kind, url, repo, account) {
    if (!account) throw "account_missing";
    mockOptionFetches.count += 1;
    await new Promise((r) => setTimeout(r, mockOptionFetches.delay));
    const people = [
      { id: 7, login: "camille", name: "Camille Dupont" },
      { id: 8, login: "auteur", name: "Auteur Refusé" },
      ...Array.from({ length: 298 }, (_, i) => ({ id: 100 + i, login: `dev-${String(i + 1).padStart(3, "0")}`, name: `Développeur ${i + 1}` })),
    ];
    const labels = [
      { name: "bug", color: "d73a4a", description: "Quelque chose ne marche pas" },
      { name: "documentation", color: "0075ca" },
      { name: "enhancement", color: "a2eeef" },
      { name: "urgent", color: "b60205" },
    ];
    const options = { people: people.map((p) => ({ ...p, avatar: `mock:${p.login}` })), labels, fetchedAt: Math.floor(Date.now() / 1000), fromOwner: false, truncated: false };
    mockOptionsCache.set(`${kind}|${url}|${repo.toLowerCase()}`, options);
    return options;
  },
  // Backend simulé : clés tirées du profil enregistré ; aucune n'est sur le compte au départ.
  // Un compte `noscope…` n'a pas les droits sur les clés ; une clé dont le chemin contient
  // `ailleurs` est déjà sur un autre compte.
  // Backend simulé : trois PR / MR par dépôt (cf. mockPulls.ts) ; un dépôt `sans-pr` n'en a pas.
  async listPulls(kind, url, repo, account) {
    if (!account) throw "account_missing";
    await mockDelay();
    return mockListPulls(kind, url, repo);
  },
  async pullDetail(kind, url, repo, number, account) {
    if (!account) throw "account_missing";
    await mockDelay();
    return mockPullDetail(kind, url, repo, number);
  },
  async pullAct(kind, url, repo, number, account, action) {
    if (!account) throw "account_missing";
    await mockDelay();
    mockPullAct(kind, url, repo, number, action);
  },
  async ensurePullHead() {},
  async pullFiles(path, _target, head) {
    return mockPullFiles(path, head);
  },
  async pullFileDiff(_path, _target, head, file, _oldFile, opts) {
    return mockIgnoreWs(mockPullFileDiff(head, file), opts?.ignoreWs);
  },
  async checkoutPull(path, remote, kind, number, branch, fork, autoStash) {
    if (!fork) return this.checkoutRemote(path, `${remote}/${branch}`, autoStash);
    const local = `${kind === "gitlab" ? "mr" : "pr"}/${number}`;
    await this.createBranch(path, local, null, true, autoStash).catch(() => this.checkout(path, local, autoStash));
    return [{ conflicts: [], stashKept: false } as unknown as OpResult, local];
  },
  async personAvatars(_kind, _url, _account, urls) {
    const out: Record<string, string | null> = {};
    for (const u of urls) out[u] = u.startsWith("mock:") ? await this.ownerAvatar("github", "", u.slice(5), null) : null;
    return out;
  },
  // Backend simulé : deux notifications par compte (cf. mockNotifications.ts).
  async pollNotifications(account) {
    return mockPollNotifications(account);
  },
  async markNotificationRead(account, id) {
    mockMarkNotificationRead(account, id);
  },
  async notificationsSeen() {
    return [...mockSeenNotifications];
  },
  async addNotificationsSeen(keys) {
    for (const k of keys) mockSeenNotifications.add(k);
  },
  async systemNotify(title, body) {
    mockSystemNotifications.push({ title, body });
  },
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
  // Mises à jour simulées : les tests choisissent le paquet (`__mockInstallKind`, NSIS par
  // défaut) et la version disponible (`__mockUpdate`, aucune par défaut) ; `__mockUpdateError`
  // fait échouer la vérification ; l'installation note le redémarrage dans `__mockRelaunched`.
  async installKind() {
    return mockWindow().__mockInstallKind ?? "nsis";
  },
  async checkUpdate() {
    await mockDelay();
    const w = mockWindow();
    if (w.__mockUpdateError) throw w.__mockUpdateError;
    return w.__mockUpdate ?? null;
  },
  async downloadUpdate(onProgress) {
    const w = mockWindow();
    if (!w.__mockUpdate) throw "no_update";
    if (w.__mockDownloadError) throw w.__mockDownloadError;
    for (const done of [0, 40, 100]) {
      await mockDelay();
      onProgress(done, 100);
    }
    w.__mockDownloaded = true;
  },
  async installUpdate(onProgress, restart = true) {
    const w = mockWindow();
    if (!w.__mockUpdate) throw "no_update";
    if (!w.__mockDownloaded)
      for (const done of [0, 40, 100]) {
        await mockDelay();
        onProgress(done, 100);
      }
    w.__mockInstalled = true;
    if (restart) w.__mockRelaunched = true;
  },
  async openInEditor(path, file, editor) {
    if (editor.includes("introuvable")) throw "editor_not_found";
    (window as unknown as { __mockOpened?: unknown[] }).__mockOpened ??= [];
    (window as unknown as { __mockOpened: unknown[] }).__mockOpened.push({ path, file, how: `editor:${editor}` });
  },
  async openRepoFile(path, file, how) {
    (window as unknown as { __mockOpened?: unknown[] }).__mockOpened ??= [];
    (window as unknown as { __mockOpened: unknown[] }).__mockOpened.push({ path, file, how });
  },
  // Fermeture simulée : les tests appellent `window.__mockCloseRequested()`.
  window: {
    minimize: async () => {},
    toggleMaximize: async () => {},
    onMaximizedChange: async (cb) => {
      cb(false);
      return () => {};
    },
    startDragging: async () => {},
    close: async () => {},
    hide: async () => {},
    onCloseRequested: async (cb) => {
      mockWindow().__mockCloseRequested = cb;
      return () => {
        mockWindow().__mockCloseRequested = undefined;
      };
    },
  },
};

export const api: Api = inTauri ? tauriApi : mockApi;

/** Normalise une erreur reçue du backend (string ou Error) en code/message. */
export function errorCode(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
