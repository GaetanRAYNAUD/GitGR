// Tailles réglables à la souris (cf. Splitter), enregistrées dans `settings.layout` par clé.
// Une clé absente = taille par défaut (celle du CSS).

import type { GraphColumn } from "./types";
import { useApp } from "../store/app";

export const LAYOUT = {
  /** Largeur de la barre latérale (px). */
  sidebar: "sidebar",
  /** Largeur du panneau de droite (px). */
  panel: "panel",
  /** Diff côte à côte : part de la largeur donnée au texte de gauche (0–1). */
  diffSplit: "diffSplit",
  /** Bloc message + auteur dans les détails d'un commit (px). */
  details: "h:details",
} as const;

/** Largeur d'une colonne du graphe (px). */
export const colKey = (c: GraphColumn) => `col:${c}`;
/** Hauteur d'une section repliable (barre latérale, panneau des modifications), en px. */
export const sectionKey = (section: string) => `h:${section}`;

/** Bornes des tailles, pour ne jamais rendre un panneau inutilisable. */
export const LIMITS = {
  sidebar: [140, 480],
  panel: [240, 640],
  column: [40, 480],
  section: [48, 2000],
  diffSplit: [0.15, 0.85],
} as const satisfies Record<string, readonly [number, number]>;

export const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));

/** Largeur d'une colonne de numéros en vue côte à côte (cf. `.diff-table.split .col-ln`). */
export const DIFF_LN_W = 52;
/** Largeur minimale laissée au texte de chaque côté du diff côte à côte. */
const DIFF_MIN_CODE = 60;

/** Bornes du partage du diff côte à côte pour une table de `width` px : chaque côté garde au
 *  moins `DIFF_MIN_CODE` px de texte, en plus des deux colonnes de numéros. */
export function diffSplitBounds(width: number): [number, number] {
  if (width <= 0) return [...LIMITS.diffSplit];
  const lo = Math.max(LIMITS.diffSplit[0], DIFF_MIN_CODE / width);
  const hi = Math.min(LIMITS.diffSplit[1], (width - 2 * DIFF_LN_W - DIFF_MIN_CODE) / width);
  return hi < lo ? [lo, lo] : [lo, hi];
}

/** Style d'un panneau dont la largeur a été choisie (barre latérale, panneau de droite). */
export function useWidthStyle(key: string): { width: number } | undefined {
  const width = useLayoutValue(key);
  return width !== undefined ? { width } : undefined;
}

/** Taille enregistrée pour `key`, ou `undefined` (taille par défaut). */
export function useLayoutValue(key: string): number | undefined {
  return useApp((s) => s.settings.layout?.[key]);
}
