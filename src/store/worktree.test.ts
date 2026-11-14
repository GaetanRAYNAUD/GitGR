import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { mockHistory } from "../lib/mockHistory";
import { REPO_A, REPO_B } from "../test/utils";
import { useApp } from "./app";
import { useGraph } from "./graph";
import { areaOf, changedCount, fullMessage, useWork } from "./worktree";

// REPO_B (api-backend) a des modifications simulées : 2 fichiers non indexés, 1 non suivi,
// 2 indexés (dont log.rs des deux côtés). REPO_A (GitGR) est propre.
const w = () => useWork.getState();
const repo = () => w().repos[REPO_B];
const paths = (list: { path: string }[] | undefined) => list?.map((f) => f.path);

afterEach(() => vi.restoreAllMocks());

describe("copie de travail : état", () => {
  it("lit les fichiers indexés, non indexés et non suivis", async () => {
    await w().refresh(REPO_B);
    expect(paths(repo().status?.unstaged)).toEqual(["src/graph/render.ts", "src-tauri/src/git/log.rs", "notes.txt"]);
    expect(paths(repo().status?.staged)).toEqual(["src-tauri/src/git/log.rs", "src/graph/lanes.ts"]);
    expect(changedCount(repo().status)).toBe(4);
    await w().refresh(REPO_A);
    expect(changedCount(w().repos[REPO_A].status)).toBe(0);
  });

  it("une réponse plus ancienne n'écrase pas la plus récente", async () => {
    let resolveOld!: (v: Awaited<ReturnType<typeof api.workStatus>>) => void;
    vi.spyOn(api, "workStatus")
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ staged: [], unstaged: [], conflicted: [], operation: null, mergeMessage: null });
    const old = w().refresh(REPO_B);
    await w().refresh(REPO_B);
    resolveOld({ staged: [], unstaged: [{ path: "x", oldPath: null, status: "M" }], conflicted: [], operation: null, mergeMessage: null });
    await old;
    expect(repo().status?.unstaged).toEqual([]);
  });

  it("côté du diff selon la liste et le statut", () => {
    const f = (status: "M" | "?") => ({ path: "a", oldPath: null, status });
    expect(areaOf(f("M"), "unstaged")).toBe("unstaged");
    expect(areaOf(f("?"), "unstaged")).toBe("untracked");
    expect(areaOf(f("M"), "staged")).toBe("staged");
    expect(areaOf(f("M"), "conflicted")).toBe("conflicted");
  });
});

describe("copie de travail : indexation", () => {
  it("indexe puis retire un fichier ; tout indexer / tout retirer", async () => {
    await w().refresh(REPO_B);
    const render = repo().status!.unstaged[0];
    await w().stage(REPO_B, [render]);
    expect(paths(repo().status?.staged)).toContain("src/graph/render.ts");
    expect(paths(repo().status?.unstaged)).not.toContain("src/graph/render.ts");

    await w().unstageAll(REPO_B);
    expect(repo().status?.staged).toEqual([]);
    await w().stageAll(REPO_B);
    expect(repo().status?.unstaged).toEqual([]);
  });

  it("un renommage indexé est retiré avec son ancien chemin", async () => {
    await w().refresh(REPO_B);
    const spy = vi.spyOn(api, "unstageFiles").mockResolvedValue();
    await w().unstage(REPO_B, [{ path: "neuf.rs", oldPath: "vieux.rs", status: "R" }]);
    expect(spy).toHaveBeenCalledWith(REPO_B, ["neuf.rs", "vieux.rs"]);
  });

  it("abandonner : suivi restauré, non suivi supprimé", async () => {
    await w().refresh(REPO_B);
    const spy = vi.spyOn(api, "discardFiles");
    const [render, , notes] = repo().status!.unstaged;
    await w().discard(REPO_B, [render, notes]);
    expect(spy).toHaveBeenCalledWith(REPO_B, ["src/graph/render.ts"], ["notes.txt"]);
    expect(paths(repo().status?.unstaged)).toEqual(["src-tauri/src/git/log.rs"]);
  });

  it("indexer des lignes du diff ouvert, avec son empreinte ; le diff suit le fichier", async () => {
    await w().refresh(REPO_B);
    const render = repo().status!.unstaged[0];
    await w().openDiff(REPO_B, render, "unstaged");
    const fp = repo().diff!.data!.fingerprint;
    const spy = vi.spyOn(api, "stageLines");
    // Ligne 3 du hunk 0 : « + const width… ».
    await w().applyLines(REPO_B, [{ hunk: 0, line: 3 }], "stage");
    expect(spy).toHaveBeenCalledWith(REPO_B, "src/graph/render.ts", null, [{ hunk: 0, line: 3 }], fp, false);
    // Il reste des changements non indexés : le diff reste ouvert de ce côté, rechargé.
    expect(repo().diff?.area).toBe("unstaged");
    expect(repo().diff?.data?.hunks[0].lines.some((l) => l.text.includes("width"))).toBe(false);

    // Tout le reste indexé : le diff bascule côté indexé.
    const rest = repo().diff!.data!.hunks[0].lines.flatMap((l, i) => (l.kind !== " " ? [{ hunk: 0, line: i }] : []));
    await w().applyLines(REPO_B, rest, "stage");
    expect(repo().diff?.area).toBe("staged");
  });

  it("une erreur git est affichée dans le toast et l'état est relu", async () => {
    await w().refresh(REPO_B);
    vi.spyOn(api, "stageAll").mockRejectedValueOnce("diff_changed");
    const status = vi.spyOn(api, "workStatus");
    await w().stageAll(REPO_B);
    expect(useApp.getState().error).toBe("diff_changed");
    expect(status).toHaveBeenCalled();
    expect(repo().busy).toBe(false);
  });

  it("une seule action à la fois", async () => {
    await w().refresh(REPO_B);
    const spy = vi.spyOn(api, "stageAll");
    await Promise.all([w().stageAll(REPO_B), w().stageAll(REPO_B)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("copie de travail : commit", () => {
  it("message complet : résumé, ligne vide, description", () => {
    expect(fullMessage({ summary: " titre ", body: "", amend: false })).toBe("titre");
    expect(fullMessage({ summary: "titre", body: "\ncorps\n", amend: false })).toBe("titre\n\ncorps");
  });

  it("commite l'index, vide le brouillon et recharge le graphe", async () => {
    await useGraph.getState().refresh(REPO_B);
    await w().refresh(REPO_B);
    w().setDraft(REPO_B, { summary: "feat: test", body: "détails" });
    const spy = vi.spyOn(api, "commit");
    expect(await w().commit(REPO_B)).toBe(true);
    expect(spy).toHaveBeenCalledWith(REPO_B, "feat: test\n\ndétails", false);
    expect(repo().draft).toEqual({ summary: "", body: "", amend: false });
    expect(repo().status?.staged).toEqual([]);
    await vi.waitFor(() => expect(useGraph.getState().graphs[REPO_B].commits[0].subject).toBe("feat: test"));
  });

  it("amend pré-remplit avec le dernier message et restaure le brouillon en le décochant", async () => {
    await w().refresh(REPO_B);
    w().setDraft(REPO_B, { summary: "en cours" });
    await w().setAmend(REPO_B, true);
    const head = mockHistory(REPO_B).commits.find((c) => c.sha === mockHistory(REPO_B).refs.head)!;
    expect(repo().draft).toMatchObject({ summary: head.subject, amend: true });
    await w().setAmend(REPO_B, false);
    expect(repo().draft).toMatchObject({ summary: "en cours", amend: false });
  });

  it("un commit refusé garde le brouillon", async () => {
    await w().refresh(REPO_B);
    vi.spyOn(api, "commit").mockRejectedValueOnce("identity_missing");
    w().setDraft(REPO_B, { summary: "x" });
    expect(await w().commit(REPO_B)).toBe(false);
    expect(repo().draft.summary).toBe("x");
    expect(useApp.getState().error).toBe("identity_missing");
  });
});
