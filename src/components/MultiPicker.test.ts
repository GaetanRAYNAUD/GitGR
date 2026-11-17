import { describe, expect, it } from "vitest";
import { matchOptions } from "./MultiPicker";

const o = (label: string, detail?: string) => ({ id: label, label, detail });

describe("matchOptions", () => {
  const list = [o("max"), o("alix", "Alix Émery"), o("dev-001", "Maxime Dupont"), o("zoe")];

  it("début du login ou du nom d'abord, puis le reste ; sans accents ni casse", () => {
    expect(matchOptions(list, "MAX").map((x) => x.id)).toEqual(["max", "dev-001"]);
    expect(matchOptions(list, "emery").map((x) => x.id)).toEqual(["alix"]);
    expect(matchOptions(list, "o").map((x) => x.id)).toEqual(["dev-001", "zoe"]);
  });

  it("recherche vide : tout, dans l'ordre", () => {
    expect(matchOptions(list, "  ")).toBe(list);
  });
});
