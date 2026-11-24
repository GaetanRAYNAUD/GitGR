// Recherche floue (sélecteur rapide de dépôts) : les lettres cherchées apparaissent dans
// l'ordre, pas forcément côte à côte. Score plus haut pour les lettres consécutives, les
// débuts de mot et un texte court.

/** Score de `query` dans `text` (sans tenir compte de la casse), `null` si une lettre manque.
 *  Requête vide : 0 (tout correspond). */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const s = text.toLowerCase();
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (i === prev + 1) score += 3; // consécutive
    if (i === 0 || /[\s/\._-]/.test(s[i - 1])) score += 2; // début de mot
    prev = i;
    from = i + 1;
  }
  // À score égal, le texte le plus court (le plus proche de la requête) d'abord.
  return score - s.length / 1000;
}

/** Éléments qui correspondent, du meilleur au moins bon ; le nom compte plus que le chemin.
 *  Ordre d'origine gardé à score égal (et pour une requête vide). */
export function fuzzyFilter<T>(items: T[], query: string, name: (t: T) => string, path: (t: T) => string): T[] {
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const n = fuzzyScore(query, name(item));
    const p = fuzzyScore(query, path(item));
    if (n === null && p === null) return;
    scored.push({ item, score: Math.max(n === null ? -Infinity : n + 100, p ?? -Infinity), index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((x) => x.item);
}
