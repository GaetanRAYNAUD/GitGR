import { describe, expect, it } from "vitest";
import {
  chipFixedColor,
  customColors,
  DEFAULT_BRANCH_COLORS,
  exactRule,
  fixedColor,
  fixedColorsByCommit,
  laneCss,
  ruleName,
  withExactColor,
  withoutExactColor,
} from "./branchColors";
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

  it("place les couleurs libres après la palette", () => {
    const custom = [
      { pattern: "a", color: "#123456" },
      { pattern: "b", color: 2 },
      { pattern: "c", color: "#abcdef" },
      { pattern: "d", color: "#123456" },
    ];
    expect(fixedColor(custom, "a")).toBe(8);
    expect(fixedColor(custom, "b")).toBe(2);
    expect(fixedColor(custom, "c")).toBe(9);
    expect(fixedColor(custom, "d")).toBe(8);
    expect(laneCss(9, customColors(custom))).toBe("#abcdef");
    expect(laneCss(2, customColors(custom))).toBe("var(--g2)");
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

describe("couleur fixe d'un nom exact", () => {
  it("compare le nom sans le remote", () => {
    expect(ruleName("remote", "origin/feature/x")).toBe("feature/x");
    expect(ruleName("local", "feature/x")).toBe("feature/x");
  });

  it("ajoute la règle en tête quand aucune règle exacte n'existe", () => {
    const next = withExactColor(DEFAULT_BRANCH_COLORS, "feature/x", 3);
    expect(next[0]).toEqual({ pattern: "feature/x", color: 3 });
    expect(next.slice(1)).toEqual(DEFAULT_BRANCH_COLORS);
    expect(fixedColor(next, "feature/x")).toBe(3);
  });

  it("passe devant un motif qui couvre déjà le nom", () => {
    const next = withExactColor(DEFAULT_BRANCH_COLORS, "release/2.0", "#123456");
    expect(next[0]).toEqual({ pattern: "release/2.0", color: "#123456" });
    expect(fixedColor(next, "release/1.0")).toBe(1);
  });

  it("met à jour sur place une règle exacte qui l'emporte déjà", () => {
    const next = withExactColor(DEFAULT_BRANCH_COLORS, "develop", 7);
    expect(next.map((r) => r.pattern)).toEqual(DEFAULT_BRANCH_COLORS.map((r) => r.pattern));
    expect(exactRule(next, "develop")?.color).toBe(7);
    expect(DEFAULT_BRANCH_COLORS[2].color).toBe(5);
  });

  it("remonte une règle exacte cachée derrière un motif, sans doublon", () => {
    const rules = [
      { pattern: "feat*", color: 1 },
      { pattern: "feature", color: 2 },
    ];
    expect(withExactColor(rules, "feature", 4)).toEqual([
      { pattern: "feature", color: 4 },
      { pattern: "feat*", color: 1 },
    ]);
  });

  it("retire seulement la règle exacte", () => {
    const rules = [
      { pattern: "release/2.0", color: 3 },
      ...DEFAULT_BRANCH_COLORS,
    ];
    const next = withoutExactColor(rules, "release/2.0");
    expect(next).toEqual(DEFAULT_BRANCH_COLORS);
    expect(exactRule(next, "release/2.0")).toBeUndefined();
    expect(fixedColor(next, "release/2.0")).toBe(1);
  });
});
