// Providers (GitHub, GitLab) : adresse d'une instance, page de création d'un token, provider et
// compte d'un remote. Fonctions pures (testées dans providers.test.ts).
//
// L'adresse d'instance est lue de la même façon par le backend (src-tauri/src/providers.rs) :
// les deux côtés partagent les cas de providerUrls.cases.json.

import type { Remote } from "./profiles";
import type { Account, Profile, ProviderKind } from "./types";

export const PROVIDERS: ProviderKind[] = ["github", "gitlab"];

export const PROVIDER_NAMES: Record<ProviderKind, string> = { github: "GitHub", gitlab: "GitLab" };

/** Instance par défaut (champ laissé vide). */
export const DEFAULT_HOSTS: Record<ProviderKind, string> = { github: "github.com", gitlab: "gitlab.com" };

export interface Instance {
  /** Adresse de l'instance, sans `/` final (`https://gitlab.exemple.fr`). */
  url: string;
  /** Racine de son API REST. */
  api: string;
}

/** Lit l'adresse saisie : vide → github.com / gitlab.com ; `hôte`, `hôte:port`, `hôte/chemin`
 *  (GitLab sous un sous-chemin) ou une URL `http(s)://…`. Sans schéma : https. `null` : refusée. */
export function instance(kind: ProviderKind, input: string): Instance | null {
  const text = input.trim();
  if (!text) {
    return kind === "github"
      ? { url: "https://github.com", api: "https://api.github.com" }
      : { url: "https://gitlab.com", api: "https://gitlab.com/api/v4" };
  }
  // ASCII imprimable seulement (ni blanc, ni caractère de contrôle, ni accent) ; requête,
  // fragment, utilisateur et `\` refusés.
  if (/[^\x21-\x7e]|[?#@\\]/.test(text)) return null;
  const sep = text.indexOf("://");
  const scheme = sep < 0 ? "https" : text.slice(0, sep).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const rest = sep < 0 ? text : text.slice(sep + 3);
  const slash = rest.indexOf("/");
  const authority = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  const m = authority.match(/^([a-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  let host = m[1].replace(/^www\./, "");
  if (kind === "github" && host === "api.github.com") host = "github.com";
  if (!host) return null;
  const hostPort = m[2] ? `${host}:${m[2]}` : host;
  // GitHub Enterprise n'est jamais sous un sous-chemin : un chemin collé avec l'adresse est ignoré.
  const path = kind === "github" || slash < 0 ? "" : rest.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  const url = `${scheme}://${hostPort}${path ? `/${path}` : ""}`;
  const api = kind === "gitlab" ? `${url}/api/v4` : hostPort === "github.com" ? "https://api.github.com" : `${url}/api/v3`;
  return { url, api };
}

/** Hôte d'une adresse d'instance, sans port (`https://gitlab.exemple.fr:8443/x` → `gitlab.exemple.fr`). */
export const instanceHost = (url: string) => url.replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "").toLowerCase();

/** Adresse affichée d'une instance : sans `https://` (`http://` reste visible). */
export const instanceLabel = (url: string) => url.replace(/^https:\/\//i, "");

/** Droits demandés au token : dépôts et PR / MR, lecture du compte et de ses organisations,
 *  ajout d'une clé SSH et d'une clé de signature. */
const GITHUB_SCOPES = ["repo", "read:user", "read:org", "admin:public_key", "admin:ssh_signing_key", "write:gpg_key"];
const GITLAB_SCOPES = ["api", "read_user"];

/** Page de création d'un token personnel sur cette instance, droits pré-cochés. */
export function tokenPageUrl(kind: ProviderKind, instanceUrl: string): string {
  return kind === "github"
    ? `${instanceUrl}/settings/tokens/new?description=GitGR&scopes=${GITHUB_SCOPES.join(",")}`
    : `${instanceUrl}/-/user_settings/personal_access_tokens?name=GitGR&scopes=${GITLAB_SCOPES.join(",")}`;
}

/** Provider d'un remote, d'après son hôte : github.com / gitlab.com, sinon l'instance d'un compte
 *  connecté (n'importe quel profil), sinon un nom d'hôte parlant (`gitlab.exemple.fr`). */
export function remoteProvider(profiles: Profile[], remote: Remote | null): ProviderKind | null {
  if (!remote) return null;
  const { host } = remote;
  if (host === "github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  for (const p of profiles) {
    const account = p.accounts?.find((a) => instanceHost(a.url) === host);
    if (account) return account.kind;
  }
  if (/(^|\.)github\./.test(host)) return "github";
  if (/(^|\.)gitlab\./.test(host)) return "gitlab";
  return null;
}

/** Compte de l'API pour un remote : celui du profil du remote dont l'instance est sur son hôte. */
export function remoteAccount(profile: Profile | null, remote: Remote | null): Account | null {
  if (!profile || !remote) return null;
  return profile.accounts?.find((a) => instanceHost(a.url) === remote.host) ?? null;
}

/** Propriétaire du dépôt d'un remote (utilisateur, organisation, groupe et sous-groupes) :
 *  le chemin sans son dernier élément ; `null` sans propriétaire. */
export function remoteOwner(remote: Remote | null): string | null {
  const i = remote?.path.lastIndexOf("/") ?? -1;
  return remote && i > 0 ? remote.path.slice(0, i) : null;
}

/** Adresse de l'instance d'un remote, pour son API : celle du compte, sinon celle d'un compte
 *  connecté sur cet hôte (n'importe quel profil), sinon `https://<hôte>`. */
export function remoteInstance(profiles: Profile[], remote: Remote | null, account: Account | null): string | null {
  if (!remote) return null;
  if (account) return account.url;
  for (const p of profiles) {
    const a = p.accounts?.find((x) => instanceHost(x.url) === remote.host);
    if (a) return a.url;
  }
  return `https://${remote.host}`;
}

/** Comptes d'un profil après une connexion : le nouveau remplace celui de la même instance. */
export function withAccount(accounts: Account[] | undefined, account: Account): Account[] {
  return [...(accounts ?? []).filter((a) => !(a.kind === account.kind && a.url === account.url)), account];
}
