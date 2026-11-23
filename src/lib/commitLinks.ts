// Liens dans un message de commit : adresses, SHA, références de PR / MR / issue (`#12`,
// `!5`, `owner/repo#12`). Découpage seulement ; ce qu'un clic fait est décidé à l'affichage
// (commit chargé dans le graphe, provider du remote).

export type CommitSegment =
  | { t: "text"; v: string }
  | { t: "url"; v: string }
  | { t: "sha"; v: string }
  /** `repo` : `owner/repo` écrit devant, sinon le dépôt du remote. */
  | { t: "ref"; v: string; sigil: "#" | "!"; number: number; repo: string | null };

// Adresse ; dépôt `owner/repo` (groupes GitLab compris) suivi de #N / !N ; #N / !N seul ;
// SHA de 7 à 40 caractères. Chacun en début de texte ou après un caractère qui n'est pas
// un mot (pas `abc#1`, pas la fin d'un mot hexadécimal).
const PATTERN = /(https?:\/\/[^\s<>]+)|(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+)?([#!])(\d{1,9})(?![\w])|(?<![\w])([0-9a-f]{7,40})(?![\w])/gi;

/** Ponctuation finale hors de l'adresse ; `)` gardée seulement si elle ferme une `(` de l'adresse. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"*_~]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
  return u;
}

export function commitSegments(text: string): CommitSegment[] {
  const out: CommitSegment[] = [];
  let last = 0;
  const push = (from: number, seg: CommitSegment, len: number) => {
    if (from > last) out.push({ t: "text", v: text.slice(last, from) });
    out.push(seg);
    last = from + len;
  };
  PATTERN.lastIndex = 0;
  for (let m = PATTERN.exec(text); m; m = PATTERN.exec(text)) {
    if (m.index < last) continue;
    if (m[1]) {
      const url = trimUrl(m[1]);
      push(m.index, { t: "url", v: url }, url.length);
      PATTERN.lastIndex = m.index + url.length;
    } else if (m[3]) {
      push(m.index, { t: "ref", v: m[0], sigil: m[3] as "#" | "!", number: Number(m[4]), repo: m[2] ?? null }, m[0].length);
    } else if (m[5] && /\d/.test(m[5]) && /[a-f]/i.test(m[5])) {
      // Un SHA a des chiffres et des lettres (pas un nombre, pas un mot comme « deadbeef » seul).
      push(m.index, { t: "sha", v: m[5].toLowerCase() }, m[5].length);
    }
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}
