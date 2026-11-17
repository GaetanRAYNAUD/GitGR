import { describe, expect, it } from "vitest";
import { branchTitle, draftText, pullSource, pullTargetOf } from "./pulls";
import type { GitRef, RefsInfo } from "./types";

const ref = (kind: GitRef["kind"], short: string, extra: Partial<GitRef> = {}): GitRef => ({
  name: `${kind}/${short}`,
  short,
  kind,
  target: "a",
  upstream: null,
  ahead: 0,
  behind: 0,
  gone: false,
  ...extra,
});

const refs = (list: GitRef[], remotes = ["origin", "team/fork"]): RefsInfo => ({
  head: "a",
  headBranch: "uat",
  stashes: 0,
  autostash: null,
  remotes: remotes.map((name) => ({ name, url: null, pushUrl: null })),
  refs: list,
});

describe("pullSource", () => {
  it("branche suivie : son remote et son nom distant, à pousser si en avance", () => {
    const info = refs([ref("local", "uat", { upstream: "team/fork/recette" }), ref("local", "fix", { upstream: "origin/fix", ahead: 2 })]);
    expect(pullSource(info, "uat")).toEqual({ branch: "uat", remote: "team/fork", remoteBranch: "recette", needsPush: false });
    expect(pullSource(info, "fix")).toMatchObject({ remote: "origin", needsPush: true });
  });

  it("sans suivi (ou suivi disparu) : origin, même nom, à pousser", () => {
    const info = refs([ref("local", "neuve"), ref("local", "partie", { upstream: "origin/bugfix-12", gone: true })]);
    expect(pullSource(info, "neuve")).toEqual({ branch: "neuve", remote: "origin", remoteBranch: "neuve", needsPush: true });
    // Suivi disparu : poussée vers la même branche distante, recréée.
    expect(pullSource(info, "partie")).toEqual({ branch: "partie", remote: "origin", remoteBranch: "bugfix-12", needsPush: true });
    expect(pullSource(refs([ref("local", "x")], ["amont"]), "x")?.remote).toBe("amont");
    expect(pullSource(refs([ref("local", "x")], []), "x")?.remote).toBeNull();
    expect(pullSource(info, "absente")).toBeNull();
  });
});

describe("pullTargetOf", () => {
  const info = refs([]);
  it("distante, ou branche suivie d'une locale", () => {
    expect(pullTargetOf(info, ref("remote", "origin/main"))).toEqual({ remote: "origin", branch: "main" });
    expect(pullTargetOf(info, ref("remote", "team/fork/release/1.0"))).toEqual({ remote: "team/fork", branch: "release/1.0" });
    expect(pullTargetOf(info, ref("local", "main", { upstream: "origin/main" }))).toEqual({ remote: "origin", branch: "main" });
  });

  it("rien pour une locale sans suivi, un tag ou origin/HEAD", () => {
    expect(pullTargetOf(info, ref("local", "main"))).toBeNull();
    expect(pullTargetOf(info, ref("local", "main", { upstream: "origin/main", gone: true }))).toBeNull();
    expect(pullTargetOf(info, ref("tag", "v1"))).toBeNull();
    expect(pullTargetOf(info, ref("remote", "origin/HEAD"))).toBeNull();
  });
});

describe("draftText", () => {
  it("un commit : son message", () => {
    expect(draftText([{ subject: "Ajoute X", body: "Parce que." }], "feat/x", null)).toEqual({ title: "Ajoute X", body: "Parce que." });
  });

  it("plusieurs commits : nom de la branche et liste", () => {
    expect(draftText([{ subject: "Un", body: "" }, { subject: "Deux", body: "b" }], "feature/mon-ajout", null)).toEqual({ title: "Feature/mon ajout", body: "- Un\n- Deux" });
  });

  it("le modèle du dépôt remplace la description", () => {
    expect(draftText([{ subject: "Un", body: "corps" }], "x", "## Quoi").body).toBe("## Quoi");
    expect(draftText([], "x", null)).toEqual({ title: "X", body: "" });
  });

  it("titre tiré de la branche", () => {
    expect(branchTitle("fix_le-bug")).toBe("Fix le bug");
  });
});
