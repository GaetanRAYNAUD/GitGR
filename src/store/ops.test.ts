import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { validBranchName } from "../lib/branchName";
import { mockHistory } from "../lib/mockHistory";
import { REPO_A, REPO_B } from "../test/utils";
import { useApp } from "./app";
import { useDialogs, type InputAnswer } from "./dialogs";
import { useGraph } from "./graph";
import { useOps } from "./ops";
import { useWork } from "./worktree";

// REPO_A (GitGR) est propre ; REPO_B (api-backend) a des modifications en cours.
// Branches simulées : main (1 commit à pousser), feature/graph-rendering (non fusionnée),
// feature/profils, fix/ssh-agent (1 commit à tirer). Voir lib/mockHistory.ts.

const ops = () => useOps.getState();
const refs = (path: string) => mockHistory(path).refs;
const local = (path: string, name: string) => refs(path).refs.find((r) => r.kind === "local" && r.short === name);

/** Attend la fenêtre de dialogue demandée, puis y répond. */
async function answer(value: string | InputAnswer | null) {
  await vi.waitFor(() => expect(useDialogs.getState().current).not.toBeNull());
  const title = useDialogs.getState().current!.request.title;
  useDialogs.getState().answer(value);
  return title;
}

async function open(path: string) {
  await useGraph.getState().refresh(path);
  await useWork.getState().refresh(path);
}

afterEach(() => vi.restoreAllMocks());

describe("noms de branche", () => {
  it("refuse ce que git refuse", () => {
    for (const ok of ["main", "feature/x", "fix-1.2", "été"]) expect(validBranchName(ok)).toBe(true);
    for (const bad of ["", " x", "a b", "-x", "a..b", "a/", "/a", "x.lock", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "a@{1}", "a."])
      expect(validBranchName(bad), bad).toBe(false);
  });
});

describe("checkout", () => {
  it("passe sur une branche locale et sélectionne son commit", async () => {
    await open(REPO_A);
    expect(await ops().checkout(REPO_A, "feature/profils")).toBe(true);
    expect(refs(REPO_A).headBranch).toBe("feature/profils");
    expect(useGraph.getState().graphs[REPO_A].refs?.headBranch).toBe("feature/profils");
    expect(useGraph.getState().graphs[REPO_A].selected).toBe(local(REPO_A, "feature/profils")!.target);
  });

  it("transmet le réglage d'auto-stash", async () => {
    await open(REPO_B);
    const spy = vi.spyOn(api, "checkout");
    useApp.setState((s) => ({ settings: { ...s.settings, autoStash: false } }));
    await ops().checkout(REPO_B, "feature/profils");
    expect(spy).toHaveBeenCalledWith(REPO_B, "feature/profils", false);
  });

  it("stash gardé (conflits à la réapplication) : message persistant avec le nom du stash", async () => {
    await open(REPO_B);
    vi.spyOn(api, "checkout").mockResolvedValueOnce({ stashed: true, stashKept: true, conflicts: false });
    await ops().checkout(REPO_B, "feature/profils");
    const notice = useApp.getState().notice;
    expect(notice?.sticky).toBe(true);
    expect(notice?.text).toContain("GitGR-autostash: main");
  });

  it("une branche distante crée la locale qui la suit", async () => {
    await open(REPO_A);
    const h = mockHistory(REPO_A);
    h.refs = { ...h.refs, refs: h.refs.refs.filter((r) => r.short !== "feature/graph-rendering") };
    await ops().checkoutRemote(REPO_A, "origin/feature/graph-rendering");
    expect(local(REPO_A, "feature/graph-rendering")?.upstream).toBe("origin/feature/graph-rendering");
    expect(refs(REPO_A).headBranch).toBe("feature/graph-rendering");
  });

  it("une erreur est affichée dans le toast", async () => {
    await open(REPO_A);
    vi.spyOn(api, "checkout").mockRejectedValueOnce("local_changes_conflict");
    expect(await ops().checkout(REPO_A, "feature/profils")).toBe(false);
    expect(useApp.getState().error).toBe("local_changes_conflict");
  });
});

describe("branches", () => {
  it("nouvelle branche : nom demandé, puis checkout", async () => {
    await open(REPO_A);
    const done = ops().newBranch(REPO_A, null, "main");
    expect(await answer({ value: "feature/neuve", checked: true })).toBe("Nouvelle branche");
    expect(await done).toBe(true);
    expect(refs(REPO_A).headBranch).toBe("feature/neuve");
  });

  it("nouvelle branche sans checkout, depuis un commit ; annuler ne fait rien", async () => {
    await open(REPO_A);
    const sha = mockHistory(REPO_A).commits[10].sha;
    const done = ops().newBranch(REPO_A, sha, sha.slice(0, 7));
    await answer({ value: "ici", checked: false });
    await done;
    expect(local(REPO_A, "ici")?.target).toBe(sha);
    expect(refs(REPO_A).headBranch).toBe("main");

    const spy = vi.spyOn(api, "createBranch");
    const cancelled = ops().newBranch(REPO_A, null, "main");
    await answer(null);
    expect(await cancelled).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("la saisie refuse un nom invalide ou déjà pris", async () => {
    await open(REPO_A);
    ops().newBranch(REPO_A, null, "main");
    await vi.waitFor(() => expect(useDialogs.getState().current).not.toBeNull());
    const req = useDialogs.getState().current!.request;
    if (req.kind !== "input") throw new Error("saisie attendue");
    expect(req.validate?.("a b")).toMatch(/invalide/);
    expect(req.validate?.("main")).toBe("Une branche porte déjà ce nom.");
    expect(req.validate?.("libre")).toBeNull();
    useDialogs.getState().answer(null);
  });

  it("renommer", async () => {
    await open(REPO_A);
    const done = ops().renameBranch(REPO_A, "feature/profils");
    await answer({ value: "feature/profiles", checked: false });
    await done;
    expect(local(REPO_A, "feature/profiles")).toBeDefined();
    expect(local(REPO_A, "feature/profils")).toBeUndefined();
  });

  it("supprimer une branche non fusionnée demande une seconde confirmation", async () => {
    await open(REPO_A);
    const done = ops().deleteBranch(REPO_A, "feature/graph-rendering");
    expect(await answer("delete")).toBe("Supprimer feature/graph-rendering ?");
    expect(await answer("force")).toBe("feature/graph-rendering n’est pas fusionnée");
    expect(await done).toBe(true);
    expect(local(REPO_A, "feature/graph-rendering")).toBeUndefined();
  });

  it("supprimer sur le serveur marque la locale comme orpheline", async () => {
    await open(REPO_A);
    const done = ops().deleteRemoteBranch(REPO_A, "origin/fix/ssh-agent");
    await answer("delete");
    await done;
    expect(refs(REPO_A).refs.some((r) => r.short === "origin/fix/ssh-agent")).toBe(false);
    expect(local(REPO_A, "fix/ssh-agent")?.gone).toBe(true);
  });
});

describe("réseau", () => {
  it("push : la branche distante est mise à jour, plus rien à pousser", async () => {
    await open(REPO_A);
    expect(local(REPO_A, "main")?.ahead).toBe(1);
    await ops().push(REPO_A);
    expect(local(REPO_A, "main")?.ahead).toBe(0);
    expect(useApp.getState().summaries[REPO_A]?.data?.ahead).toBe(0);
    expect(useApp.getState().notice?.text).toBe("main poussée.");
  });

  it("push d'une branche sans distante : créée et suivie", async () => {
    await open(REPO_A);
    await ops().checkout(REPO_A, "feature/profils");
    await ops().push(REPO_A);
    expect(local(REPO_A, "feature/profils")?.upstream).toBe("origin/feature/profils");
  });

  it("push refusé : on propose de forcer (avec lease)", async () => {
    await open(REPO_A);
    const spy = vi.spyOn(api, "push").mockRejectedValueOnce("push_rejected");
    const done = ops().push(REPO_A);
    expect(await answer("force")).toBe("Push refusé");
    await done;
    expect(spy).toHaveBeenLastCalledWith(REPO_A, true);
  });

  it("pull : avance rapide", async () => {
    await open(REPO_A);
    await ops().checkout(REPO_A, "fix/ssh-agent");
    await ops().pull(REPO_A);
    const remote = refs(REPO_A).refs.find((r) => r.short === "origin/fix/ssh-agent")!;
    expect(local(REPO_A, "fix/ssh-agent")).toMatchObject({ target: remote.target, behind: 0 });
  });

  it("pull divergent en avance rapide : on demande merge ou rebase", async () => {
    await open(REPO_A);
    const spy = vi.spyOn(api, "pull").mockRejectedValueOnce("not_fast_forward").mockResolvedValueOnce({
      stashed: false,
      stashKept: false,
      conflicts: true,
    });
    const done = ops().pull(REPO_A);
    expect(await answer("rebase")).toBe("Les branches ont divergé");
    await done;
    expect(spy.mock.calls.map((c) => c[1])).toEqual(["ff-only", "rebase"]);
    // Arrêté sur des conflits : prévenu.
    expect(useApp.getState().notice?.text).toMatch(/conflits/);
  });

  it("fetch automatique : silencieux en cas d'erreur, ignoré si une commande tourne", async () => {
    await open(REPO_A);
    vi.spyOn(api, "fetch").mockRejectedValueOnce("network_unreachable");
    expect(await ops().fetch(REPO_A, true)).toBe(false);
    expect(useApp.getState().error).toBeNull();

    const spy = vi.spyOn(api, "fetch");
    spy.mockClear();
    useOps.setState({ running: { [REPO_A]: "push" } });
    await ops().fetch(REPO_A, true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("les commandes d'un dépôt passent une par une", async () => {
    await open(REPO_A);
    const order: string[] = [];
    let release!: () => void;
    vi.spyOn(api, "fetch").mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          order.push("fetch:start");
          release = () => {
            order.push("fetch:end");
            r();
          };
        }),
    );
    vi.spyOn(api, "push").mockImplementationOnce(async () => {
      order.push("push");
    });
    const a = ops().fetch(REPO_A);
    const b = ops().push(REPO_A);
    await vi.waitFor(() => expect(order).toEqual(["fetch:start"]));
    expect(useOps.getState().running[REPO_A]).toBe("fetch");
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["fetch:start", "fetch:end", "push"]);
    expect(useOps.getState().running[REPO_A]).toBeUndefined();
  });
});

describe("stash", () => {
  it("stash puis pop rendent les modifications", async () => {
    await open(REPO_B);
    const before = useWork.getState().repos[REPO_B].status;
    await ops().stash(REPO_B);
    expect(useWork.getState().repos[REPO_B].status?.unstaged).toEqual([]);
    expect(useGraph.getState().graphs[REPO_B].refs?.stashes).toBe(1);
    await ops().pop(REPO_B);
    expect(useWork.getState().repos[REPO_B].status).toEqual(before);
    expect(useGraph.getState().graphs[REPO_B].refs?.stashes).toBe(0);
  });

  it("pop sans stash : erreur", async () => {
    await open(REPO_A);
    await ops().pop(REPO_A);
    expect(useApp.getState().error).toBe("no_stash");
  });
});

describe("dialogues", () => {
  it("une nouvelle demande annule celle affichée", async () => {
    const first = useDialogs.getState().choose({ title: "A", body: "", choices: [{ id: "x", label: "X" }] });
    const second = useDialogs.getState().choose({ title: "B", body: "", choices: [{ id: "y", label: "Y" }] });
    expect(await first).toBeNull();
    useDialogs.getState().answer("y");
    expect(await second).toBe("y");
    expect(useDialogs.getState().current).toBeNull();
  });
});
