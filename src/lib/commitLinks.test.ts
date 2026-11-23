import { describe, expect, it } from "vitest";
import { commitSegments } from "./commitLinks";

describe("commitSegments", () => {
  it("finds references, SHAs and URLs", () => {
    expect(commitSegments("Fix #12 and !5 (see https://ex.com/a_(b)). Reverts 1a2b3c4d")).toEqual([
      { t: "text", v: "Fix " },
      { t: "ref", v: "#12", sigil: "#", number: 12, repo: null },
      { t: "text", v: " and " },
      { t: "ref", v: "!5", sigil: "!", number: 5, repo: null },
      { t: "text", v: " (see " },
      { t: "url", v: "https://ex.com/a_(b)" },
      { t: "text", v: "). Reverts " },
      { t: "sha", v: "1a2b3c4d" },
    ]);
  });

  it("reads owner/repo#N, groups included", () => {
    expect(commitSegments("Closes demo/api#7, group/sub/app!3")).toEqual([
      { t: "text", v: "Closes " },
      { t: "ref", v: "demo/api#7", sigil: "#", number: 7, repo: "demo/api" },
      { t: "text", v: ", " },
      { t: "ref", v: "group/sub/app!3", sigil: "!", number: 3, repo: "group/sub/app" },
    ]);
  });

  it("leaves words, plain numbers and anchors in URLs alone", () => {
    expect(commitSegments("issue#4 Wow!5 1234567 deadbeef v1.2.3")).toEqual([{ t: "text", v: "issue#4 Wow!5 1234567 deadbeef v1.2.3" }]);
    expect(commitSegments("https://ex.com/p#12")).toEqual([{ t: "url", v: "https://ex.com/p#12" }]);
  });
});
