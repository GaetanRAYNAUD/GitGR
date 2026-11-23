import { describe, expect, it } from "vitest";
import { compareOf, orderPicked, rangeShas, squashable } from "./multiSelect";
import { EMPTY_TREE } from "./stashes";

const c = (sha: string, ...parents: string[]) => ({ sha, parents });
//  m      fusion de b et f
//  | f2
//  | f1
//  b |
//  |/
//  a      premier commit
const graph = [c("m", "b", "f2"), c("f2", "f1"), c("f1", "a"), c("b", "a"), c("a")];

describe("sélection de plusieurs commits", () => {
  it("garde l'ordre du graphe, quel que soit l'ordre des clics", () => {
    expect(orderPicked(graph, ["a", "m", "f1"]).map((x) => x.sha)).toEqual(["m", "f1", "a"]);
  });

  it("plage : tous les commits du graphe entre les deux, dans un sens ou dans l'autre", () => {
    expect(rangeShas(graph, "f2", "b")).toEqual(["f2", "f1", "b"]);
    expect(rangeShas(graph, "b", "f2")).toEqual(["f2", "f1", "b"]);
    expect(rangeShas(graph, "zzz", "b")).toEqual(["b"]);
  });

  it("chaîne de parents : cumul depuis le parent du plus ancien", () => {
    expect(compareOf(orderPicked(graph, ["f1", "f2"]))).toEqual({ kind: "chain", base: "a", tip: "f2" });
    // À travers la fusion, par son second parent.
    expect(compareOf(orderPicked(graph, ["m", "f2"]))).toEqual({ kind: "chain", base: "f1", tip: "m" });
    // Jusqu'au premier commit : depuis l'arbre vide.
    expect(compareOf(orderPicked(graph, ["b", "a"]))).toEqual({ kind: "chain", base: EMPTY_TREE, tip: "b" });
  });

  it("squash : chaîne de premiers parents, sans fusion", () => {
    expect(squashable(orderPicked(graph, ["f1", "f2"]))).toBe(true);
    expect(squashable(orderPicked(graph, ["b", "a"]))).toBe(false); // jusqu'au premier commit
    expect(squashable(orderPicked(graph, ["m", "b"]))).toBe(false); // fusion
    expect(squashable(orderPicked(graph, ["f2", "a"]))).toBe(false); // pas contigus
    expect(squashable(orderPicked(graph, ["b"]))).toBe(false);
  });

  it("deux commits sans lien direct : de l'un à l'autre ; plus : seulement la liste", () => {
    expect(compareOf(orderPicked(graph, ["f2", "b"]))).toEqual({ kind: "pair", base: "b", tip: "f2" });
    expect(compareOf(orderPicked(graph, ["f2", "f1", "b"]))).toEqual({ kind: "sparse" });
    expect(compareOf(orderPicked(graph, ["m"]))).toEqual({ kind: "sparse" });
  });
});
