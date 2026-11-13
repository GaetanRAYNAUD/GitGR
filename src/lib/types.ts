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

export interface Settings {
  theme: ThemeSetting;
  language: LanguageSetting;
}

export interface AppState {
  repos: RepoEntry[];
  session: Session;
  settings: Settings;
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
