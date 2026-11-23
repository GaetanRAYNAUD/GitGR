import { describe, expect, it } from "vitest";
import { matchOptions, placeList } from "./MultiPicker";

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

describe("placeList", () => {
  const area = { top: 0, bottom: 800 };

  it("opens below when the list fits", () => {
    expect(placeList({ top: 100, bottom: 150 }, area)).toEqual({ up: false, max: 200 });
  });

  it("opens above near the bottom of the visible area", () => {
    expect(placeList({ top: 600, bottom: 700 }, area)).toEqual({ up: true, max: 200 });
  });

  it("takes the larger side and limits the height to it", () => {
    expect(placeList({ top: 110, bottom: 160 }, { top: 0, bottom: 300 })).toEqual({ up: false, max: 128 });
    expect(placeList({ top: 170, bottom: 220 }, { top: 0, bottom: 300 })).toEqual({ up: true, max: 158 });
  });
});
