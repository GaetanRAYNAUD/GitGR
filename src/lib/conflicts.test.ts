import { describe, expect, it } from "vitest";
import { chooseLines, composeResolution, moveLines, parseConflicts, type ConflictBlock } from "./conflicts";

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

  it("lit la version commune (diff3) et garde les fins de ligne Windows", () => {
    const p = parseConflicts("<<<<<<< ours\r\na\r\n||||||| base\r\nb\r\n=======\r\nc\r\n>>>>>>> theirs");
    expect(p.segments[0]).toMatchObject({ ours: ["a"], base: ["b"], theirs: ["c"] });
    expect(p.eol).toBe("\r\n");
    expect(composeResolution(p, [["x", "y"]])).toBe("x\r\ny");
  });

  it("laisse tel quel un bloc mal fermé", () => {
    const p = parseConflicts("<<<<<<< HEAD\na\n=======\nb\n");
    expect(p.segments).toEqual([{ kind: "common", lines: ["<<<<<<< HEAD", "a", "=======", "b"] }]);
  });

  it("recompose le fichier d'après les choix, marqueurs remis pour un bloc non résolu", () => {
    const p = parseConflicts(FILE);
    const seg = p.segments[1] as ConflictBlock;
    expect(chooseLines(seg, "theirs-ours")).toEqual(["deux là-bas", "trois là-bas", "deux ici"]);
    expect(composeResolution(p, [chooseLines(seg, "ours")])).toBe("un\ndeux ici\nquatre\n");
    expect(composeResolution(p, [[]])).toBe("un\nquatre\n");
    expect(composeResolution(p, [null])).toBe(FILE);
  });

  it("déplace des lignes vers le haut ou le bas (Alt+↑ / Alt+↓)", () => {
    expect(moveLines("a\nb\nc", 2, 2, -1)).toEqual({ text: "b\na\nc", start: 0, end: 0 });
    expect(moveLines("a\nb\nc", 0, 3, 1)).toEqual({ text: "c\na\nb", start: 2, end: 5 });
    expect(moveLines("a\nb", 0, 0, -1)).toBeNull();
    expect(moveLines("a\nb", 2, 2, 1)).toBeNull();
  });
});
