import { describe, expect, it } from "vitest";
import { chipsByCommit, fitChips, recentBranches, refSections, refTree, sectionLabel } from "./refs";
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
  remotes: [],
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

  it("remote de chaque étiquette : upstream, sinon jumelle, sinon aucun", () => {
    const withUpstream = {
      ...info,
      remotes: [
        { name: "team/fork", url: null, pushUrl: null },
        { name: "team", url: null, pushUrl: null },
      ],
      refs: [
        { ...ref("local", "main", "a"), upstream: "upstream/main" },
        ref("local", "solo", "d"),
        ref("local", "feature", "c"),
        ref("remote", "origin/feature", "c"),
        ref("remote", "upstream/main", "a"),
        ref("remote", "team/fork/x", "e"),
      ],
    };
    const m = chipsByCommit(withUpstream);
    expect(m.get("a")![0].remote).toBe("upstream");
    expect(m.get("c")![0].remote).toBe("origin");
    expect(m.get("d")![0].remote).toBeUndefined();
    expect(m.get("e")![0].remote).toBe("team/fork");
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

  it("un remote sans branche récupérée a sa section, vide", () => {
    const remote = (name: string) => ({ name, url: `git@exemple.fr:${name}.git`, pushUrl: null });
    const s = refSections({ ...info, remotes: [remote("client"), remote("origin"), remote("upstream")] });
    expect(s.map((x) => [x.key, x.items.length])).toEqual([
      ["local", 2],
      ["remote:client", 0],
      ["remote:origin", 2],
      ["remote:upstream", 1],
      ["tags", 2],
    ]);
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

describe("fitChips", () => {
  const z = (natural: number, min: number) => ({ natural, min });

  it("shows every label when they fit, whole or shortened", () => {
    expect(fitChips([z(60, 40), z(50, 30)], 120, 34)).toBe(2);
    expect(fitChips([z(80, 40), z(80, 30)], 80, 34)).toBe(2);
    expect(fitChips([z(300, 40)], 50, 34)).toBe(1);
    expect(fitChips([], 50, 34)).toBe(0);
  });

  it("groups the labels that do not fit, keeping room for +N", () => {
    // 40 + 4 + 30 + 4 + 34 = 112 ≤ 120 ; la troisième ne tient plus.
    expect(fitChips([z(80, 40), z(80, 30), z(80, 30), z(80, 30)], 120, 34)).toBe(2);
  });

  it("always keeps the first label (current branch)", () => {
    expect(fitChips([z(200, 100), z(80, 30)], 120, 34)).toBe(1);
  });
});

describe("recentBranches", () => {
  const co = (message: string, action = "checkout") => ({ sha: "a", action, message, time: 0, subject: "" });
  it("lit les checkouts du reflog, les plus récents d'abord, sans doublon ni la courante", () => {
    const log = [co("moving from feat to main"), co("x", "commit"), co("moving from fix to feat"), co("moving from main to fix"), co("moving from old to main")];
    expect(recentBranches(log, ["main", "feat", "fix"], "main")).toEqual(["feat", "fix"]);
  });
  it("ignore les SHA (HEAD détachée) et respecte le maximum", () => {
    const log = [co("moving from a to 1234567"), co("moving from b to a"), co("moving from c to b")];
    expect(recentBranches(log, ["a", "b", "c"], null, 2)).toEqual(["a", "b"]);
  });
});
