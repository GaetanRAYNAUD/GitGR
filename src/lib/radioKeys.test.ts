import { describe, expect, it } from "vitest";
import { radioKeyTarget, radioTabIndex } from "./radioKeys";

describe("radioKeyTarget", () => {
  it("avance et recule en boucle", () => {
    expect(radioKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(radioKeyTarget("ArrowDown", 2, 3)).toBe(0);
    expect(radioKeyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(radioKeyTarget("ArrowUp", 1, 3)).toBe(0);
  });

  it("Début et Fin", () => {
    expect(radioKeyTarget("Home", 2, 4)).toBe(0);
    expect(radioKeyTarget("End", 0, 4)).toBe(3);
  });

  it("ignore les autres touches et les groupes vides", () => {
    expect(radioKeyTarget("Enter", 0, 3)).toBeNull();
    expect(radioKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("radioTabIndex", () => {
  it("seule l'option choisie est atteinte par Tab", () => {
    expect(radioTabIndex(true, false, true)).toBe(0);
    expect(radioTabIndex(false, true, true)).toBe(-1);
  });

  it("sans option choisie, la première", () => {
    expect(radioTabIndex(false, true, false)).toBe(0);
    expect(radioTabIndex(false, false, false)).toBe(-1);
  });
});
