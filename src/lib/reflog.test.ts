import { describe, expect, it } from "vitest";
import { reflogMessage, reflogOp } from "./reflog";

describe("reflogOp", () => {
  it("reconnaît les opérations de Git", () => {
    expect(reflogOp("commit")).toBe("commit");
    expect(reflogOp("commit (amend)")).toBe("amend");
    expect(reflogOp("commit (initial)")).toBe("initial");
    expect(reflogOp("rebase (start)")).toBe("rebase");
    expect(reflogOp("rebase -i (pick)")).toBe("rebase");
    expect(reflogOp("rebase (finish)")).toBe("rebaseEnd");
    expect(reflogOp("rebase -i (finish)")).toBe("rebaseEnd");
    expect(reflogOp("pull --rebase")).toBe("pull");
    expect(reflogOp("merge origin/main")).toBe("merge");
    expect(reflogOp("update by push")).toBe("push");
    expect(reflogOp("clone: from x")).toBe("clone");
  });

  it("laisse le reste tel quel", () => {
    expect(reflogOp("filter-branch")).toBeNull();
    expect(reflogOp("")).toBeNull();
  });
});

describe("reflogMessage", () => {
  it("remet les messages fixes en phrase, refs raccourcies", () => {
    expect(reflogMessage("moving from main to feat/x")).toEqual({ key: "moving", vars: { from: "main", to: "feat/x" } });
    expect(reflogMessage("moving to HEAD~1")).toEqual({ key: "movingTo", vars: { to: "HEAD~1" } });
    expect(reflogMessage("returning to refs/heads/main")).toEqual({ key: "returning", vars: { to: "main" } });
    expect(reflogMessage("Created from HEAD")).toEqual({ key: "created", vars: { from: "HEAD" } });
    expect(reflogMessage("Fast-forward")).toEqual({ key: "fastForward", vars: {} });
    expect(reflogMessage("Merge made by the 'ort' strategy.")).toEqual({ key: "mergeMade", vars: {} });
  });

  it("garde un message de commit", () => {
    expect(reflogMessage("Graphe : couleurs")).toBeNull();
  });
});
