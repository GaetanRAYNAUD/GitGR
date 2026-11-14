// Différences à l'intérieur d'une ligne modifiée (fonction pure, testée dans wordDiff.test.ts) :
// on compare l'ancienne et la nouvelle version mot à mot pour surligner ce qui a vraiment changé.

import type { Hunk } from "./types";

export interface Segment {
  text: string;
  /** Partie modifiée (supprimée côté ancien, ajoutée côté nouveau). */
  changed: boolean;
}

/** Au-delà, la comparaison mot à mot (quadratique) n'est pas faite. */
const MAX_TOKENS = 400;
/** Travail total (cases de la table de comparaison) accordé à un diff entier : au-delà, les
 *  lignes restantes s'affichent sans surlignage plutôt que de figer l'interface. */
export const DIFF_WORD_BUDGET = 2_000_000;

/** Budget partagé par toutes les lignes d'un diff. */
export interface WordBudget {
  left: number;
}
/** Si plus de cette part de la ligne a changé, surligner n'aide pas : la ligne est réécrite. */
const MAX_CHANGED_RATIO = 0.6;

/** Mots (lettres, chiffres, _), suites d'espaces, ou signe isolé. */
export function tokenize(s: string): string[] {
  return s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
}

/** Regroupe les jetons consécutifs de même état. */
function merge(tokens: string[], changed: boolean[]): Segment[] {
  const out: Segment[] = [];
  tokens.forEach((text, i) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed[i]) last.text += text;
    else out.push({ text, changed: changed[i] });
  });
  return out;
}

/** Compare deux versions d'une ligne. `null` si le surlignage n'apporterait rien
 *  (ligne trop longue, ou presque entièrement réécrite). */
export function wordDiff(a: string, b: string, budget?: WordBudget): { old: Segment[]; new: Segment[] } | null {
  // Préfixe et suffixe communs d'abord : le cas courant (un mot changé) reste linéaire.
  const ta = tokenize(a);
  const tb = tokenize(b);
  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++;
  const ma = ta.slice(pre, ta.length - suf);
  const mb = tb.slice(pre, tb.length - suf);
  if (ma.length > MAX_TOKENS || mb.length > MAX_TOKENS) return null;

  // Plus longue sous-suite commune sur la partie centrale (table à plat : ≤ 401 × 401).
  const n = ma.length;
  const m = mb.length;
  const cells = (n + 1) * (m + 1);
  if (budget) {
    if (cells > budget.left) return null;
    budget.left -= cells;
  }
  const w = m + 1;
  const lcs = new Uint16Array(cells);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ma[i] === mb[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ma[i] === mb[j]) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
    else j++;
  }
  // Un espace isolé gardé entre deux parties modifiées hache le surlignage : on l'y rattache.
  const absorb = (tokens: string[], keep: boolean[]) => {
    for (let i = 1; i < tokens.length - 1; i++) {
      if (keep[i] && /^\s+$/.test(tokens[i]) && !keep[i - 1] && !keep[i + 1]) keep[i] = false;
    }
  };
  absorb(ma, keepA);
  absorb(mb, keepB);

  const changedA = [...new Array<boolean>(pre).fill(false), ...keepA.map((k) => !k), ...new Array<boolean>(suf).fill(false)];
  const changedB = [...new Array<boolean>(pre).fill(false), ...keepB.map((k) => !k), ...new Array<boolean>(suf).fill(false)];

  const changedLen = (tokens: string[], changed: boolean[]) => tokens.reduce((s, t, i) => s + (changed[i] ? t.length : 0), 0);
  const ratio = (changedLen(ta, changedA) + changedLen(tb, changedB)) / Math.max(1, a.length + b.length);
  if (ratio > MAX_CHANGED_RATIO) return null;
  return { old: merge(ta, changedA), new: merge(tb, changedB) };
}

export type HunkItem = { context: number } | { dels: number[]; adds: number[] };

/** Découpe un hunk en lignes de contexte et groupes de changements (indices de lignes).
 *  Un « - » qui suit des « + » ouvre un nouveau groupe. Sert à la fois à l'appariement
 *  côte à côte et à la comparaison mot à mot, pour qu'elles désignent les mêmes paires. */
export function hunkItems(h: Hunk): HunkItem[] {
  const out: HunkItem[] = [];
  let group: { dels: number[]; adds: number[] } | null = null;
  h.lines.forEach((l, i) => {
    if (l.kind === " ") {
      group = null;
      out.push({ context: i });
      return;
    }
    if (!group || (l.kind === "-" && group.adds.length > 0)) {
      group = { dels: [], adds: [] };
      out.push(group);
    }
    (l.kind === "-" ? group.dels : group.adds).push(i);
  });
  return out;
}

/** Pour chaque hunk : segments surlignés par indice de ligne. Dans un groupe de changements,
 *  la k-ième suppression est comparée au k-ième ajout. */
export function hunkWordDiffs(h: Hunk, budget?: WordBudget): Map<number, Segment[]> {
  const out = new Map<number, Segment[]>();
  for (const item of hunkItems(h)) {
    if ("context" in item) continue;
    for (let k = 0; k < Math.min(item.dels.length, item.adds.length); k++) {
      const d = wordDiff(h.lines[item.dels[k]].text, h.lines[item.adds[k]].text, budget);
      if (d) {
        out.set(item.dels[k], d.old);
        out.set(item.adds[k], d.new);
      }
    }
  }
  return out;
}
