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

describe("couleurs d'un côté", () => {
  it("marque ajouts, modifications et suppressions par rapport à la référence", async () => {
    const { sideDiff } = await import("./conflicts");
    expect(sideDiff(["a", "b", "c"], ["a", "B", "c", "d"])).toEqual([
      { text: "a", kind: "same" },
      { text: "B", kind: "mod" },
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

describe("choix ligne par ligne", () => {
  it("garde les lignes cochées dans l'ordre des clics", async () => {
    const { pickLines, picksOf, togglePick, chooseLines } = await import("./conflicts");
    const seg = {
      kind: "conflict" as const,
      ours: ["import a;", "import b;", "import c;", "import d;"],
      theirs: ["import x;", "import y;", "import z;"],
      base: null,
      oursLabel: "HEAD",
      theirsLabel: "sujet",
    };
    // 2 à gauche, 1 à droite, puis encore 1 à gauche : dans cet ordre.
    let p = togglePick([], "ours", 2);
    p = togglePick(p, "ours", 0);
    p = togglePick(p, "theirs", 1);
    p = togglePick(p, "ours", 3);
    expect(pickLines(seg, p)).toEqual(["import c;", "import a;", "import y;", "import d;"]);
    p = togglePick(p, "ours", 0);
    expect(pickLines(seg, p)).toEqual(["import c;", "import y;", "import d;"]);
    for (const c of ["ours", "theirs", "ours-theirs", "theirs-ours", "none"] as const) expect(pickLines(seg, picksOf(seg, c))).toEqual(chooseLines(seg, c));
  });
});
