import { describe, expect, it } from "vitest";
import { chipsByCommit, refSections, refTree, sectionLabel } from "./refs";
import type { GitRef, RefsInfo } from "./types";

const ref = (kind: GitRef["kind"], short: string, target: string): GitRef => ({
  name: `${kind}/${short}`,
  short,
  kind,
  target,
  upstream: null,
  ahead: 0,
  behind: 0,
  gone: false,
});

const info: RefsInfo = {
  head: "a",
  headBranch: "main",
  stashes: 0,
  autostash: null,
  refs: [
    ref("local", "feature", "b"),
    ref("local", "main", "a"),
    ref("remote", "origin/main", "a"),
    ref("remote", "origin/feature", "c"),
    ref("remote", "upstream/main", "a"),
    ref("tag", "v1.2.0", "a"),
    ref("tag", "v1.10.0", "b"),
  ],
};

describe("chipsByCommit", () => {
  it("fusionne une branche locale et ses distantes du même nom au même commit", () => {
    const a = chipsByCommit(info).get("a")!;
    expect(a.map((c) => c.label)).toEqual(["main", "v1.2.0"]);
    expect(a[0]).toMatchObject({ current: true, synced: true, title: "main · origin/main · upstream/main" });
  });

  it("affiche à part une distante qui pointe ailleurs", () => {
    const m = chipsByCommit(info);
    expect(m.get("b")!.map((c) => [c.label, c.synced])).toEqual([
      ["feature", false],
      ["v1.10.0", false],
    ]);
    expect(m.get("c")!.map((c) => c.kind)).toEqual(["remote"]);
  });

  it("HEAD détachée : étiquette HEAD en premier", () => {
    const m = chipsByCommit({ ...info, headBranch: null, head: "b" });
    expect(m.get("b")![0]).toMatchObject({ label: "HEAD", kind: "head", current: true });
    expect(m.get("a")![0].current).toBe(false);
  });

  it("sans refs : rien", () => {
    expect(chipsByCommit(null).size).toBe(0);
  });
});

describe("refSections", () => {
  it("locales, un remote par section, puis tags triés par version décroissante", () => {
    const s = refSections(info);
    expect(s.map((x) => x.key)).toEqual(["local", "remote:origin", "remote:upstream", "tags"]);
    expect(s[0].items.map((r) => r.short)).toEqual(["feature", "main"]);
    expect(s[1].items.map(sectionLabel)).toEqual(["feature", "main"]);
    expect(s[3].items.map((r) => r.short)).toEqual(["v1.10.0", "v1.2.0"]);
  });
});

describe("refTree", () => {
  it("regroupe les branches par préfixe, dossiers d'abord, sur plusieurs niveaux", () => {
    const refs = ["main", "feature/b", "feature/a", "fix/ssh", "feature/ui/menu", "dev"].map((n) => ref("local", n, "x"));
    const tree = refTree(refs);
    const shape = (nodes: ReturnType<typeof refTree>): unknown[] =>
      nodes.map((n) => (n.type === "folder" ? { [n.name]: shape(n.children), count: n.count } : n.name));
    expect(shape(tree)).toEqual([
      { feature: [{ ui: ["menu"], count: 1 }, "a", "b"], count: 3 },
      { fix: ["ssh"], count: 1 },
      "dev",
      "main",
    ]);
    const feature = tree[0];
    expect(feature.type === "folder" && feature.children[0].type === "folder" && feature.children[0].path).toBe("feature/ui");
  });

  it("les distantes sont rangées sans le nom du remote", () => {
    const tree = refTree([ref("remote", "origin/feature/x", "a"), ref("remote", "origin/main", "b")]);
    expect(tree.map((n) => n.name)).toEqual(["feature", "main"]);
  });
});
