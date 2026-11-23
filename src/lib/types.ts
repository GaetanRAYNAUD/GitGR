// Types partagés avec le backend Rust (voir src-tauri/src/*.rs, sérialisés en camelCase).

export interface GitInfo {
  found: boolean;
  version: string | null;
}

/** Paquet par lequel GitGR est installé (cf. `install_kind` côté Rust) : `nsis`, `msi`,
 *  `appimage` et `app` (macOS) se mettent à jour seuls, `deb` / `rpm` par le gestionnaire de
 *  paquets ; `none` : build hors paquet (développement), pas de mise à jour. */
export type InstallKind = "nsis" | "msi" | "appimage" | "deb" | "rpm" | "app" | "none";

/** Version plus récente annoncée par le manifeste de la dernière release. */
export interface UpdateInfo {
  version: string;
  /** Notes de la release (Markdown), si le manifeste en donne. */
  notes: string | null;
  /** Date de publication (RFC 3339). */
  date: string | null;
}

export interface RepoEntry {
  /** Racine du dépôt ; sert aussi d'identifiant. */
  path: string;
  name: string;
  /** Millisecondes depuis l'epoch Unix. */
  lastOpened: number;
  /** Nom affiché choisi dans l'app ; absent = nom du dossier. */
  alias?: string;
  /** Couleur de la pastille d'onglet ; absente = automatique. */
  color?: ColorValue;
}

export interface Session {
  openTabs: string[];
  active: string | null;
}

export type ThemeSetting = "system" | "light" | "dark";
export type LanguageSetting = "system" | "fr" | "en";
/** Fichiers d'un commit : liste à plat ou arborescence des dossiers. */
export type FileViewSetting = "list" | "tree";
/** Diffs : une colonne (inline) ou avant / après côte à côte (split). */
export type DiffViewSetting = "inline" | "split";

export interface Settings {
  theme: ThemeSetting;
  language: LanguageSetting;
  /** Absent dans un état enregistré par une version antérieure. */
  fileView?: FileViewSetting;
  diffView?: DiffViewSetting;
  /** Tailles choisies à la souris, par clé (cf. lib/layout.ts) ; absente = par défaut. */
  layout?: Record<string, number>;
  /** Colonnes masquées dans le graphe. */
  hiddenColumns?: GraphColumn[];
  /** Met les modifications de côté pendant un changement de branche ou un pull (défaut : oui). */
  autoStash?: boolean;
  pullStrategy?: PullStrategy;
  /** Fetch automatique du dépôt actif, en minutes (0 : désactivé ; défaut : 10). */
  autoFetchMinutes?: number;
  /** Couleurs fixes par nom de branche ; absent = règles par défaut. */
  branchColors?: BranchColorRule[];
  /** Couleurs fixes désactivées (les règles sont gardées pour une réactivation). */
  branchColorsOff?: boolean;
  /** Avatars des auteurs masqués dans le graphe (nœuds, colonne Auteur, étiquettes). */
  graphAvatarsOff?: boolean;
  /** Dossier du dernier clone, proposé pour le suivant. */
  cloneDir?: string | null;
  /** Notifications des providers désactivées (aucune lecture). */
  notificationsOff?: boolean;
  /** Notifications du système désactivées (le badge de l'app reste). */
  systemNotificationsOff?: boolean;
  /** Mises à jour seulement annoncées, plus téléchargées en arrière-plan ni installées à la
   *  fermeture (absent : installation automatique). */
  autoUpdateOff?: boolean;
  /** `standard` : 2 min, 10 en arrière-plan ; `fast` : 1 et 5. */
  notificationSpeed?: "standard" | "fast";
}

/** Branches dont le nom correspond à `pattern` (`*` = n'importe quoi) : couleur `color` du graphe. */
export interface BranchColorRule {
  pattern: string;
  color: ColorValue;
}

/** Indice de la palette du graphe (`--g0`…), ou couleur libre `#rrggbb`. */
export type ColorValue = number | string;

/** Pull : avance rapide uniquement, merge, ou rebase. */
export type PullStrategy = "ff-only" | "merge" | "rebase";

/** Colonnes du graphe ; le message est toujours affiché. */
export type GraphColumn = "refs" | "graph" | "author" | "date" | "sha";

/** Préférences d'affichage propres à un dépôt (barre latérale). */
export interface RepoUi {
  /** Sections repliées (`local`, `remote:origin`, `tags`…). */
  collapsed: string[];
  hidden: string[];
  /** Case « pousser après le commit ». */
  pushAfterCommit?: boolean;
}

export interface AppState {
  repos: RepoEntry[];
  session: Session;
  settings: Settings;
  /** Indexé par chemin de dépôt ; absent = valeurs par défaut. */
  repoUi?: Record<string, RepoUi>;
  profiles?: Profile[];
  /** Profils par dépôt (chemin) ; absent = jamais choisi (sélection automatique). */
  repoProfiles?: Record<string, RepoProfiles>;
}

// --- Profils (src-tauri/src/store.rs, profiles.rs) ---------------------------

/** Une identité Git complète, choisie par dépôt. */
export interface Profile {
  id: string;
  /** Nom affiché (« Perso », « Boulot »). */
  name: string;
  userName: string;
  userEmail: string;
  /** Clé SSH privée pour fetch / pull / push (`null` : celle de SSH par défaut). */
  sshKey: string | null;
  /** Sélection automatique : hôtes de remote (`github.com`, `*.exemple.fr`) ou dossiers (`~/work/*`). */
  rules: string[];
  /** Index de couleur de la pastille. */
  color: ColorValue;
  /** Image (data URL, carré de 128 px) affichée à la place des initiales ; absente = aucune. */
  image?: string | null;
  /** Signature des commits ; absent ou "" : la configuration Git décide. */
  signing?: SigningMode;
  /** GPG : identifiant ou empreinte (vide : choisie par gpg d'après l'e-mail).
   *  SSH : fichier de clé (vide : la clé SSH du profil). */
  signingKey?: string | null;
  /** Comptes providers (GitHub, GitLab) liés au profil ; absent = aucun. */
  accounts?: Account[];
}

export type ProviderKind = "github" | "gitlab";

/** Un compte GitHub / GitLab connecté (src-tauri/src/providers.rs). Son token est dans le
 *  trousseau du système, jamais ici. */
export interface Account {
  /** `<kind>|<url>|<login>`. */
  id: string;
  kind: ProviderKind;
  /** Adresse de l'instance (`https://github.com`, `https://gitlab.exemple.fr`). */
  url: string;
  login: string;
  /** Nom affiché sur le provider, s'il est renseigné. */
  name: string | null;
}

/** "" : configuration Git ; "off" : jamais ; "gpg" ; "ssh". */
export type SigningMode = "" | "off" | "gpg" | "ssh";

export interface GpgKey {
  /** Identifiant long. */
  id: string;
  fingerprint: string;
  /** `Nom <e-mail>`. */
  uids: string[];
  /** Expirée ou révoquée. */
  unusable: boolean;
}

/** Profils associés à un dépôt et profil actif (`null` : configuration Git). */
export interface RepoProfiles {
  active: string | null;
  allowed: string[];
  /** Profil choisi à la main pour un remote (clé SSH, compte de l'API), par nom de remote ;
   *  `null` : aucun profil. Absent : celui que désignent les règles sur l'URL du remote, sinon
   *  le profil du dépôt. */
  remotes?: Record<string, string | null>;
}

export interface SshKeyInfo {
  kind: string;
  bits: number;
  fingerprint: string;
  comment: string;
  publicKey: string | null;
  /** Protégée par une phrase de passe. */
  encrypted: boolean;
  /** Sa phrase de passe est dans le trousseau du système (ssh l'obtient par GitGR). */
  passphraseStored: boolean;
}

export interface RepoSummary {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: number;
  remoteUrl: string | null;
}

// --- Historique (src-tauri/src/history.rs) ---------------------------------

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  /** Date d'auteur, en secondes depuis l'epoch Unix. */
  time: number;
  subject: string;
}

export type RefKind = "local" | "remote" | "tag";

export interface GitRef {
  /** Nom complet (`refs/heads/main`). */
  name: string;
  /** Nom affiché (`main`, `origin/main`, `v1.0`). */
  short: string;
  kind: RefKind;
  /** Commit pointé. */
  target: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
}

export interface RefsInfo {
  head: string | null;
  headBranch: string | null;
  refs: GitRef[];
  /** Nombre d'entrées dans la pile de stash. */
  stashes: number;
  /** Dernier stash s'il vient de l'auto-stash (modifications pas encore réappliquées). */
  autostash: AutoStash | null;
  /** Remotes du dépôt (même sans branche récupérée), par ordre alphabétique. */
  remotes: RemoteInfo[];
}

/** Un remote du dépôt (src-tauri/src/remotes.rs). */
export interface RemoteInfo {
  name: string;
  /** URL de fetch ; `null` si le remote n'en a pas. */
  url: string | null;
  /** URL de push, quand elle diffère. */
  pushUrl: string | null;
}

/** Une entrée de la pile de stash (la plus récente d'abord). */
export interface StashEntry {
  sha: string;
  /** Commit sur lequel le stash a été fait. */
  base: string;
  /** `On main: message` ou `WIP on main: abc1234 sujet`. */
  message: string;
  time: number;
}

export interface AutoStash {
  sha: string;
  /** `GitGR-autostash: main` */
  message: string;
}

export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T";

export interface FileChange {
  status: FileStatus;
  path: string;
  oldPath: string | null;
}

/** Ce qui part au push / arrive au pull (`range_changes`). */
export interface RangeChanges {
  /** Départ du diff cumulé (base commune de HEAD et de sa branche suivie). */
  base: string;
  /** Bout de la plage : HEAD (push) ou la branche suivie (pull). */
  tip: string;
  commits: Commit[];
  files: FileChange[];
}

export type RangeDirection = "push" | "pull";

export interface CommitDetails {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  subject: string;
  body: string;
  files: FileChange[];
}

export interface DiffLine {
  kind: "+" | "-" | " ";
  old: number | null;
  new: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  binary: boolean;
  truncated: boolean;
  hunks: Hunk[];
  /** Empreinte du diff brut, renvoyée avec une sélection de lignes (contrôle de fraîcheur). */
  fingerprint: string;
}

// --- Copie de travail (src-tauri/src/worktree.rs) ---------------------------

/** Comme `FileStatus`, plus « ? » (non suivi) et « U » (conflit). */
export type WorkFileStatus = FileStatus | "?" | "U";

export interface StatusFile {
  path: string;
  /** Ancien chemin d'un renommage indexé. */
  oldPath: string | null;
  status: WorkFileStatus;
}

export interface WorkStatus {
  /** HEAD → index. */
  staged: StatusFile[];
  /** Index → copie de travail, fichiers non suivis compris. */
  unstaged: StatusFile[];
  conflicted: StatusFile[];
  /** Opération laissée en cours par git (conflits à résoudre). */
  operation: Operation | null;
  /** Message préparé par git pour terminer un merge. */
  mergeMessage: string | null;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

// --- Branches et réseau (src-tauri/src/branches.rs) --------------------------

export interface OpResult {
  /** Modifications mises de côté puis réappliquées (auto-stash). */
  stashed: boolean;
  /** Le stash n'a pas pu être réappliqué proprement : il est conservé. */
  stashKept: boolean;
  /** L'opération s'est arrêtée sur des conflits (merge / rebase en cours). */
  conflicts: boolean;
}

/** Côté d'un diff de la copie de travail. */
export type DiffArea = "unstaged" | "staged" | "untracked" | "conflicted";

/** Une ligne d'un diff : `FileDiff.hunks[hunk].lines[line]`. */
export interface LineRef {
  hunk: number;
  line: number;
}

/** Connexion OAuth à github.com en cours : code à saisir sur la page de GitHub. */
export interface DeviceStart {
  flowId: number;
  userCode: string;
  verificationUri: string;
  /** Validité du code, en secondes. */
  expiresIn: number;
  /** Délai minimal entre deux demandes du token, en secondes. */
  interval: number;
}

/** Demande du token : compte connecté, sinon toujours en attente (`interval` : nouveau délai). */
export interface DevicePollResult {
  account: Account | null;
  interval: number | null;
}

/** Clé du profil à mettre sur un compte : SSH d'authentification, SSH de signature, GPG. */
export type AccountKeyKind = "auth" | "signing" | "gpg";

/** Clé du profil et sa présence sur le compte (src-tauri/src/providers.rs). */
export interface AccountKey {
  kind: AccountKeyKind;
  /** Empreinte SSH (`SHA256:…`) ou identifiant long GPG. */
  label: string;
  present: boolean;
  /** La clé du profil n'a pas pu être lue. */
  error: string | null;
}

/** Un dépôt d'un compte GitHub / GitLab, à cloner (src-tauri/src/providers.rs). */
export interface ProviderRepo {
  /** `propriétaire/nom` (GitLab : avec les sous-groupes). */
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  httpUrl: string;
  sshUrl: string | null;
  /** Dernière activité (ISO 8601). */
  updatedAt: string | null;
}

/** Où créer un dépôt sur un compte (src-tauri/src/providers.rs). */
export interface Namespace {
  /** GitHub : login de l'organisation (vide pour le compte) ; GitLab : identifiant numérique. */
  id: string;
  /** `moi`, `mon-org`, `groupe/sous-groupe` */
  path: string;
  kind: "user" | "org" | "group";
}

/** Le dépôt à créer (fenêtre « Publier »). */
export interface NewRepo {
  /** `Namespace.id` ; vide : le compte lui-même. */
  namespace: string;
  name: string;
  description: string;
  private: boolean;
}

export interface RepoList {
  repos: ProviderRepo[];
  /** Le compte a plus de dépôts que ceux lus. */
  truncated: boolean;
}

/** Phase d'un clone, telle que git l'écrit. */
export type ClonePhase = "counting" | "compressing" | "receiving" | "resolving" | "checkout";

export interface CloneProgress {
  phase: ClonePhase;
  /** Pourcentage de la phase, s'il est donné. */
  percent: number | null;
}

// --- Pull requests / merge requests (src-tauri/src/pulls.rs) ----------------

export interface DraftCommit {
  subject: string;
  body: string;
}

/** De quoi pré-remplir une PR / MR : commits de la branche absents de la cible, modèle du dépôt. */
export interface PullDraft {
  commits: DraftCommit[];
  template: string | null;
}

/** Demande de création d'une PR / MR. `sourceRepo` / `targetRepo` : `propriétaire/nom`. */
export interface NewPull {
  sourceRepo: string;
  sourceBranch: string;
  targetRepo: string;
  targetBranch: string;
  title: string;
  body: string;
  draft: boolean;
  assignees: Person[];
  reviewers: Person[];
  /** Noms des étiquettes. */
  labels: string[];
}

/** PR / MR créée, ou celle qui existait déjà pour ces branches (`existing`). */
export interface Pull {
  number: number;
  url: string;
  title: string;
  existing: boolean;
  /** Ce qui n'a pas pu être posé après la création (`pull_meta_failed`, `pull_reviewers_failed`). */
  warnings: string[];
}

/** Personne qui peut être assignée ou relire : `login` pour GitHub, `id` pour GitLab. */
export interface Person {
  id: number;
  login: string;
  name?: string | null;
  /** Adresse de l'image (téléchargée à l'affichage, cf. store/avatars). */
  avatar?: string | null;
}

export interface Label {
  name: string;
  /** `rrggbb`, sans `#`. */
  color?: string | null;
  description?: string | null;
}

/** Personnes et étiquettes proposées pour un dépôt (src-tauri/src/pulls.rs, en cache sur disque). */
export interface PullOptions {
  people: Person[];
  labels: Label[];
  /** Lecture sur le provider, en secondes Unix. */
  fetchedAt: number;
  /** Pas encore lues pour ce dépôt : celles des autres dépôts du même propriétaire, en attendant. */
  fromOwner: boolean;
  truncated: boolean;
}

// --- Suivi des PR / MR (src-tauri/src/pull_view.rs) -------------------------

export type PullState = "open" | "draft" | "merged" | "closed";
export type ReviewState = "approved" | "changes" | "required";
export type ChecksState = "success" | "failure" | "pending" | "neutral";

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  state: PullState;
  author: Person | null;
  sourceBranch: string;
  /** Branche source dans un autre dépôt (fork). */
  fork: boolean;
  targetBranch: string;
  headSha: string | null;
  /** Secondes Unix. */
  createdAt: number;
  updatedAt: number;
  review: ReviewState | null;
  checks: ChecksState | null;
  reviewers: Person[];
  assignees: Person[];
  labels: Label[];
}

export interface PullList {
  pulls: PullSummary[];
  fetchedAt: number;
  truncated: boolean;
}

export interface PullReview {
  author: Person;
  state: "approved" | "changes" | "commented" | "pending";
  at: number | null;
}

export interface PullComment {
  id: string;
  author: Person | null;
  body: string;
  at: number;
}

export interface PullThread {
  id: string;
  resolvable: boolean;
  resolved: boolean;
  replyable: boolean;
  path: string | null;
  line: number | null;
  comments: PullComment[];
}

export interface PullCheck {
  name: string;
  state: ChecksState;
  url: string | null;
}

export type MergeBlocker =
  | "not_open"
  | "draft"
  | "conflicts"
  | "behind"
  | "changes"
  | "approvals"
  | "checks"
  | "checks_pending"
  | "threads"
  | "checking"
  | "forbidden"
  | "blocked";

export type MergeMethod = "merge" | "squash" | "rebase";

export interface MergeInfo {
  canMerge: boolean;
  blockers: MergeBlocker[];
  methods: MergeMethod[];
  deleteBranch: boolean;
  /** Absent : pas permis ; sinon s'il est déjà demandé. */
  autoMerge: boolean | null;
}

export interface PullDetail extends PullSummary {
  body: string;
  reviews: PullReview[];
  threads: PullThread[];
  checksList: PullCheck[];
  merge: MergeInfo;
  canUpdate: boolean;
  /** Exécutions (GitHub) / pipeline (GitLab) dont relancer les jobs en échec ; vide : rien à relancer. */
  retry: number[];
}

export type PullAction =
  | { type: "comment"; body: string }
  | { type: "reply"; thread: string; body: string }
  | { type: "resolve"; thread: string; resolved: boolean }
  | { type: "review"; event: "approve" | "changes" | "comment"; body: string }
  | { type: "unapprove" }
  | { type: "setOpen"; open: boolean }
  | { type: "setDraft"; draft: boolean }
  | { type: "merge"; method: MergeMethod; deleteBranch: boolean; auto: boolean }
  | { type: "updateBranch" }
  | { type: "retryFailed"; runs: number[] }
  | { type: "edit"; title: string; body: string; reviewers: Person[]; assignees: Person[]; labels: string[] };
// --- Notifications (src-tauri/src/notifications.rs) -------------------------

export type NotificationReason = "review_requested" | "mention" | "comment" | "assigned" | "approval" | "ci_failed" | "author" | "state" | "other";

export interface Notification {
  /** Identifiant chez le provider. */
  id: string;
  account: string;
  kind: ProviderKind;
  /** Adresse de l'instance. */
  url: string;
  /** `propriétaire/nom`. */
  repo: string;
  subject: "pull" | "issue" | "ci" | "other";
  number: number | null;
  title: string;
  reason: NotificationReason;
  webUrl: string | null;
  /** Secondes Unix. */
  updatedAt: number;
}

export interface NotificationPoll {
  /** `false` : rien de changé depuis la lecture précédente (`items` vide). */
  changed: boolean;
  items: Notification[];
  /** Intervalle minimal demandé par le provider, en secondes. */
  minInterval: number | null;
}
