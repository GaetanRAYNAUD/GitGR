import { describe, expect, it } from "vitest";
import { typeAhead } from "./treeNav";

describe("recherche à la frappe dans un arbre", () => {
  const labels = ["Local", "feature", "graph-rendering", "profils", "fix", "main"];

  it("va au suivant qui commence par les lettres tapées, sans casse, en bouclant", () => {
    expect(typeAhead(labels, 0, "f")).toBe(1);
    expect(typeAhead(labels, 1, "f")).toBe(4); // suivant, pas le même
    expect(typeAhead(labels, 4, "F")).toBe(1); // boucle
    expect(typeAhead(labels, 0, "pro")).toBe(3);
  });

  it("rien ne correspond : -1", () => {
    expect(typeAhead(labels, 0, "zz")).toBe(-1);
  });
});
