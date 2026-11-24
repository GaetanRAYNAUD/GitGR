import { describe, expect, it } from "vitest";
import { commitMatches, findQuery, nextMatch } from "./graphFind";

const c = { sha: "8a3c45c0ffee", subject: "fix: Correctif du graphe", author: "Sam Leroy", email: "sam@exemple.fr" };

describe("recherche dans le graphe", () => {
  it("normalise le texte cherché", () => {
    expect(findQuery("  ")).toBeNull();
    expect(findQuery(" Graphe ")).toBe("graphe");
  });

  it("cherche dans le sujet, l'auteur, l'e-mail et le début du SHA", () => {
    expect(commitMatches(c, "correctif")).toBe(true);
    expect(commitMatches(c, "leroy")).toBe(true);
    expect(commitMatches(c, "exemple.fr")).toBe(true);
    expect(commitMatches(c, "8a3c")).toBe(true);
    expect(commitMatches(c, "3c45")).toBe(false);
    expect(commitMatches(c, "8a3")).toBe(false);
    expect(commitMatches(c, "absent")).toBe(false);
  });

  it("passe au résultat suivant ou précédent, en boucle", () => {
    const m = [2, 5, 9];
    expect(nextMatch(m, -1, 1)).toBe(2);
    expect(nextMatch(m, 5, 1)).toBe(9);
    expect(nextMatch(m, 9, 1)).toBe(2);
    expect(nextMatch(m, 6, 1)).toBe(9);
    expect(nextMatch(m, -1, -1)).toBe(9);
    expect(nextMatch(m, 5, -1)).toBe(2);
    expect(nextMatch(m, 2, -1)).toBe(9);
    expect(nextMatch([], 3, 1)).toBeNull();
  });
});
