import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { DiffLine, GitRef, PullList, PullSummary, RefsInfo } from "../lib/types";
import { diffStats } from "../components/graph/DiffStats";
import { accountLogin, filterPulls, pullCtxKey, pullOfRef, resetPullList, usePullList, type PullContext } from "./pullList";

const person = (login: string) => ({ id: 1, login });
const pull = (number: number, over: Partial<PullSummary> = {}): PullSummary => ({
  number,
  title: `PR ${number}`,
  url: `https://x/${number}`,
  state: "open",
  author: person("alix"),
  sourceBranch: `b${number}`,
  fork: false,
  targetBranch: "main",
  headSha: null,
  createdAt: 0,
  updatedAt: 0,
  review: null,
  checks: null,
  reviewers: [],
  assignees: [],
  labels: [],
  ...over,
});
const ctx: PullContext = { remote: "origin", kind: "github", url: "https://github.com", repo: "Org/Depot", account: "github|https://github.com|alix" };
const ref = (kind: GitRef["kind"], short: string, upstream: string | null = null): GitRef =>
  ({ name: short, short, kind, target: "abc", upstream, ahead: 0, behind: 0, gone: false }) as unknown as GitRef;

beforeEach(() => {
  resetPullList();
  vi.restoreAllMocks();
});

describe("filterPulls", () => {
  const pulls = [pull(1), pull(2, { author: person("max"), reviewers: [person("Alix")] }), pull(3, { author: person("max"), assignees: [person("alix")] })];
  it("les miennes : auteur ou assigné ; à relire : relecture demandée", () => {
    expect(filterPulls(pulls, "all", "alix").map((p) => p.number)).toEqual([1, 2, 3]);
    expect(filterPulls(pulls, "mine", "ALIX").map((p) => p.number)).toEqual([1, 3]);
    expect(filterPulls(pulls, "review", "alix").map((p) => p.number)).toEqual([2]);
    // Sans compte : tout.
    expect(filterPulls(pulls, "mine", null)).toHaveLength(3);
  });
  it("login du compte", () => {
    expect(accountLogin("gitlab|https://gitlab.exemple.fr|camille.dupont")).toBe("camille.dupont");
    expect(accountLogin(null)).toBeNull();
  });
});

describe("pullOfRef", () => {
  const refs = { remotes: [{ name: "origin", url: "u", pushUrl: null }], refs: [], headBranch: "x" } as unknown as RefsInfo;
  const lists = { [pullCtxKey(ctx)]: { list: { pulls: [pull(7, { sourceBranch: "feature/x" }), pull(8, { sourceBranch: "fork-b", fork: true })], fetchedAt: 0, truncated: false }, loading: false, error: null } };
  it("branche distante, ou locale par sa branche suivie ; jamais une PR de fork", () => {
    expect(pullOfRef(lists, [ctx], refs, ref("remote", "origin/feature/x"))?.pull.number).toBe(7);
    expect(pullOfRef(lists, [ctx], refs, ref("local", "x", "origin/feature/x"))?.pull.number).toBe(7);
    expect(pullOfRef(lists, [ctx], refs, ref("remote", "origin/fork-b"))).toBeNull();
    expect(pullOfRef(lists, [ctx], refs, ref("local", "seule"))).toBeNull();
    expect(pullOfRef(lists, [ctx], refs, ref("tag", "v1"))).toBeNull();
  });
});

describe("usePullList.ensure", () => {
  it("relit seulement une liste vieille de plus de deux minutes, ou sur demande", async () => {
    const list: PullList = { pulls: [pull(1)], fetchedAt: Math.floor(Date.now() / 1000), truncated: false };
    const spy = vi.spyOn(api, "listPulls").mockResolvedValue(list);
    await usePullList.getState().ensure(ctx);
    await usePullList.getState().ensure(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    await usePullList.getState().ensure(ctx, true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(usePullList.getState().lists[pullCtxKey(ctx)].list?.pulls).toHaveLength(1);
  });
  it("sans compte, rien n'est demandé ; un échec n'est pas réessayé d'office", async () => {
    const spy = vi.spyOn(api, "listPulls").mockRejectedValue("rate_limited");
    await usePullList.getState().ensure({ ...ctx, account: null });
    expect(spy).not.toHaveBeenCalled();
    await usePullList.getState().ensure(ctx);
    await usePullList.getState().ensure(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(usePullList.getState().lists[pullCtxKey(ctx)].error).toBe("rate_limited");
  });
  it("une action réussie relit le détail et la liste ; un échec est gardé pour l'affichage", async () => {
    vi.spyOn(api, "listPulls").mockResolvedValue({ pulls: [], fetchedAt: 0, truncated: false });
    const detail = vi.spyOn(api, "pullDetail").mockResolvedValue({ ...pull(3), body: "", reviews: [], threads: [], checksList: [], merge: { canMerge: true, blockers: [], methods: ["merge"], deleteBranch: false, autoMerge: null }, canUpdate: true });
    const act = vi.spyOn(api, "pullAct").mockResolvedValueOnce(undefined).mockRejectedValueOnce("pull_not_mergeable");
    expect(await usePullList.getState().act(ctx, 3, { type: "comment", body: "ok" })).toBe(true);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(await usePullList.getState().act(ctx, 3, { type: "merge", method: "merge", deleteBranch: false, auto: false })).toBe(false);
    expect(act).toHaveBeenCalledTimes(2);
    expect(Object.values(usePullList.getState().details)[0].actionError).toBe("pull_not_mergeable");
  });
});

describe("diffStats", () => {
  it("compte les lignes ajoutées et supprimées", () => {
    const lines = (kinds: string) => [...kinds].map((k) => ({ kind: k as DiffLine["kind"], old: null, new: null, text: "" }));
    expect(diffStats({ binary: false, truncated: false, fingerprint: "", hunks: [{ header: "", lines: lines("+- +") }, { header: "", lines: lines("--") }] })).toEqual({ added: 2, removed: 3 });
  });
});
