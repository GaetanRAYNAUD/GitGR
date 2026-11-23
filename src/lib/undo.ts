// Annuler / rétablir (Ctrl+Z / Ctrl+Y) : chaque opération faite par GitGR qui déplace des
// branches locales ou HEAD est notée par l'état des refs avant et après. Annuler = revenir de
// « après » à « avant » ; rétablir = l'inverse. Seulement si le dépôt est encore dans l'état
// de départ (sinon `undo_stale` : il a changé depuis, par une autre commande ou un autre outil).
//
// Les commits « perdus » restent accessibles : rien n'est supprimé, des refs sont déplacées.

import type { RefsInfo } from "./types";

/** Branches locales (nom → commit) et HEAD. */
export interface RefSnapshot {
  head: string | null;
  headBranch: string | null;
  branches: Record<string, string>;
}

export interface UndoEntry {
  /** Clé de traduction de l'opération (`undo.label.*`). */
  label: string;
  before: RefSnapshot;
  after: RefSnapshot;
  /** Un commit : la branche courante revient en arrière avec `reset --soft` (modifications indexées). */
  soft: boolean;
}

export type UndoStep =
  | { kind: "tip"; branch: string | null; expected: string | null; target: string | null; mode: "soft" | "keep" }
  | { kind: "checkout"; branch: string | null; sha: string };

export function snapshot(refs: RefsInfo): RefSnapshot {
  const branches: Record<string, string> = {};
  for (const r of refs.refs) if (r.kind === "local") branches[r.short] = r.target;
  return { head: refs.head, headBranch: refs.headBranch, branches };
}

/** Branches dont le commit diffère (créées ou supprimées comprises). */
export function changedBranches(a: RefSnapshot, b: RefSnapshot): string[] {
  const names = new Set([...Object.keys(a.branches), ...Object.keys(b.branches)]);
  return [...names].filter((n) => a.branches[n] !== b.branches[n]).sort();
}

/** Rien n'a bougé (fetch, push, stash…) : rien à annuler. */
export function unchanged(a: RefSnapshot, b: RefSnapshot): boolean {
  return a.head === b.head && a.headBranch === b.headBranch && changedBranches(a, b).length === 0;
}

/** Le dépôt est-il encore dans l'état `from` pour tout ce que le passage `from → to` touche ? */
export function matches(current: RefSnapshot, from: RefSnapshot, to: RefSnapshot): boolean {
  if (current.headBranch !== from.headBranch || current.head !== from.head) return false;
  return changedBranches(from, to).every((n) => current.branches[n] === from.branches[n]);
}

/** Étapes pour passer de `from` à `to`. Une branche qui n'est pas la courante est déplacée,
 *  créée ou supprimée directement ; la courante (ou HEAD détachée) passe par `reset` ; un
 *  changement de branche courante, par un checkout, entre les deux. */
export function plan(from: RefSnapshot, to: RefSnapshot, soft: boolean): UndoStep[] {
  const changed = changedBranches(from, to);
  const tip = (n: string, mode: "soft" | "keep" = "keep"): UndoStep => ({
    kind: "tip",
    branch: n,
    expected: from.branches[n] ?? null,
    target: to.branches[n] ?? null,
    mode,
  });
  const mode = soft ? "soft" : "keep";
  const sameBranch = from.headBranch === to.headBranch && from.headBranch !== null;
  if (sameBranch) return changed.map((n) => tip(n, n === from.headBranch ? mode : "keep"));
  if (from.headBranch === null && to.headBranch === null) {
    // HEAD détachée des deux côtés : elle se déplace comme une branche.
    const others = changed.map((n) => tip(n));
    if (from.head === to.head || !from.head || !to.head) return others;
    return [...others, { kind: "tip", branch: null, expected: from.head, target: to.head, mode }];
  }
  const current = from.headBranch;
  const steps = changed.filter((n) => n !== current).map((n) => tip(n));
  steps.push({ kind: "checkout", branch: to.headBranch, sha: to.head ?? "" });
  if (current && changed.includes(current)) steps.push(tip(current));
  return steps;
}
