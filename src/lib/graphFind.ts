// Recherche dans le graphe (Ctrl+F) : quels commits chargés correspondent au texte saisi.

/** Champs d'un commit consultés par la recherche. */
export interface Findable {
  sha: string;
  subject: string;
  author: string;
  email: string;
}

/** Texte cherché normalisé (`null` : rien à chercher). */
export function findQuery(text: string): string | null {
  const q = text.trim().toLowerCase();
  return q ? q : null;
}

/** Le commit correspond-il ? Sujet, auteur ou e-mail qui contiennent le texte (sans tenir
 *  compte de la casse), ou SHA qui commence par lui (4 caractères hexadécimaux au moins). */
export function commitMatches(c: Findable, q: string): boolean {
  if (q.length >= 4 && /^[0-9a-f]+$/.test(q) && c.sha.startsWith(q)) return true;
  return c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
}

/** Prochain résultat après `from` dans le sens `dir` (en boucle) ; `from` à -1 : le premier
 *  (ou le dernier en remontant). `matches` est trié. `null` s'il n'y en a aucun. */
export function nextMatch(matches: number[], from: number, dir: 1 | -1): number | null {
  if (matches.length === 0) return null;
  if (dir === 1) return matches.find((i) => i > from) ?? matches[0];
  for (let k = matches.length - 1; k >= 0; k--) if (matches[k] < from || from < 0) return matches[k];
  return matches[matches.length - 1];
}
