import { describe, expect, it } from "vitest";
import { acceptAll, applySide, autoResolve, composeMerged, ignoreSide, initialState, isResolved, magic, matchLines, merge3, splitText, togglePickLine, type Chunk } from "./merge3";

type Change = Extract<Chunk, { kind: "change" }>;
const changes = (chunks: Chunk[]) => chunks.filter((c): c is Change => c.kind === "change");

/** Plus longue sous-suite commune par programmation dynamique, pour vérifier Myers. */
function lcsLength(a: string[], b: string[]): number {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t[0][0];
}

describe("matchLines", () => {
  it("trouve une plus longue sous-suite commune, croissante", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 200; n++) {
      const a = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]);
      const b = Array.from({ length: Math.floor(rnd() * 12) }, () => "abcd"[Math.floor(rnd() * 4)]);
      const m = matchLines(a, b);
      let last = -1;
      let count = 0;
      m.forEach((j, i) => {
        if (j < 0) return;
        expect(b[j]).toBe(a[i]);
        expect(j).toBeGreaterThan(last);
        last = j;
        count++;
      });
      expect(count).toBe(lcsLength(a, b));
    }
  });
});

describe("merge3", () => {
  const base = ["a", "b", "c", "d", "e"];

  it("sépare les modifications d'un côté, des deux, et les conflits", () => {
    const ours = ["a", "B", "c", "d", "E1"];
    const theirs = ["a", "b", "c", "D", "E2"];
    const chunks = merge3(base, ours, theirs);
    expect(merge3(["a", "b", "c"], ["a", "b", "C"], ["A", "b", "c"]).filter((c) => c.kind === "change").map((c) => c.kind === "change" && c.type)).toEqual(["theirs", "ours"]);
    expect(chunks).toEqual([
      { kind: "same", lines: ["a"] },
      { kind: "change", type: "ours", base: ["b"], ours: ["B"], theirs: ["b"] },
      { kind: "same", lines: ["c"] },
      // Deux modifications voisines ne font qu'un conflit (comme git).
      { kind: "change", type: "conflict", base: ["d", "e"], ours: ["d", "E1"], theirs: ["D", "E2"] },
    ]);
  });

  it("même modification des deux côtés, ajouts en fin", () => {
    const chunks = merge3(["a"], ["a", "x"], ["a", "x"]);
    expect(changes(chunks)).toEqual([{ kind: "change", type: "both", base: [], ours: ["x"], theirs: ["x"] }]);
  });

  it("sans version commune : ce qui diffère entre les deux est en conflit", () => {
    const chunks = merge3(null, ["a", "o", "z"], ["a", "t", "z", "w"]);
    expect(chunks).toEqual([
      { kind: "same", lines: ["a"] },
      { kind: "change", type: "conflict", base: null, ours: ["o"], theirs: ["t"] },
      { kind: "same", lines: ["z"] },
      { kind: "change", type: "conflict", base: null, ours: [], theirs: ["w"] },
    ]);
  });

  it("reconstruit chaque version à partir des morceaux", () => {
    const ours = ["x", "a", "c", "d", "y", "e"];
    const theirs = ["a", "b", "q", "d", "e", "z"];
    const chunks = merge3(base, ours, theirs);
    const side = (k: "base" | "ours" | "theirs") => chunks.flatMap((c) => (c.kind === "same" ? c.lines : (c[k] ?? [])));
    expect(side("base")).toEqual(base);
    expect(side("ours")).toEqual(ours);
    expect(side("theirs")).toEqual(theirs);
  });
});

describe("autoResolve (baguette magique)", () => {
  it("réunit deux modifications de mots différents d'une même ligne", () => {
    expect(autoResolve(["let a = 1, b = 2;"], ["let a = 10, b = 2;"], ["let a = 1, b = 20;"])).toEqual(["let a = 10, b = 20;"]);
  });
  it("refuse quand le même mot change des deux côtés, ou sans version commune", () => {
    expect(autoResolve(["x = 1"], ["x = 2"], ["x = 3"])).toBeNull();
    expect(autoResolve(null, ["a"], ["b"])).toBeNull();
  });
});

describe("état des modifications", () => {
  const conflict: Change = { kind: "change", type: "conflict", base: ["b"], ours: ["o1", "o2"], theirs: ["t"] };
  const oursOnly: Change = { kind: "change", type: "ours", base: ["b"], ours: ["o"], theirs: ["b"] };

  it("sans conflit : appliquée d'office ; conflit : version commune, à résoudre", () => {
    expect(initialState(oursOnly)).toMatchObject({ result: ["o"], applied: ["ours"] });
    expect(isResolved(oursOnly, initialState(oursOnly))).toBe(true);
    const s = initialState(conflict);
    expect(s.result).toEqual(["b"]);
    expect(isResolved(conflict, s)).toBe(false);
  });

  it("» puis « : le second côté s'ajoute après le premier", () => {
    let s = applySide(conflict, initialState(conflict), "theirs");
    expect(s.result).toEqual(["t"]);
    expect(isResolved(conflict, s)).toBe(true);
    s = applySide(conflict, s, "ours");
    expect(s.result).toEqual(["t", "o1", "o2"]);
  });

  it("X des deux côtés : version commune gardée, réglée", () => {
    const s = ignoreSide(ignoreSide(initialState(conflict), "ours"), "theirs");
    expect(s.result).toEqual(["b"]);
    expect(isResolved(conflict, s)).toBe(true);
  });

  it("lignes prises une à une, dans l'ordre des clics", () => {
    let s = togglePickLine(conflict, initialState(conflict), "theirs", 0);
    s = togglePickLine(conflict, s, "ours", 1);
    expect(s.result).toEqual(["t", "o2"]);
    s = togglePickLine(conflict, s, "theirs", 0);
    expect(s.result).toEqual(["o2"]);
    // » après des lignes prises : elles ne sont plus marquées (le résultat ne vient plus d'elles).
    expect(applySide(conflict, s, "theirs")).toMatchObject({ result: ["o2", "t"], picks: [] });
    // Plus aucune ligne prise : retour à la version commune, à résoudre.
    s = togglePickLine(conflict, s, "ours", 1);
    expect(s.result).toEqual(["b"]);
    expect(isResolved(conflict, s)).toBe(false);
  });

  it("accepter tout un côté donne ce fichier-là, l'autre côté écarté", () => {
    const theirsOnly: Change = { kind: "change", type: "theirs", base: ["b"], ours: ["b"], theirs: ["T"] };
    const s = acceptAll(theirsOnly, "ours");
    expect(s.result).toEqual(["b"]);
    expect(isResolved(theirsOnly, s)).toBe(true);
    expect(acceptAll(conflict, "ours").result).toEqual(["o1", "o2"]);
  });

  it("baguette : sans conflit appliqué, conflit résolu mot à mot si possible", () => {
    expect(magic(oursOnly)?.result).toEqual(["o"]);
    expect(magic(conflict)).toBeNull();
    const simple: Change = { kind: "change", type: "conflict", base: ["a b c"], ours: ["A b c"], theirs: ["a b C"] };
    expect(magic(simple)?.result).toEqual(["A b C"]);
  });

  it("recompose le fichier avec ses fins de ligne", () => {
    const { lines, eol, finalEol } = splitText("a\r\nb\r\n");
    expect(lines).toEqual(["a", "b"]);
    const chunks = merge3(lines, ["a", "B"], ["a", "b"]);
    expect(composeMerged(chunks, changes(chunks).map((c) => initialState(c)), eol, finalEol)).toBe("a\r\nB\r\n");
    expect(splitText("").lines).toEqual([]);
  });
});
