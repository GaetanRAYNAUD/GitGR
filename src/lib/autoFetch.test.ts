import { describe, expect, it } from "vitest";
import { dueTab } from "./autoFetch";

describe("dueTab", () => {
  const last: Record<string, number> = { a: 0, b: 500, c: 900 };
  it("le plus anciennement récupéré, hors onglet affiché et dépôts occupés", () => {
    expect(dueTab(["a", "b", "c"], "a", () => false, (p) => last[p], 1000, 400)).toBe("b");
    expect(dueTab(["a", "b", "c"], null, (p) => p === "a", (p) => last[p], 1000, 400)).toBe("b");
    expect(dueTab(["a", "b", "c"], null, () => false, (p) => last[p], 1000, 400)).toBe("a");
  });
  it("aucun s'ils sont tous récents", () => {
    expect(dueTab(["b", "c"], null, () => false, (p) => last[p], 1000, 600)).toBeNull();
  });
});
