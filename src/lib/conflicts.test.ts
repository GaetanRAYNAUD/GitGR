import { describe, expect, it } from "vitest";
import { moveLines, parseConflicts } from "./conflicts";

const FILE = ["un", "<<<<<<< HEAD", "deux ici", "=======", "deux là-bas", "trois là-bas", ">>>>>>> sujet", "quatre", ""].join("\n");

describe("conflits", () => {
  it("découpe parties communes et blocs", () => {
    const p = parseConflicts(FILE);
    expect(p.segments).toEqual([
      { kind: "common", lines: ["un"] },
      { kind: "conflict", ours: ["deux ici"], theirs: ["deux là-bas", "trois là-bas"], base: null, oursLabel: "HEAD", theirsLabel: "sujet" },
      { kind: "common", lines: ["quatre"] },
    ]);
    expect(p.finalEol).toBe(true);
  });

  it("lit la version commune (diff3) et les fins de ligne Windows", () => {
    const p = parseConflicts("<<<<<<< ours\r\na\r\n||||||| base\r\nb\r\n=======\r\nc\r\n>>>>>>> theirs");
    expect(p.segments[0]).toMatchObject({ ours: ["a"], base: ["b"], theirs: ["c"] });
    expect(p.eol).toBe("\r\n");
  });

  it("laisse tel quel un bloc mal fermé", () => {
    const p = parseConflicts("<<<<<<< HEAD\na\n=======\nb\n");
    expect(p.segments).toEqual([{ kind: "common", lines: ["<<<<<<< HEAD", "a", "=======", "b"] }]);
  });

  it("déplace des lignes vers le haut ou le bas (Alt+↑ / Alt+↓)", () => {
    expect(moveLines("a\nb\nc", 2, 2, -1)).toEqual({ text: "b\na\nc", start: 0, end: 0 });
    expect(moveLines("a\nb\nc", 0, 3, 1)).toEqual({ text: "c\na\nb", start: 2, end: 5 });
    expect(moveLines("a\nb", 0, 0, -1)).toBeNull();
    expect(moveLines("a\nb", 2, 2, 1)).toBeNull();
  });
});

describe("couleurs d'un côté", () => {
  it("marque ajouts, modifications et suppressions par rapport à la référence", async () => {
    const { sideDiff } = await import("./conflicts");
    expect(sideDiff(["a", "b", "c"], ["a", "B", "c", "d"])).toEqual([
      { text: "a", kind: "same" },
      { text: "B", kind: "mod", ref: "b" },
      { text: "c", kind: "same" },
      { text: "d", kind: "add" },
    ]);
    expect(sideDiff(["a", "b", "c"], ["a", "c"])).toEqual([
      { text: "a", kind: "same" },
      { text: "b", kind: "del" },
      { text: "c", kind: "same" },
    ]);
    expect(sideDiff([], ["x"])).toEqual([{ text: "x", kind: "add" }]);
  });
});

describe("appariement des lignes modifiées", () => {
  it("apparie une ligne modifiée à celle qui lui ressemble, pas à la première venue", async () => {
    const { sideDiff } = await import("./conflicts");
    expect(sideDiff(["let a = 1, b = 2;"], ["import o;", "let a = 10, b = 2;"])).toEqual([
      { text: "import o;", kind: "add" },
      { text: "let a = 10, b = 2;", kind: "mod", ref: "let a = 1, b = 2;" },
    ]);
    // Autant de lignes de chaque côté : une à une, même réécrites.
    expect(sideDiff(["x", "a"], ["tout autre chose", "a"])).toEqual([
      { text: "tout autre chose", kind: "mod", ref: "x" },
      { text: "a", kind: "same" },
    ]);
  });
});
