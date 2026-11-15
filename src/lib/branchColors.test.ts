import { describe, expect, it } from "vitest";
import { chipFixedColor, DEFAULT_BRANCH_COLORS, fixedColor, fixedColorsByCommit } from "./branchColors";
import { layoutGraph } from "./graph";
import type { RefsInfo } from "./types";

describe("branchColors", () => {
  const rules = DEFAULT_BRANCH_COLORS;

  it("matche les noms exacts et les motifs", () => {
    expect(fixedColor(rules, "main")).toBe(0);
    expect(fixedColor(rules, "release/1.2")).toBe(1);
    expect(fixedColor(rules, "mainline")).toBeUndefined();
    expect(fixedColor(rules, "feature/x")).toBeUndefined();
  });

  it("ignore le remote et les tags", () => {
    expect(chipFixedColor(rules, "remote", "origin/develop")).toBe(5);
    expect(chipFixedColor(rules, "tag", "main")).toBeUndefined();
    expect(chipFixedColor([], "local", "main")).toBeUndefined();
  });

  it("colore la colonne à partir du commit de la branche", () => {
    const info = { refs: [{ name: "refs/heads/develop", short: "develop", kind: "local", target: "b" }] } as unknown as RefsInfo;
    const fixed = fixedColorsByCommit(rules, info);
    expect(fixed.get("b")).toBe(5);
    const { rows } = layoutGraph(
      [
        { sha: "a", parents: ["b"] },
        { sha: "b", parents: ["c"] },
        { sha: "c", parents: [] },
      ],
      fixed,
    );
    expect(rows[0].color).toBe(0);
    expect(rows[1].color).toBe(5);
    expect(rows[1].in).toEqual([0, 0]);
    expect(rows[2].color).toBe(5);
  });
});
