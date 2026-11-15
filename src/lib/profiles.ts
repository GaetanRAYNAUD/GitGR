// Profils : règles de sélection automatique (remote du dépôt, dossier du dépôt) et petites
// fonctions pures (testées dans profiles.test.ts).

import type { Profile } from "./types";

/** Nombre de couleurs de pastille (`--l0` … `--l3`). */
export const PROFILE_COLORS = 4;

export const profileColor = (p: Pick<Profile, "color">) => `var(--l${Math.abs(p.color) % PROFILE_COLORS})`;

/** Une règle est un dossier si elle commence par `~`, `/`, `\` ou une lettre de lecteur (`C:`),
 *  ou contient un `\` ; sinon c'est un remote : un hôte, suivi ou non d'un chemin
 *  (`github.com`, `github.com/mon-org/*`). */
export function ruleKind(rule: string): "remote" | "folder" {
  return /^(~|[\\/]|[a-z]:)|\\/i.test(rule.trim()) ? "folder" : "remote";
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** `/` partout, sans `/` final. */
const normalize = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/+$/, "");

export interface Remote {
  /** En minuscules, sans `www.`. */
  host: string;
  /** Chemin sur le serveur, en minuscules, sans `/` autour ni `.git` : `mon-org/mon-depot`. */
  path: string;
}

/** Hôte et chemin d'une URL de remote (https://…, ssh://user@hôte:port/…, git@hôte:…) ;
 *  `null` pour un chemin local. */
export function parseRemote(url: string | null): Remote | null {
  if (!url) return null;
  const u = url.trim();
  const m =
    u.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?(?:\/(.*))?$/i) ??
    // Syntaxe scp `[user@]hôte:chemin` (hôte de 2 caractères au moins : pas `C:\…`).
    u.match(/^(?:[^@/\\]+@)?([^/:\\]{2,}):(?!\/)(.*)$/);
  if (!m || m[1].toLowerCase() === "file") return null;
  const host = m[1].toLowerCase().replace(/^www\./, "");
  const path = (m[2] ?? "").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase();
  return { host, path };
}

/** `github.com/mon-org/mon-depot` (affichage). */
export const remoteLabel = (r: Remote) => (r.path ? `${r.host}/${r.path}` : r.host);

/** L'hôte correspond-il ? `*` : n'importe quelle suite de caractères (`*.exemple.fr`) ; `www.` ignoré. */
export function matchHost(rule: string, host: string): boolean {
  const pattern = rule.trim().toLowerCase().replace(/^www\./, "");
  if (!pattern || !host) return false;
  const re = new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`);
  return re.test(host.toLowerCase().replace(/^www\./, ""));
}

/** Motif de chemin : ce chemin ou un de ses sous-chemins. `*` : un nom quelconque (sans `/`),
 *  `**` : n'importe quoi ; `/*` ou `/**` final facultatif. */
function pathRegExp(pattern: string, flags: string): RegExp | null {
  const p = pattern.replace(/(\/\*\*?)+$/, "");
  if (!p) return null;
  const source = p
    .split("/")
    .map((part) => (part === "**" ? ".*" : part.split("*").map(escape).join("[^/]*")))
    .join("/");
  return new RegExp(`^${source}(/.*)?$`, flags);
}

/** Le remote correspond-il à cette règle ? `github.com`, `*.exemple.fr`, `github.com/mon-org/*`,
 *  `https://www.github.com/mon-org`, `git@github.com:mon-org` : schéma, utilisateur, port et
 *  `www.` ignorés, casse ignorée (GitHub et GitLab ne distinguent pas les majuscules). */
export function matchRemote(rule: string, remote: Remote | null): boolean {
  if (!remote) return false;
  const r = rule
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]+@/, "")
    // `hôte:chemin` (scp) → `hôte/chemin` ; un port (`hôte:2222/…`) est retiré.
    .replace(/^([^/:]+):(\d+)(?=\/|$)/, "$1")
    .replace(/^([^/:]+):/, "$1/")
    .replace(/\.git$/, "");
  const slash = r.indexOf("/");
  const hostPattern = slash < 0 ? r : r.slice(0, slash);
  const pathPattern = slash < 0 ? "" : r.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  if (!matchHost(hostPattern, remote.host)) return false;
  const re = pathPattern ? pathRegExp(pathPattern, "") : null;
  return re ? re.test(remote.path) : true;
}

/** Le dépôt est-il dans ce dossier (ou un de ses sous-dossiers) ? `~` : dossier personnel ;
 *  `*` : un nom de dossier quelconque ; `/*` ou `/**` final : facultatif. */
export function matchFolder(rule: string, repoPath: string, home: string | null): boolean {
  let folder = normalize(rule);
  if (folder === "~" || folder.startsWith("~/")) {
    if (!home) return false;
    folder = normalize(home) + folder.slice(1);
  }
  const path = normalize(repoPath);
  if (!folder || !path) return false;
  // Chemins Windows (`C:/…`) : la casse ne compte pas.
  return pathRegExp(folder, /^[a-z]:\//i.test(path) ? "i" : "")?.test(path) ?? false;
}

export interface RuleContext {
  path: string;
  /** Remote `origin`, `null` s'il n'y en a pas (ou si c'est un chemin local). */
  remote: Remote | null;
  home: string | null;
}

/** Score d'une règle (0 : ne correspond pas). Un dossier l'emporte sur un remote ; à égalité de
 *  type, la règle la plus précise (la plus longue : `github.com/mon-org` avant `github.com`). */
export function ruleScore(rule: string, ctx: RuleContext): number {
  if (ruleKind(rule) === "folder") return matchFolder(rule, ctx.path, ctx.home) ? 2000 + rule.length : 0;
  return matchRemote(rule, ctx.remote) ? 1000 + rule.length : 0;
}

const profileScore = (p: Profile, ctx: RuleContext) => Math.max(0, ...p.rules.map((r) => ruleScore(r, ctx)));

/** Profil à proposer pour ce dépôt, d'après les règles ; le premier à égalité. */
export function suggestProfile(profiles: Profile[], ctx: RuleContext): Profile | null {
  let best: Profile | null = null;
  let score = 0;
  for (const p of profiles) {
    const s = profileScore(p, ctx);
    if (s > score) [best, score] = [p, s];
  }
  return best;
}

/** Garde-fou avant un commit ou un push : un autre profil correspond au remote mieux que le
 *  profil actif (l'actif ne correspond pas, ou moins précisément : `github.com` face à
 *  `github.com/mon-org`). Renvoie cet autre profil, sinon `null`. Un profil actif désigné par un
 *  dossier (choix de la sélection automatique) l'emporte sur toute règle de remote. */
export function hostMismatch(profiles: Profile[], activeId: string | null, ctx: RuleContext): Profile | null {
  const active = profiles.find((p) => p.id === activeId);
  if (!active || !ctx.remote) return null;
  const remoteRules = (p: Profile) => p.rules.filter((r) => ruleKind(r) === "remote");
  const others = profiles.filter((p) => p.id !== active.id).map((p) => ({ ...p, rules: remoteRules(p) }));
  const best = suggestProfile(others, ctx);
  if (!best || profileScore(best, ctx) <= profileScore(active, ctx)) return null;
  return profiles.find((p) => p.id === best.id) ?? null;
}

/** Nom de fichier tiré d'un nom de profil : « Équipe Boulot » → `equipe_boulot`. */
export function slug(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "profil";
}

/** Chemin proposé pour une nouvelle clé : `~/.ssh/gitgr_<profil>_ed25519`. */
export function defaultKeyPath(home: string | null, name: string): string {
  return `${home ? normalize(home) : "~"}/.ssh/gitgr_${slug(name)}_ed25519`;
}

/** Dossier des clés SSH (sélecteur de fichier). */
export const sshDir = (home: string | null) => (home ? `${normalize(home)}/.ssh` : null);

/** Identifiant d'un nouveau profil. */
export function newProfileId(): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `p-${rand}`;
}

/** Première couleur pas encore prise (ou la moins utilisée). */
export function nextColor(profiles: Profile[]): number {
  const used = new Array(PROFILE_COLORS).fill(0);
  for (const p of profiles) used[Math.abs(p.color) % PROFILE_COLORS] += 1;
  return used.indexOf(Math.min(...used));
}

/** Adresse e-mail plausible (un `@` entre deux parties non vides, sans espace). */
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+$/.test(email.trim());

/** Signature SSH sans clé (ni clé de signature, ni clé SSH du profil) : impossible. */
export const signingKeyMissing = (p: Profile) => p.signing === "ssh" && !p.signingKey?.trim() && !p.sshKey?.trim();

/** Profil complet : nom, `user.name`, e-mail valide, et de quoi signer si la signature SSH est choisie. */
export const profileComplete = (p: Profile) =>
  !!p.name.trim() && !!p.userName.trim() && validEmail(p.userEmail) && !signingKeyMissing(p);

/** Adresse e-mail d'un uid GPG (`Nom <e-mail>`), en minuscules. */
export const uidEmail = (uid: string) => (uid.match(/<([^>]+)>/)?.[1] ?? uid).trim().toLowerCase();
