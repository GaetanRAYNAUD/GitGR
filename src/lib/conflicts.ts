// Résolution de conflits : lecture des marqueurs de git dans un fichier en conflit, et
// reconstitution du fichier une fois chaque bloc résolu. Pur (testé dans conflicts.test.ts).

/** Ce qu'on garde d'un bloc en conflit. */
export type ConflictChoice = "ours" | "theirs" | "ours-theirs" | "theirs-ours" | "none";

export interface ConflictBlock {
  kind: "conflict";
  ours: string[];
  theirs: string[];
  /** Version commune (style diff3 / zdiff3), si git l'a écrite. */
  base: string[] | null;
  oursLabel: string;
  theirsLabel: string;
}

export type Segment = { kind: "common"; lines: string[] } | ConflictBlock;

export interface ParsedConflicts {
  segments: Segment[];
  /** Fin de ligne du fichier (`\r\n` gardé sous Windows). */
  eol: string;
  /** Le fichier se termine par une fin de ligne. */
  finalEol: boolean;
}

const MARK = 7;
const marker = (line: string, ch: string) => line.length >= MARK && line.slice(0, MARK) === ch.repeat(MARK) && (line.length === MARK || line[MARK] === " ");

/** Découpe le fichier en parties communes et blocs en conflit. Un bloc mal fermé est laissé
 *  tel quel (partie commune). */
export function parseConflicts(text: string): ParsedConflicts {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalEol = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (finalEol) lines.pop();
  const segments: Segment[] = [];
  const common = (l: string[]) => {
    if (!l.length) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "common") last.lines.push(...l);
    else segments.push({ kind: "common", lines: [...l] });
  };
  let i = 0;
  while (i < lines.length) {
    if (!marker(lines[i], "<")) {
      common([lines[i++]]);
      continue;
    }
    // Bloc : <<<<<<< ours, ||||||| base (facultatif), =======, >>>>>>> theirs.
    const open = i;
    const oursLabel = lines[i].slice(MARK + 1);
    const ours: string[] = [];
    let base: string[] | null = null;
    const theirs: string[] = [];
    let part: string[] = ours;
    let theirsLabel = "";
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (marker(l, "<")) break; // nouveau bloc avant la fin de celui-ci : mal formé
      if (marker(l, "|") && part === ours) {
        base = [];
        part = base;
      } else if (marker(l, "=") && part !== theirs) {
        part = theirs;
      } else if (marker(l, ">") && part === theirs) {
        theirsLabel = l.slice(MARK + 1);
        closed = true;
        break;
      } else part.push(l);
    }
    if (!closed) {
      common(lines.slice(open, j));
      i = j;
      continue;
    }
    segments.push({ kind: "conflict", ours, theirs, base, oursLabel, theirsLabel });
    i = j + 1;
  }
  return { segments, eol, finalEol };
}

/** Lignes d'un bloc pour un choix. */
export function chooseLines(seg: ConflictBlock, choice: ConflictChoice): string[] {
  switch (choice) {
    case "ours":
      return seg.ours;
    case "theirs":
      return seg.theirs;
    case "ours-theirs":
      return [...seg.ours, ...seg.theirs];
    case "theirs-ours":
      return [...seg.theirs, ...seg.ours];
    case "none":
      return [];
  }
}

/** Fichier final : parties communes, et pour chaque bloc ses lignes résolues (`null` : bloc
 *  pas encore résolu, ses marqueurs sont remis). */
export function composeResolution(parsed: ParsedConflicts, resolved: (string[] | null)[]): string {
  const out: string[] = [];
  let k = 0;
  for (const seg of parsed.segments) {
    if (seg.kind === "common") {
      out.push(...seg.lines);
      continue;
    }
    const r = resolved[k++];
    if (r) out.push(...r);
    else {
      out.push(`${"<".repeat(MARK)} ${seg.oursLabel}`.trimEnd(), ...seg.ours);
      if (seg.base) out.push("|".repeat(MARK), ...seg.base);
      out.push("=".repeat(MARK), ...seg.theirs, `${">".repeat(MARK)} ${seg.theirsLabel}`.trimEnd());
    }
  }
  if (!out.length) return "";
  return out.join(parsed.eol) + (parsed.finalEol ? parsed.eol : "");
}

/** Déplace d'un cran (Alt+↑ / Alt+↓) la ligne du curseur, ou les lignes sélectionnées, dans un
 *  texte. Renvoie le nouveau texte et la sélection déplacée avec, `null` si rien ne bouge. */
export function moveLines(text: string, selStart: number, selEnd: number, dir: -1 | 1): { text: string; start: number; end: number } | null {
  const lines = text.split("\n");
  const lineAt = (pos: number) => text.slice(0, pos).split("\n").length - 1;
  const first = lineAt(selStart);
  // Une sélection qui finit juste après une fin de ligne ne prend pas la ligne suivante.
  const last = Math.max(first, lineAt(selEnd > selStart && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd));
  if ((dir === -1 && first === 0) || (dir === 1 && last === lines.length - 1)) return null;
  const block = lines.slice(first, last + 1);
  const rest = [...lines.slice(0, first), ...lines.slice(last + 1)];
  rest.splice(first + dir, 0, ...block);
  const delta = dir === -1 ? -(lines[first - 1].length + 1) : lines[last + 1].length + 1;
  return { text: rest.join("\n"), start: selStart + delta, end: selEnd + delta };
}

/** Ligne d'un côté d'un bloc comparé à une référence (version commune, ou l'autre côté sans
 *  elle) : inchangée, ajoutée, modifiée, ou supprimée (ligne de la référence absente ici). */
export interface SideLine {
  text: string;
  kind: "same" | "add" | "mod" | "del";
}

/** Compare un côté à sa référence ligne à ligne (plus longue sous-suite commune). Dans une suite
 *  de différences, les lignes retirées et ajoutées sont appariées en « modifiées », le reste
 *  est ajouté ou supprimé. */
export function sideDiff(ref: string[], side: string[]): SideLine[] {
  const n = ref.length;
  const m = side.length;
  // Table des longueurs (blocs de conflit : petits).
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = ref[i] === side[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: SideLine[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = () => {
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < adds.length; k++) out.push({ text: adds[k], kind: k < pairs ? "mod" : "add" });
    for (const d of dels.slice(pairs)) out.push({ text: d, kind: "del" });
    dels = [];
    adds = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ref[i] === side[j]) {
      flush();
      out.push({ text: side[j], kind: "same" });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) adds.push(side[j++]);
    else dels.push(ref[i++]);
  }
  flush();
  return out;
}

/** Une ligne cochée : son côté et son indice dans ce côté. */
export interface LinePick {
  side: "ours" | "theirs";
  index: number;
}

/** Lignes cochées d'un bloc, **dans l'ordre des clics** : c'est l'utilisateur qui sait comment
 *  le conflit se résout (ordre ajustable ensuite dans le résultat, Alt+↑ / Alt+↓). */
export type LinePicks = LinePick[];

/** Résultat d'un bloc : les lignes cochées, dans l'ordre où elles l'ont été. */
export function pickLines(seg: ConflictBlock, picks: LinePicks): string[] {
  return picks.map((p) => (p.side === "ours" ? seg.ours : seg.theirs)[p.index]).filter((l): l is string => l !== undefined);
}

/** Coche une ligne (ajoutée en dernier) ou la décoche. */
export function togglePick(picks: LinePicks, side: LinePick["side"], index: number): LinePicks {
  const has = picks.some((p) => p.side === side && p.index === index);
  return has ? picks.filter((p) => !(p.side === side && p.index === index)) : [...picks, { side, index }];
}

/** Lignes cochées qui correspondent à un choix rapide (dans l'ordre de ce choix). */
export function picksOf(seg: ConflictBlock, choice: ConflictChoice): LinePicks {
  const all = (side: LinePick["side"]) => seg[side].map((_, index) => ({ side, index }));
  switch (choice) {
    case "ours":
      return all("ours");
    case "theirs":
      return all("theirs");
    case "ours-theirs":
      return [...all("ours"), ...all("theirs")];
    case "theirs-ours":
      return [...all("theirs"), ...all("ours")];
    case "none":
      return [];
  }
}
