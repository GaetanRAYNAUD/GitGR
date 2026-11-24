// Fusion à trois voies d'un fichier en conflit, pour la vue de résolution en 3 panneaux : à
// partir de la version commune (base), de la nôtre et de l'autre, le fichier est découpé en
// parties identiques partout et en modifications — d'un seul côté, la même des deux côtés, ou
// en conflit. Pur (testé dans merge3.test.ts).

import { tokenize } from "./wordDiff";

/** Ligne d'une version : indice de la ligne qui lui correspond dans l'autre (`-1` : aucune). */
type Match = Int32Array;

/** Au-delà de ce nombre de différences, les parties restantes sont comptées comme une seule
 *  modification (le diff de Myers garde un historique en D²). */
const MAX_EDITS = 2000;

/** Plus longue sous-suite commune de deux suites (Myers, O((N+M)·D)). Renvoie pour chaque
 *  élément de `a` l'indice de son correspondant dans `b`, ou `-1`. */
export function matchLines(a: readonly string[], b: readonly string[]): Match {
  const out = new Int32Array(a.length).fill(-1);
  // Préfixe et suffixe communs : le cas courant (peu de modifications) reste linéaire.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) out[pre] = pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
    out[a.length - 1 - suf] = b.length - 1 - suf;
    suf++;
  }
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if (n === 0 || m === 0) return out;
  // Lignes réduites à des nombres : comparaisons rapides.
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) ids.set(s, (v = ids.size));
    return v;
  };
  const A = Int32Array.from({ length: n }, (_, i) => id(a[pre + i]));
  const B = Int32Array.from({ length: m }, (_, j) => id(b[pre + j]));
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return out; // trop de différences : tout le milieu est « modifié »
  // Remontée : les diagonales parcourues sont les lignes communes.
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]; // état avant l'étape d, indices décalés de (d + 1)
    const at = (k: number) => prev[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    const sx = down ? px : px + 1;
    while (x > sx && y > sx - k) {
      x--;
      y--;
      out[pre + x] = pre + y;
    }
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    out[pre + x] = pre + y;
  }
  return out;
}

/** D'où vient une modification. */
export type ChangeType = "ours" | "theirs" | "both" | "conflict";

export type Chunk =
  | { kind: "same"; lines: string[] }
  | {
      kind: "change";
      type: ChangeType;
      /** Lignes de la version commune (`null` : pas de version commune, fusion à deux voies). */
      base: string[] | null;
      ours: string[];
      theirs: string[];
    };

const eq = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

function classify(base: string[] | null, ours: string[], theirs: string[]): ChangeType {
  if (base === null) return eq(ours, theirs) ? "both" : "conflict";
  if (eq(ours, theirs)) return "both";
  if (eq(ours, base)) return "theirs";
  if (eq(theirs, base)) return "ours";
  return "conflict";
}

/** Découpe à trois voies (diff3). Sans version commune (`base === null`, ajout des deux côtés),
 *  les deux versions sont comparées entre elles : ce qui diffère est en conflit. */
export function merge3(base: readonly string[] | null, ours: readonly string[], theirs: readonly string[]): Chunk[] {
  const out: Chunk[] = [];
  const same = (l: string) => {
    const last = out[out.length - 1];
    if (last?.kind === "same") last.lines.push(l);
    else out.push({ kind: "same", lines: [l] });
  };
  const change = (b: string[] | null, o: string[], t: string[]) => {
    if (!o.length && !t.length && (b === null || !b.length)) return;
    out.push({ kind: "change", type: classify(b, o, t), base: b, ours: o, theirs: t });
  };
  if (base === null) {
    const m = matchLines(ours, theirs);
    let j = 0;
    let i = 0;
    while (i < ours.length) {
      if (m[i] < 0) {
        const from = i;
        while (i < ours.length && m[i] < 0) i++;
        const to = i < ours.length ? m[i] : theirs.length;
        change(null, ours.slice(from, i), theirs.slice(j, to));
        j = to;
        continue;
      }
      if (m[i] > j) change(null, [], theirs.slice(j, m[i]));
      same(ours[i]);
      j = m[i] + 1;
      i++;
    }
    change(null, [], theirs.slice(j));
    return out;
  }
  const mo = matchLines(base, ours);
  const mt = matchLines(base, theirs);
  let i = 0;
  let jo = 0;
  let jt = 0;
  while (i < base.length) {
    if (mo[i] === jo && mt[i] === jt) {
      same(base[i]);
      i++;
      jo++;
      jt++;
      continue;
    }
    // Partie instable : jusqu'à la prochaine ligne de la base gardée des deux côtés.
    let k = i;
    while (k < base.length && (mo[k] < 0 || mt[k] < 0)) k++;
    const eo = k < base.length ? mo[k] : ours.length;
    const et = k < base.length ? mt[k] : theirs.length;
    change(base.slice(i, k), ours.slice(jo, eo), theirs.slice(jt, et));
    i = k;
    jo = eo;
    jt = et;
  }
  change([], ours.slice(jo), theirs.slice(jt));
  return out;
}

/** Résolution automatique d'un conflit, mot à mot (la « baguette magique ») : possible quand
 *  les deux côtés ont modifié des parties différentes des mêmes lignes. `null` sinon. */
export function autoResolve(base: readonly string[] | null, ours: readonly string[], theirs: readonly string[]): string[] | null {
  if (base === null) return null;
  // Lignes réunies avec leurs fins, découpées en mots : une fin de ligne est un jeton.
  const toks = (lines: readonly string[]) => lines.flatMap((l) => [...tokenize(l), "\n"]);
  const b = toks(base);
  const o = toks(ours);
  const t = toks(theirs);
  if (b.length + o.length + t.length > 30_000) return null;
  const parts: string[] = [];
  for (const c of merge3(b, o, t)) {
    if (c.kind === "same") parts.push(...c.lines);
    else if (c.type === "conflict") return null;
    else parts.push(...(c.type === "theirs" ? c.theirs : c.ours));
  }
  const text = parts.join("");
  const lines = text.split("\n");
  lines.pop(); // chaque ligne finissait par « \n »
  return lines;
}

/** Côté d'une modification. */
export type Side = "ours" | "theirs";

/** Ce que l'utilisateur a fait d'une modification. */
export interface ChangeState {
  /** Lignes de la modification dans le résultat. */
  result: string[];
  /** Côtés appliqués, dans l'ordre des clics (le second s'ajoute après le premier). */
  applied: Side[];
  /** Côtés écartés (X). */
  ignored: Side[];
  /** Résultat modifié à la main (ou composé ligne par ligne). */
  edited: boolean;
  /** Lignes prises une à une (côté, indice), dans l'ordre des clics. */
  picks: { side: Side; index: number }[];
}

/** Côtés qui portent une modification (ceux dont les boutons » / « / X ont un sens). */
export function changedSides(c: Extract<Chunk, { kind: "change" }>): Side[] {
  switch (c.type) {
    case "ours":
      return ["ours"];
    case "theirs":
      return ["theirs"];
    default:
      return ["ours", "theirs"];
  }
}

/** État de départ : les modifications sans conflit appliquées (ce que git a déjà fait dans la
 *  copie de travail), les conflits laissés sur la version commune, à résoudre. */
export function initialState(c: Extract<Chunk, { kind: "change" }>, applyNonConflicting = true): ChangeState {
  const blank: ChangeState = { result: c.base ?? [], applied: [], ignored: [], edited: false, picks: [] };
  if (!applyNonConflicting || c.type === "conflict") return blank;
  if (c.type === "both") return { ...blank, result: c.ours, applied: ["ours", "theirs"] };
  return { ...blank, result: c.type === "ours" ? c.ours : c.theirs, applied: [c.type] };
}

/** Une modification est réglée quand un côté est appliqué, le résultat retouché, ou tous ses
 *  côtés écartés. */
export function isResolved(c: Extract<Chunk, { kind: "change" }>, s: ChangeState): boolean {
  return s.edited || s.applied.length > 0 || changedSides(c).every((x) => s.ignored.includes(x));
}

/** Applique un côté (» / «) : il remplace la version commune, ou s'ajoute après l'autre côté
 *  déjà appliqué. */
export function applySide(c: Extract<Chunk, { kind: "change" }>, s: ChangeState, side: Side): ChangeState {
  if (s.applied.includes(side)) return s;
  const lines = side === "ours" ? c.ours : c.theirs;
  const result = s.applied.length || s.edited ? [...s.result, ...lines] : lines;
  // Les lignes prises une à une ne décrivent plus le résultat : un clic de plus le referait sans ce côté.
  return { ...s, result, applied: [...s.applied, side], ignored: s.ignored.filter((x) => x !== side), picks: [] };
}

/** Écarte un côté (X). */
export function ignoreSide(s: ChangeState, side: Side): ChangeState {
  return s.ignored.includes(side) ? s : { ...s, ignored: [...s.ignored, side] };
}

/** Prend ou retire une ligne d'un côté : le résultat devient les lignes prises, dans l'ordre
 *  des clics. */
export function togglePickLine(c: Extract<Chunk, { kind: "change" }>, s: ChangeState, side: Side, index: number): ChangeState {
  const has = s.picks.some((p) => p.side === side && p.index === index);
  const picks = has ? s.picks.filter((p) => !(p.side === side && p.index === index)) : [...s.picks, { side, index }];
  // Plus aucune ligne prise : retour au départ (version commune pour un conflit).
  if (!picks.length) return initialState(c);
  const result = picks.map((p) => (p.side === "ours" ? c.ours : c.theirs)[p.index]).filter((l): l is string => l !== undefined);
  return { ...s, picks, result, edited: true, applied: [], ignored: [] };
}

/** « Accepter gauche / droite » : le fichier entier de ce côté. Les modifications de l'autre
 *  côté sont écartées, même celles sans conflit. */
export function acceptAll(c: Extract<Chunk, { kind: "change" }>, side: Side): ChangeState {
  const other: Side = side === "ours" ? "theirs" : "ours";
  const mine = changedSides(c).includes(side);
  return {
    result: side === "ours" ? c.ours : c.theirs,
    applied: mine ? [side] : [],
    ignored: changedSides(c).includes(other) ? [other] : [],
    edited: false,
    picks: [],
  };
}

/** La baguette : les modifications sans conflit appliquées, et les conflits qui se résolvent
 *  mot à mot. `null` si elle n'a rien à faire sur cette modification. */
export function magic(c: Extract<Chunk, { kind: "change" }>): ChangeState | null {
  if (c.type !== "conflict") return initialState(c);
  const lines = autoResolve(c.base, c.ours, c.theirs);
  return lines && { result: lines, applied: ["ours", "theirs"], ignored: [], edited: false, picks: [] };
}

/** Le fichier résultant. */
export function composeMerged(chunks: Chunk[], states: ChangeState[], eol: string, finalEol: boolean): string {
  const out: string[] = [];
  let k = 0;
  for (const c of chunks) {
    if (c.kind === "same") out.push(...c.lines);
    else out.push(...states[k++].result);
  }
  if (!out.length) return "";
  return out.join(eol) + (finalEol ? eol : "");
}

/** Découpe un texte en lignes (fins de ligne Windows comprises) et note sa dernière fin. */
export function splitText(text: string): { lines: string[]; eol: string; finalEol: boolean } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const finalEol = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (finalEol || text === "") lines.pop();
  return { lines, eol, finalEol };
}
