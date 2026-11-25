// Couleurs fixes par nom de branche (réglage global) : `main` toujours en bleu, etc.
// Les couleurs sont des indices de la palette du graphe (`--g0`…`--g7`).

import { PALETTE_SIZE } from "./graph";
import type { BranchColorRule, ColorValue, RefsInfo } from "./types";

/** Règles utilisées tant que l'utilisateur n'a rien changé. */
export const DEFAULT_BRANCH_COLORS: BranchColorRule[] = [
  { pattern: "main", color: 0 },
  { pattern: "master", color: 0 },
  { pattern: "develop", color: 5 },
  { pattern: "release/*", color: 1 },
  { pattern: "hotfix/*", color: 4 },
];

const NONE: BranchColorRule[] = [];

/** Règles actives : aucune si désactivé, sinon celles choisies (absentes = par défaut). */
export function branchColorRules(rules: BranchColorRule[] | undefined, off?: boolean): BranchColorRule[] {
  return off ? NONE : (rules ?? DEFAULT_BRANCH_COLORS);
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

/** Couleurs libres (`#rrggbb`) des règles, sans doublon, dans l'ordre des règles.
 *  Dans le graphe, la couleur libre n° k a l'indice `PALETTE_SIZE + k`. */
export function customColors(rules: BranchColorRule[]): string[] {
  let list = customCache.get(rules);
  if (!list) {
    list = [...new Set(rules.map((r) => r.color).filter((c): c is string => typeof c === "string"))];
    customCache.set(rules, list);
  }
  return list;
}
const customCache = new WeakMap<BranchColorRule[], string[]>();

/** Indice de couleur du graphe d'une règle (palette, ou couleur libre après la palette). */
function colorIndex(rules: BranchColorRule[], color: number | string): number {
  return typeof color === "number" ? color : PALETTE_SIZE + customColors(rules).indexOf(color);
}

/** Couleur CSS d'un indice de couleur du graphe. */
export function laneCss(index: number, custom: string[]): string {
  return index >= PALETTE_SIZE && custom[index - PALETTE_SIZE] ? custom[index - PALETTE_SIZE] : `var(--g${index % PALETTE_SIZE})`;
}

/** Indice de couleur fixe d'une branche (nom court, sans le remote), ou `undefined`. */
export function fixedColor(rules: BranchColorRule[], branch: string): number | undefined {
  const rule = matchingRule(rules, branch);
  return rule && colorIndex(rules, rule.color);
}

/** Couleur fixe d'une étiquette du graphe : branche locale, ou distante sans son remote. */
export function chipFixedColor(rules: BranchColorRule[], kind: string, label: string): number | undefined {
  if (kind === "tag" || !rules.length) return undefined;
  return fixedColor(rules, ruleName(kind, label));
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

/** Nom d'une branche tel que les règles le comparent : sans le remote pour une distante. */
export function ruleName(kind: string, short: string): string {
  return kind === "remote" ? short.slice(short.indexOf("/") + 1) : short;
}

/** Règle qui donne sa couleur fixe à la branche (la première qui correspond), ou `undefined`. */
export function matchingRule(rules: BranchColorRule[], name: string): BranchColorRule | undefined {
  return rules.find((r) => matches(r.pattern, name));
}

/** Règle au nom exact de la branche (motif sans `*` égal au nom), ou `undefined`. */
export function exactRule(rules: BranchColorRule[], name: string): BranchColorRule | undefined {
  return rules.find((r) => r.pattern === name);
}

/** Couleur fixe pour ce nom exact (clic droit sur une branche). La règle exacte existante
 *  garde sa place si c'est déjà elle qui l'emporte ; sinon (absente, ou cachée derrière un
 *  motif placé avant) elle passe en tête, pour que la couleur choisie se voie. */
export function withExactColor(rules: BranchColorRule[], name: string, color: ColorValue): BranchColorRule[] {
  const first = matchingRule(rules, name);
  if (first?.pattern === name) return rules.map((r) => (r === first ? { ...r, color } : r));
  return [{ pattern: name, color }, ...rules.filter((r) => r.pattern !== name)];
}

/** Retire la règle au nom exact de la branche (les motifs qui la couvrent restent). */
export function withoutExactColor(rules: BranchColorRule[], name: string): BranchColorRule[] {
  return rules.filter((r) => r.pattern !== name);
}
