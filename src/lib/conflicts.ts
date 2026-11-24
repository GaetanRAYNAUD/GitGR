// Conflits : lecture des marqueurs de git dans un fichier en conflit (noms des côtés, version
// simulée), couleurs d'un côté, déplacement de lignes dans le résultat. Pur (testé dans
// conflicts.test.ts).

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

import { matchLines } from "./merge3";
import { wordDiff } from "./wordDiff";

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
  /** Ligne de la référence qu'une ligne modifiée remplace. */
  ref?: string;
}

/** Compare un côté à sa référence ligne à ligne (plus longue sous-suite commune). Dans une suite
 *  de différences, une ligne ajoutée est « modifiée » quand elle ressemble à une ligne retirée
 *  (appariées dans l'ordre ; de même nombre, appariées une à une) ; le reste est ajouté ou
 *  supprimé. */
export function sideDiff(ref: string[], side: string[]): SideLine[] {
  const match = matchLines(ref, side);
  const out: SideLine[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = () => {
    const one = dels.length === adds.length;
    let d = 0;
    for (const add of adds) {
      let j = d;
      if (!one) while (j < dels.length && wordDiff(dels[j], add) === null) j++;
      if (j < dels.length) {
        out.push({ text: add, kind: "mod", ref: dels[j] });
        for (const skipped of dels.slice(d, j)) out.push({ text: skipped, kind: "del" });
        d = j + 1;
      } else out.push({ text: add, kind: "add" });
    }
    for (const left of dels.slice(d)) out.push({ text: left, kind: "del" });
    dels = [];
    adds = [];
  };
  let j = 0;
  ref.forEach((line, i) => {
    if (match[i] < 0) {
      dels.push(line);
      return;
    }
    while (j < match[i]) adds.push(side[j++]);
    flush();
    out.push({ text: side[j++], kind: "same" });
  });
  while (j < side.length) adds.push(side[j++]);
  flush();
  return out;
}
