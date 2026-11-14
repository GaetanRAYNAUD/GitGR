import { describe, expect, it } from "vitest";
import type { DiffLine } from "./types";
import { hunkItems, hunkWordDiffs, tokenize, wordDiff, type Segment } from "./wordDiff";

/** Parties modifiées seules. */
const changed = (segs: Segment[]) => segs.filter((s) => s.changed).map((s) => s.text);
const joined = (segs: Segment[]) => segs.map((s) => s.text).join("");

describe("tokenize", () => {
  it("mots (accents compris), espaces et signes", () => {
    expect(tokenize("à l'étape 3-4, ok")).toEqual(["à", " ", "l", "'", "étape", " ", "3", "-", "4", ",", " ", "ok"]);
  });
});

describe("wordDiff", () => {
  it("ne surligne que le mot changé et reconstitue les deux lignes", () => {
    const d = wordDiff("  const height = rows.length * 34;", "  const height = rows.length * ROW_H;")!;
    expect(changed(d.old)).toEqual(["34"]);
    expect(changed(d.new)).toEqual(["ROW_H"]);
    expect(joined(d.old)).toBe("  const height = rows.length * 34;");
    expect(joined(d.new)).toBe("  const height = rows.length * ROW_H;");
  });

  it("phrase réécrite en partie (cas des notes)", () => {
    const a = "Retours sur les maquettes à reporter dans l'app aux étapes 3-4 : bouton « tout annuler » avec confirmation";
    const b = "Retours sur les maquettes à reporter : case « push après le commit » avec confirmation";
    const d = wordDiff(a, b)!;
    expect(d).not.toBeNull();
    expect(changed(d.old).join("")).toContain("dans l'app aux étapes 3-4");
    expect(changed(d.new).join("")).toContain("case");
    // Le début et la fin communs ne sont pas surlignés.
    expect(d.old[0]).toEqual({ text: "Retours sur les maquettes à reporter ", changed: false });
    expect(d.new[d.new.length - 1]).toEqual({ text: " » avec confirmation", changed: false });
  });

  it("ajout pur au milieu de la ligne", () => {
    const d = wordDiff("foo(a, b)", "foo(a, x, b)")!;
    expect(changed(d.old)).toEqual([]);
    expect(changed(d.new).join("")).toBe("x, ");
  });

  it("ligne entièrement réécrite : pas de surlignage", () => {
    expect(wordDiff("let total = items.len();", "println!(\"bonjour\");")).toBeNull();
  });

  it("lignes identiques (espaces de fin…) : rien de surligné", () => {
    const d = wordDiff("abc", "abc")!;
    expect(changed(d.old)).toEqual([]);
  });
});

describe("budget", () => {
  it("au-delà du budget, les lignes suivantes ne sont plus comparées", () => {
    const budget = { left: 50 };
    // Partie centrale d'un jeton de chaque côté : 2 × 2 = 4 cases.
    expect(wordDiff("alpha beta gamma delta", "alpha beta gamma zeta", budget)).not.toBeNull();
    expect(budget.left).toBe(46);
    const long = Array.from({ length: 10 }, (_, i) => `m${i}`).join(" ");
    expect(wordDiff(long, long.replace("m0", "n0").replace("m9", "n9"), budget)).toBeNull();
  });
});

describe("hunkWordDiffs", () => {
  const l = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, old: null, new: null, text });

  it("apparie suppressions et ajouts dans chaque groupe", () => {
    const h = {
      header: "",
      lines: [l(" ", "ctx"), l("-", "a = 1"), l("-", "b = 2"), l("+", "a = 10"), l("+", "b = 2;"), l("+", "c = 3"), l(" ", "x")],
    };
    const m = hunkWordDiffs(h);
    expect(changed(m.get(1)!)).toEqual(["1"]);
    expect(changed(m.get(3)!)).toEqual(["10"]);
    expect(changed(m.get(4)!)).toEqual([";"]);
    // « c = 3 » n'a pas de ligne supprimée en face : affichée normalement.
    expect(m.has(5)).toBe(false);
  });

  it("hunkItems : contexte et groupes, un « - » après des « + » ouvre un groupe", () => {
    const h = { header: "", lines: [l(" ", "c"), l("-", "a"), l("-", "b"), l("+", "c2"), l("-", "d"), l("+", "e"), l("+", "f")] };
    expect(hunkItems(h)).toEqual([
      { context: 0 },
      { dels: [1, 2], adds: [3] },
      { dels: [4], adds: [5, 6] },
    ]);
  });

  it("un « - » après des « + » ouvre un nouveau groupe", () => {
    const h = { header: "", lines: [l("-", "x = 1"), l("+", "x = 2"), l("-", "y = 1"), l("+", "y = 2")] };
    const m = hunkWordDiffs(h);
    expect(changed(m.get(2)!)).toEqual(["1"]);
    expect(changed(m.get(3)!)).toEqual(["2"]);
  });
});
