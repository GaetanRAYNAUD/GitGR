import { describe, expect, it } from "vitest";
import { matches, plan, type RefSnapshot, unchanged } from "./undo";

const snap = (headBranch: string | null, head: string, branches: Record<string, string>): RefSnapshot => ({ head, headBranch, branches });

describe("plan d'annulation", () => {
  it("commit : la branche courante revient en arrière en soft", () => {
    const before = snap("main", "a", { main: "a" });
    const after = snap("main", "b", { main: "b" });
    expect(plan(after, before, true)).toEqual([{ kind: "tip", branch: "main", expected: "b", target: "a", mode: "soft" }]);
    expect(plan(before, after, true)).toEqual([{ kind: "tip", branch: "main", expected: "a", target: "b", mode: "soft" }]);
  });

  it("merge : keep pour la courante", () => {
    const before = snap("main", "a", { main: "a", f: "f" });
    const after = snap("main", "m", { main: "m", f: "f" });
    expect(plan(after, before, false)).toEqual([{ kind: "tip", branch: "main", expected: "m", target: "a", mode: "keep" }]);
  });

  it("checkout : retour sur la branche d'avant", () => {
    const before = snap("main", "a", { main: "a", f: "f" });
    const after = snap("f", "f", { main: "a", f: "f" });
    expect(plan(after, before, false)).toEqual([{ kind: "checkout", branch: "main", sha: "a" }]);
  });

  it("nouvelle branche extraite : checkout d'abord, puis elle est supprimée", () => {
    const before = snap("main", "a", { main: "a" });
    const after = snap("neuve", "a", { main: "a", neuve: "a" });
    expect(plan(after, before, false)).toEqual([
      { kind: "checkout", branch: "main", sha: "a" },
      { kind: "tip", branch: "neuve", expected: "a", target: null, mode: "keep" },
    ]);
    // Rétablir : recréée, puis extraite.
    expect(plan(before, after, false)).toEqual([
      { kind: "tip", branch: "neuve", expected: null, target: "a", mode: "keep" },
      { kind: "checkout", branch: "neuve", sha: "a" },
    ]);
  });

  it("branche supprimée : recréée", () => {
    const before = snap("main", "a", { main: "a", vieille: "v" });
    const after = snap("main", "a", { main: "a" });
    expect(plan(after, before, false)).toEqual([{ kind: "tip", branch: "vieille", expected: null, target: "v", mode: "keep" }]);
  });

  it("HEAD détachée qui avance : reset de HEAD", () => {
    const before = snap(null, "a", { main: "a" });
    const after = snap(null, "b", { main: "a" });
    expect(plan(after, before, true)).toEqual([{ kind: "tip", branch: null, expected: "b", target: "a", mode: "soft" }]);
  });

  it("état qui a changé : refusé ; rien de bougé : rien à noter", () => {
    const before = snap("main", "a", { main: "a", f: "f" });
    const after = snap("main", "b", { main: "b", f: "f" });
    expect(matches(snap("main", "b", { main: "b", f: "autre" }), after, before)).toBe(true);
    expect(matches(snap("main", "c", { main: "c", f: "f" }), after, before)).toBe(false);
    expect(matches(snap("f", "b", { main: "b", f: "f" }), after, before)).toBe(false);
    expect(unchanged(before, snap("main", "a", { f: "f", main: "a" }))).toBe(true);
    expect(unchanged(before, after)).toBe(false);
  });
});
