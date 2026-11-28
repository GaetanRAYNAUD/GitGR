import { describe, expect, it } from "vitest";
import { lineBefore } from "./lineMap";
import type { DiffLine, FileDiff } from "./types";

const add = (n: number, text = "x"): DiffLine => ({ kind: "+", old: null, new: n, text });
const del = (o: number, text = "y"): DiffLine => ({ kind: "-", old: o, new: null, text });
const ctx = (o: number, n: number): DiffLine => ({ kind: " ", old: o, new: n, text: "c" });
const diff = (...hunks: [string, DiffLine[]][]): FileDiff => ({ binary: false, truncated: false, fingerprint: "", hunks: hunks.map(([header, lines]) => ({ header, lines })) });

describe("lineBefore", () => {
  it("trois lignes ajoutées en tête : les suivantes remontent de trois", () => {
    const d = diff(["@@ -0,0 +1,3 @@", [add(1), add(2), add(3)]]);
    expect(lineBefore(d, 8)).toBe(5);
    expect(lineBefore(d, 2)).toBe(1);
  });
  it("ligne modifiée : la ligne remplacée ; contexte : son ancien numéro", () => {
    const d = diff(["@@ -4,3 +4,4 @@", [ctx(4, 4), del(5), add(5), add(6), ctx(6, 7)]]);
    expect(lineBefore(d, 6)).toBe(5);
    expect(lineBefore(d, 7)).toBe(6);
    expect(lineBefore(d, 3)).toBe(3);
    expect(lineBefore(d, 10)).toBe(9);
  });
});
