import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { MOCK_COMMIT_COUNT, mockHistory } from "../lib/mockHistory";
import { REPO_A } from "../test/utils";
import { detailsKey, PAGE_SIZE, useGraph, WIP } from "./graph";

const g = () => useGraph.getState();
const repo = () => g().graphs[REPO_A];
const history = () => mockHistory(REPO_A);

afterEach(() => vi.restoreAllMocks());

describe("graphe : chargement", () => {
  it("charge les refs et la première page", async () => {
    await g().refresh(REPO_A);
    expect(repo().commits).toHaveLength(PAGE_SIZE);
    expect(repo().commits[0].sha).toBe(history().commits[0].sha);
    expect(repo().refs?.headBranch).toBe("main");
    expect(repo().done).toBe(false);
    expect(repo().loading).toBe(false);
  });

  it("ne relit pas l'historique si les refs n'ont pas changé", async () => {
    await g().refresh(REPO_A);
    const log = vi.spyOn(api, "repoLog");
    await g().refresh(REPO_A);
    expect(log).not.toHaveBeenCalled();
  });

  it("relit l'historique quand une ref bouge, en gardant la sélection si elle existe encore", async () => {
    await g().refresh(REPO_A);
    const kept = history().commits[3].sha;
    g().select(REPO_A, kept);
    const refs = history().refs;
    vi.spyOn(api, "repoRefs").mockResolvedValueOnce({ ...refs, head: history().commits[1].sha });
    const log = vi.spyOn(api, "repoLog");
    await g().refresh(REPO_A);
    expect(log).toHaveBeenCalledWith(REPO_A, 0, PAGE_SIZE);
    expect(repo().selected).toBe(kept);
  });

  it("charge la page suivante, sans doublon, jusqu'à la fin", async () => {
    await g().refresh(REPO_A);
    await g().loadMore(REPO_A);
    expect(repo().commits).toHaveLength(MOCK_COMMIT_COUNT);
    expect(new Set(repo().commits.map((c) => c.sha)).size).toBe(MOCK_COMMIT_COUNT);
    expect(repo().done).toBe(true);
    const log = vi.spyOn(api, "repoLog");
    await g().loadMore(REPO_A);
    expect(log).not.toHaveBeenCalled();
  });

  it("deux demandes simultanées de page suivante ne chargent qu'une page", async () => {
    await g().refresh(REPO_A);
    const log = vi.spyOn(api, "repoLog");
    await Promise.all([g().loadMore(REPO_A), g().loadMore(REPO_A)]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("une erreur de lecture est mémorisée", async () => {
    vi.spyOn(api, "repoLog").mockRejectedValueOnce("path_not_found");
    await g().refresh(REPO_A);
    expect(repo().error).toBe("path_not_found");
    expect(repo().loading).toBe(false);
  });

  it("une page arrivée après un rechargement complet est ignorée", async () => {
    await g().refresh(REPO_A);
    let resolve!: (v: Awaited<ReturnType<typeof api.repoLog>>) => void;
    vi.spyOn(api, "repoLog").mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const more = g().loadMore(REPO_A);
    g().drop(REPO_A);
    await g().refresh(REPO_A);
    resolve(history().commits.slice(PAGE_SIZE));
    await more;
    expect(repo().commits).toHaveLength(PAGE_SIZE);
  });
  it("après un rechargement complet, une page en vol ne bloque plus la suivante", async () => {
    await g().refresh(REPO_A);
    let resolve!: (v: Awaited<ReturnType<typeof api.repoLog>>) => void;
    vi.spyOn(api, "repoLog").mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const stale = g().loadMore(REPO_A);
    g().drop(REPO_A);
    await g().refresh(REPO_A);
    await g().loadMore(REPO_A); // ne doit pas attendre la page périmée
    expect(repo().commits).toHaveLength(MOCK_COMMIT_COUNT);
    resolve([]);
    await stale;
  });
});

describe("graphe : sélection, détails, diff", () => {
  it("sélectionner un commit charge ses détails", async () => {
    await g().refresh(REPO_A);
    const sha = history().commits[2].sha;
    g().select(REPO_A, sha);
    await vi.waitFor(() => expect(g().details[detailsKey(REPO_A, sha)]?.data?.sha).toBe(sha));
  });

  it("la ligne WIP ne charge pas de détails", async () => {
    await g().refresh(REPO_A);
    const spy = vi.spyOn(api, "commitDetails");
    g().select(REPO_A, WIP);
    expect(spy).not.toHaveBeenCalled();
    expect(repo().selected).toBe(WIP);
  });

  it("reveal charge les pages nécessaires pour trouver un commit ancien", async () => {
    await g().refresh(REPO_A);
    const old = history().commits[MOCK_COMMIT_COUNT - 1].sha;
    expect(await g().reveal(REPO_A, old)).toBe(true);
    expect(repo().selected).toBe(old);
    expect(await g().reveal(REPO_A, "f".repeat(40))).toBe(false);
  });

  it("ouvre puis ferme un diff ; changer de commit le ferme", async () => {
    await g().refresh(REPO_A);
    const sha = history().commits[0].sha;
    const file = { status: "M" as const, path: "src/lib/graph.ts", oldPath: null };
    await g().openDiff(REPO_A, sha, file);
    expect(g().diffs[REPO_A]?.data?.hunks.length).toBeGreaterThan(0);
    g().closeDiff(REPO_A);
    expect(g().diffs[REPO_A]).toBeUndefined();

    await g().openDiff(REPO_A, sha, file);
    g().select(REPO_A, history().commits[1].sha);
    expect(g().diffs[REPO_A]).toBeUndefined();
  });

  it("un diff plus ancien qui répond en retard n'écrase pas le fichier ouvert ensuite", async () => {
    await g().refresh(REPO_A);
    const sha = history().commits[0].sha;
    let resolve!: (v: Awaited<ReturnType<typeof api.commitDiff>>) => void;
    vi.spyOn(api, "commitDiff").mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const first = g().openDiff(REPO_A, sha, { status: "M", path: "a", oldPath: null });
    await g().openDiff(REPO_A, sha, { status: "M", path: "b", oldPath: null });
    resolve({ binary: true, truncated: false, hunks: [], fingerprint: "" });
    await first;
    expect(g().diffs[REPO_A]?.file.path).toBe("b");
    expect(g().diffs[REPO_A]?.data?.binary).toBe(false);
  });

  it("drop oublie tout le dépôt", async () => {
    await g().refresh(REPO_A);
    const sha = history().commits[0].sha;
    await g().loadDetails(REPO_A, sha);
    g().drop(REPO_A);
    expect(repo()).toBeUndefined();
    expect(g().details[detailsKey(REPO_A, sha)]).toBeUndefined();
  });
});
