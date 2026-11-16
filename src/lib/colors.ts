// Couleurs choisies par l'utilisateur : indice de la palette du graphe (`--g0`…) ou `#rrggbb`.

import { PALETTE_SIZE } from "./graph";
import type { ColorValue } from "./types";

/** Couleur CSS d'une valeur : indice de palette ou `#rrggbb`. */
export function colorCss(color: ColorValue): string {
  return typeof color === "number" ? `var(--g${Math.abs(color) % PALETTE_SIZE})` : color;
}
