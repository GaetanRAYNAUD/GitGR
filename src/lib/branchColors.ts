// Couleurs fixes par nom de branche (réglage global) : `main` toujours en bleu, etc.
// Les couleurs sont des indices de la palette du graphe (`--g0`…`--g7`).

import type { BranchColorRule, RefsInfo } from "./types";

/** Règles utilisées tant que l'utilisateur n'a rien changé. */
export const DEFAULT_BRANCH_COLORS: BranchColorRule[] = [
  { pattern: "main", color: 0 },
  { pattern: "master", color: 0 },
  { pattern: "develop", color: 5 },
  { pattern: "release/*", color: 1 },
  { pattern: "hotfix/*", color: 4 },
];

/** Règles actives : absentes = règles par défaut ; liste vide = désactivé. */
export function branchColorRules(rules: BranchColorRule[] | undefined): BranchColorRule[] {
  return rules ?? DEFAULT_BRANCH_COLORS;
}

/** Motif simple : `*` remplace n'importe quelle suite de caractères. */
function matches(pattern: string, name: string): boolean {
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    compiled.set(pattern, re);
  }
  return re.test(name);
}

/** Motifs déjà compilés (quelques règles, appelées à chaque rendu des étiquettes). */
const compiled = new Map<string, RegExp>();

/** Couleur fixe d'une branche (nom court, sans le remote), ou `undefined`. */
export function fixedColor(rules: BranchColorRule[], branch: string): number | undefined {
  return rules.find((r) => matches(r.pattern, branch))?.color;
}

/** Couleur fixe d'une étiquette du graphe : branche locale, ou distante sans son remote. */
export function chipFixedColor(rules: BranchColorRule[], kind: string, label: string): number | undefined {
  if (kind === "tag" || !rules.length) return undefined;
  const name = kind === "remote" ? label.slice(label.indexOf("/") + 1) : label;
  return fixedColor(rules, name);
}

/** Couleur fixe par commit : celle de la première branche (locale d'abord) qui y pointe. */
export function fixedColorsByCommit(rules: BranchColorRule[], info: RefsInfo | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!info || !rules.length) return out;
  const refs = [...info.refs.filter((r) => r.kind === "local"), ...info.refs.filter((r) => r.kind === "remote")];
  for (const r of refs) {
    if (out.has(r.target)) continue;
    const c = chipFixedColor(rules, r.kind, r.short);
    if (c !== undefined) out.set(r.target, c);
  }
  return out;
}
