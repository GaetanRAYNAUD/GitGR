// Sélection de plusieurs commits dans le graphe (Ctrl+clic, Maj+clic) : ordre, plage, et ce
// que l'on peut en montrer (fonctions pures, testées dans multiSelect.test.ts).

import { EMPTY_TREE } from "./stashes";

interface Node {
  sha: string;
  parents: string[];
}

/** Ce que montre une sélection de commits. */
export type Comparison =
  /** Plage contiguë (chaque commit est un parent du précédent) : cumul de `base` à `tip`. */
  | { kind: "chain"; base: string; tip: string }
  /** Deux commits quelconques : de l'un (le plus ancien dans le graphe) à l'autre. */
  | { kind: "pair"; base: string; tip: string }
  /** Sélection éparse : seulement la liste des commits. */
  | { kind: "sparse" };

/** Commits choisis, dans l'ordre du graphe (du plus récent au plus ancien). */
export function orderPicked<T extends Node>(commits: T[], picked: readonly string[]): T[] {
  const set = new Set(picked);
  return commits.filter((c) => set.has(c.sha));
}

/** Commits du graphe entre `a` et `b` inclus (dans un sens ou dans l'autre). */
export function rangeShas(commits: Node[], a: string, b: string): string[] {
  const i = commits.findIndex((c) => c.sha === a);
  const j = commits.findIndex((c) => c.sha === b);
  if (i < 0 || j < 0) return [b];
  const [from, to] = i < j ? [i, j] : [j, i];
  return commits.slice(from, to + 1).map((c) => c.sha);
}

/** `ordered` : commits choisis dans l'ordre du graphe (cf. `orderPicked`). */
export function compareOf(ordered: Node[]): Comparison {
  if (ordered.length < 2) return { kind: "sparse" };
  const chain = ordered.every((c, i) => i === ordered.length - 1 || c.parents.includes(ordered[i + 1].sha));
  if (chain) {
    const oldest = ordered[ordered.length - 1];
    return { kind: "chain", base: oldest.parents[0] ?? EMPTY_TREE, tip: ordered[0].sha };
  }
  if (ordered.length === 2) return { kind: "pair", base: ordered[1].sha, tip: ordered[0].sha };
  return { kind: "sparse" };
}

/** Squash possible : au moins deux commits sans merge, chacun premier parent du précédent
 *  (`ordered` : dans l'ordre du graphe). Le reste (sur la branche courante…) est vérifié par git. */
export function squashable(ordered: Node[]): boolean {
  return ordered.length > 1 && ordered.every((c, i) => c.parents.length === 1 && (i === ordered.length - 1 || c.parents[0] === ordered[i + 1].sha));
}
