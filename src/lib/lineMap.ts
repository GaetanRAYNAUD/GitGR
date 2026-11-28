// Ligne d'un fichier dans la version précédente d'un commit (fonction pure, testée dans
// lineMap.test.ts) : pour garder la ligne regardée en remontant le blame.

import type { FileDiff } from "./types";

/** `@@ -a,b +c,d @@` → [a, b, c, d] (un nombre absent vaut 1). */
function hunkRange(header: string): [number, number, number, number] | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!m) return null;
  return [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/** Numéro (1 = la première) de la ligne `n` de la nouvelle version dans l'ancienne, d'après
 *  le diff du commit : décalée par les blocs au-dessus ; une ligne ajoutée ou modifiée tombe
 *  sur la première ligne retirée de son bloc, sinon sur la ligne d'avant le bloc. */
export function lineBefore(diff: FileDiff, n: number): number {
  let shift = 0;
  for (const h of diff.hunks) {
    const r = hunkRange(h.header);
    if (!r) continue;
    const [oldStart, oldCount, newStart, newCount] = r;
    // Un bloc qui n'ajoute rien commence après sa ligne d'ancrage (`+c,0`).
    const newFirst = newCount === 0 ? newStart + 1 : newStart;
    if (n < newFirst) break;
    if (n < newFirst + newCount) {
      const line = h.lines.find((l) => l.new === n);
      if (line?.old != null) return line.old;
      const removed = h.lines.find((l) => l.kind === "-");
      if (removed?.old != null) return removed.old;
      return Math.max(1, oldCount === 0 ? oldStart : oldStart - 1);
    }
    // Première ligne après le bloc, des deux côtés (un côté vide a pour ancrage la ligne d'avant).
    const oldEnd = oldCount === 0 ? oldStart + 1 : oldStart + oldCount;
    const newEnd = newCount === 0 ? newStart + 1 : newStart + newCount;
    shift = oldEnd - newEnd;
  }
  return Math.max(1, n + shift);
}
