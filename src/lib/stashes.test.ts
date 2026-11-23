import { describe, expect, it } from "vitest";
import { stashLabel } from "./stashes";

describe("stashLabel", () => {
  it("splits the branch from the message", () => {
    expect(stashLabel("On main: essai: avec deux-points")).toEqual({ branch: "main", text: "essai: avec deux-points" });
    expect(stashLabel("WIP on feature/x: abc1234 sujet")).toEqual({ branch: "feature/x", text: "abc1234 sujet" });
  });

  it("keeps an unknown form as is", () => {
    expect(stashLabel("autre chose")).toEqual({ branch: null, text: "autre chose" });
  });
});
