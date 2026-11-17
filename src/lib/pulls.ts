// PR / MR : branches source et cible d'après les refs du dépôt, et texte pré-rempli
// (fonctions pures, testées dans pulls.test.ts).

import { remoteOfShort } from "./refs";
import type { DraftCommit, GitRef, RefsInfo } from "./types";

const remoteNames = (refs: RefsInfo) => [
  ...new Set([...refs.remotes.map((r) => r.name), ...refs.refs.filter((r) => r.kind === "remote").map((r) => r.short.slice(0, r.short.indexOf("/")))]),
];

/** Branche source : la locale, et où elle est (ou sera) poussée. */
export interface PullSource {
  branch: string;
  /** Remote de sa branche suivie ; sans suivi : `origin`, sinon le premier remote. */
  remote: string | null;
  /** Nom de la branche sur ce remote. */
  remoteBranch: string;
  /** À pousser d'abord : pas de suivi, branche suivie disparue, ou commits pas encore poussés. */
  needsPush: boolean;
}

export function pullSource(refs: RefsInfo, branch: string): PullSource | null {
  const local = refs.refs.find((r) => r.kind === "local" && r.short === branch);
  if (!local) return null;
  const names = remoteNames(refs);
  const remote = remoteOfShort(local.upstream, names);
  if (remote && local.upstream) {
    // Suivi disparu sur le serveur : le push recrée la même branche distante (suivi gardé).
    return { branch, remote, remoteBranch: local.upstream.slice(remote.length + 1), needsPush: local.gone || local.ahead > 0 };
  }
  const fallback = names.includes("origin") ? "origin" : (refs.remotes[0]?.name ?? null);
  return { branch, remote: remote ?? fallback, remoteBranch: branch, needsPush: true };
}

/** Cible sur un remote. */
export interface PullTarget {
  remote: string;
  branch: string;
}

/** Cible désignée par une ref (clic droit) : une distante, ou la branche suivie d'une locale. */
export function pullTargetOf(refs: RefsInfo, r: GitRef): PullTarget | null {
  const short = r.kind === "remote" ? r.short : r.kind === "local" && !r.gone ? r.upstream : null;
  const remote = remoteOfShort(short, remoteNames(refs));
  if (!short || !remote) return null;
  const branch = short.slice(remote.length + 1);
  // `origin/HEAD` n'est pas une branche.
  return branch && branch !== "HEAD" ? { remote, branch } : null;
}

/** Titre tiré du nom de la branche, comme le fait GitHub : `feature/mon-ajout` → « Feature/mon ajout ». */
export function branchTitle(branch: string): string {
  const text = branch.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Titre et description pré-remplis : un seul commit → son message ; sinon le nom de la branche
 *  et la liste des commits. Le modèle du dépôt, s'il y en a un, remplace la description. */
export function draftText(commits: DraftCommit[], branch: string, template: string | null): { title: string; body: string } {
  const one = commits.length === 1 ? commits[0] : null;
  const title = one ? one.subject : branchTitle(branch);
  const body = template ?? (one ? one.body : commits.map((c) => `- ${c.subject}`).join("\n"));
  return { title, body };
}
