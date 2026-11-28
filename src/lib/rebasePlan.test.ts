import { describe, expect, it } from "vitest";
import { moveRow, planProblem, type PlanRow, rewritesPushed, summary } from "./rebasePlan";

const row = (sha: string, extra: Partial<PlanRow> = {}): PlanRow => ({ sha, subject: sha, original: sha, action: "pick", message: sha, pushed: false, time: 0, ...extra });
const orig = ["a", "b", "c"];

describe("plan de rebase", () => {
  it("déplace une ligne", () => {
    expect(moveRow(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveRow(["a", "b", "c"], 0, 5)).toEqual(["b", "c", "a"]);
  });

  it("dit ce qui empêche de lancer", () => {
    expect(planProblem([row("a"), row("b"), row("c")], orig)).toBe("rebase.why.nothing");
    expect(planProblem(orig.map((s) => row(s, { action: "drop" })), orig)).toBe("rebase.why.allDropped");
    expect(planProblem([row("a", { action: "drop" }), row("b", { action: "fixup" }), row("c")], orig)).toBe("rebase.why.squashFirst");
    expect(planProblem([row("a", { action: "reword", message: " " }), row("b"), row("c")], orig)).toBe("rebase.why.emptyMessage");
    expect(planProblem([row("b"), row("a"), row("c")], orig)).toBeNull();
  });

  it("commits poussés réécrits : seulement à partir du premier changement", () => {
    const rows = [row("a", { pushed: true }), row("b"), row("c", { action: "drop" })];
    expect(rewritesPushed(rows, orig)).toBe(false);
    expect(rewritesPushed([row("a", { pushed: true, action: "reword", message: "x" }), row("b"), row("c")], orig)).toBe(true);
  });

  it("résumé", () => {
    expect(summary([row("b"), row("a", { action: "squash" }), row("c", { action: "drop" })], orig)).toEqual({ reword: 0, squash: 1, drop: 1, moved: 2 });
  });
});
