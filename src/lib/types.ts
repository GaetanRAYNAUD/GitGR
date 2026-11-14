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
}

/** Colonnes du graphe ; le message est toujours affiché. */
export type GraphColumn = "refs" | "graph" | "author" | "date" | "sha";

/** Préférences d'affichage propres à un dépôt (barre latérale). */
export interface RepoUi {
  /** Sections repliées (`local`, `remote:origin`, `tags`…). */
  collapsed: string[];
  hidden: string[];
}

export interface AppState {
  repos: RepoEntry[];
  session: Session;
  settings: Settings;
  /** Indexé par chemin de dépôt ; absent = valeurs par défaut. */
  repoUi?: Record<string, RepoUi>;
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
}

/** Côté d'un diff de la copie de travail. */
export type DiffArea = "unstaged" | "staged" | "untracked" | "conflicted";

/** Une ligne d'un diff : `FileDiff.hunks[hunk].lines[line]`. */
export interface LineRef {
  hunk: number;
  line: number;
}
