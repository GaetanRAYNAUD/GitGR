// Fenêtre de clone : nom de dossier tiré de l'URL, chemin de destination, URL d'un dépôt de
// compte (ssh ou https), avancement global.

import type { CloneProgress, ProviderRepo } from "./types";

/** Nom de dossier proposé pour une URL : dernier élément du chemin, sans `.git`
 *  (`git@github.com:moi/depot.git` → `depot`). Vide si l'URL n'en donne pas. */
export function repoNameFromUrl(url: string): string {
  const path = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/[\\/]+$/, "");
  // Une adresse sans chemin (`https://github.com/`) ne donne pas de nom.
  if (/^[a-z][\w+.-]*:\/\/[^/]*$/i.test(path)) return "";
  const last = path.split(/[\\/:]/).pop() ?? "";
  const name = last.replace(/\.git$/i, "");
  return validFolderName(name) ? name : "";
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Même règle que le backend (`clone::valid_folder_name`) : valable sous Windows et Linux. */
export function validFolderName(name: string): boolean {
  if (!name || name === "." || name === ".." || name.trim() !== name || name.endsWith(".")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return false;
  return !RESERVED.test(name.split(".")[0].trim());
}

/** `parent` + `name`, avec le séparateur déjà employé dans `parent`. */
export function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${sep}${name}`;
}

/** URL à cloner pour un dépôt de compte : ssh quand c'est demandé et que le provider la donne. */
export function repoUrl(repo: ProviderRepo, ssh: boolean): string {
  return ssh && repo.sshUrl ? repo.sshUrl : repo.httpUrl;
}

/** Part de chaque phase dans l'avancement global : la réception domine. */
const SPANS: Record<CloneProgress["phase"], [number, number]> = {
  counting: [0, 5],
  compressing: [5, 10],
  receiving: [10, 80],
  resolving: [80, 95],
  checkout: [95, 100],
};

/** Avancement global (0–100) d'après la phase en cours et son pourcentage. */
export function overallPercent(p: CloneProgress): number {
  const [from, to] = SPANS[p.phase];
  return Math.round(from + ((to - from) * (p.percent ?? 0)) / 100);
}

/** Les dépôts dont le nom, le propriétaire ou la description contiennent tous les mots cherchés. */
export function filterRepos(repos: ProviderRepo[], query: string): ProviderRepo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return repos;
  return repos.filter((r) => {
    const text = `${r.fullName} ${r.description ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Propriétaire d'un dépôt : l'utilisateur ou l'organisation (GitLab : groupe et sous-groupes). */
export const repoOwner = (r: ProviderRepo) => r.fullName.slice(0, Math.max(0, r.fullName.lastIndexOf("/")));

/** Nom du dépôt sans son propriétaire (affiché sous l'en-tête du propriétaire). */
export const repoShortName = (r: ProviderRepo) => r.fullName.slice(r.fullName.lastIndexOf("/") + 1);

export interface OwnerGroup {
  owner: string;
  repos: ProviderRepo[];
}

/** Dépôts rangés par propriétaire : le compte lui-même d'abord, puis les organisations / groupes
 *  dans l'ordre de leur dépôt le plus récemment actif (celui de la liste, déjà triée). */
export function groupByOwner(repos: ProviderRepo[], login: string): OwnerGroup[] {
  // Casse ignorée (GitHub ne la distingue pas) ; le premier nom rencontré est affiché.
  const groups = new Map<string, OwnerGroup>();
  for (const r of repos) {
    const owner = repoOwner(r);
    const group = groups.get(owner.toLowerCase());
    if (group) group.repos.push(r);
    else groups.set(owner.toLowerCase(), { owner, repos: [r] });
  }
  const out = [...groups.values()];
  const mine = (g: OwnerGroup) => g.owner.toLowerCase() === login.toLowerCase();
  return [...out.filter(mine), ...out.filter((g) => !mine(g))];
}
