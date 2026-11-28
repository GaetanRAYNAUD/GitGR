// Fetch en arrière-plan des onglets qui ne sont pas affichés (fonction pure, testée dans
// autoFetch.test.ts).

/** Onglet à récupérer maintenant : pas celui affiché, pas occupé, le plus anciennement récupéré
 *  parmi ceux dont le dernier fetch date d'au moins `everyMs`. `null` : aucun. */
export function dueTab(tabs: string[], active: string | null, busy: (p: string) => boolean, last: (p: string) => number, now: number, everyMs: number): string | null {
  let best: string | null = null;
  for (const p of tabs) {
    if (p === active || busy(p) || now - last(p) < everyMs) continue;
    if (best === null || last(p) < last(best)) best = p;
  }
  return best;
}
