// Types partagés avec le backend Rust (voir src-tauri/src/*.rs, sérialisés en camelCase).

export interface GitInfo {
  found: boolean;
  version: string | null;
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
  /** Dossier du dernier clone, proposé pour le suivant. */
  cloneDir?: string | null;
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
