import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { validBranchName } from "../lib/branchName";
import { mockHistory } from "../lib/mockHistory";
import { REPO_A, REPO_B, REPO_C } from "../test/utils";
import { useApp } from "./app";
import { useDialogs, type InputAnswer } from "./dialogs";
import { useGraph } from "./graph";
import { useOps } from "./ops";
import { useProfiles } from "./profiles";
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

  it("l'auto-stash propre au dépôt passe avant le réglage", async () => {
    await open(REPO_B);
    const spy = vi.spyOn(api, "checkout");
    useApp.setState((s) => ({ settings: { ...s.settings, autoStash: false }, repoUi: { ...s.repoUi, [REPO_B]: { collapsed: [], hidden: [], autoStash: true } } }));
    await ops().checkout(REPO_B, "feature/profils");
    expect(spy).toHaveBeenCalledWith(REPO_B, "feature/profils", true);
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

  it("une branche distante dont la locale existe : checkout de la locale, puis pull", async () => {
    await open(REPO_A);
    expect(local(REPO_A, "fix/ssh-agent")?.behind).toBe(1);
    const pull = vi.spyOn(api, "pull");
    expect(await ops().checkoutRemote(REPO_A, "origin/fix/ssh-agent")).toBe(true);
    expect(refs(REPO_A).headBranch).toBe("fix/ssh-agent");
    expect(pull).toHaveBeenCalledWith(REPO_A, "ff-only", true);
    expect(local(REPO_A, "fix/ssh-agent")?.behind).toBe(0);
  });

  it("déjà sur la locale (en retard) : seulement le pull", async () => {
    await open(REPO_A);
    await ops().checkout(REPO_A, "fix/ssh-agent");
    const pull = vi.spyOn(api, "pull");
    await ops().checkoutRemote(REPO_A, "origin/fix/ssh-agent");
    expect(pull).toHaveBeenCalledTimes(1);
    expect(local(REPO_A, "fix/ssh-agent")?.behind).toBe(0);
  });

  it("locale qui suit une autre branche : tirée depuis la distante, sans changer son suivi", async () => {
    await open(REPO_A);
    const h = mockHistory(REPO_A);
    h.refs = { ...h.refs, refs: h.refs.refs.map((r) => (r.kind === "local" && r.short === "fix/ssh-agent" ? { ...r, upstream: null } : r)) };
    await open(REPO_A);
    const pullFrom = vi.spyOn(api, "pullFrom");
    const pull = vi.spyOn(api, "pull");
    await ops().checkoutRemote(REPO_A, "origin/fix/ssh-agent");
    expect(pull).not.toHaveBeenCalled();
    expect(pullFrom).toHaveBeenCalledWith(REPO_A, "origin", "fix/ssh-agent", "ff-only", true);
    expect(local(REPO_A, "fix/ssh-agent")?.upstream).toBeNull();
  });

  it("locale créée à l'instant ou stash gardé : pas de pull", async () => {
    const h = mockHistory(REPO_A);
    h.refs = { ...h.refs, refs: h.refs.refs.filter((r) => r.short !== "feature/graph-rendering") };
    await open(REPO_A);
    const pull = vi.spyOn(api, "pull");
    await ops().checkoutRemote(REPO_A, "origin/feature/graph-rendering");
    vi.spyOn(api, "checkoutRemote").mockImplementationOnce(async () => {
      h.refs = { ...h.refs, headBranch: "fix/ssh-agent" };
      return [{ stashed: true, stashKept: true, conflicts: false }, "fix/ssh-agent"];
    });
    await ops().checkoutRemote(REPO_A, "origin/fix/ssh-agent");
    expect(pull).not.toHaveBeenCalled();
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

  it("supprimer une branche : sans confirmation (elle s'annule), sauf si elle n'est pas fusionnée", async () => {
    await open(REPO_A);
    const done = ops().deleteBranch(REPO_A, "feature/graph-rendering");
    expect(await answer("force")).toBe("feature/graph-rendering n’est pas fusionnée");
    expect(await done).toBe(true);
    expect(local(REPO_A, "feature/graph-rendering")).toBeUndefined();
    // Le message propose de l'annuler ; l'annulation la recrée.
    const notice = useApp.getState().notice;
    expect(notice?.text).toBe("Branche feature/graph-rendering supprimée.");
    notice?.actions?.[0].onClick();
    await vi.waitFor(() => expect(local(REPO_A, "feature/graph-rendering")).toBeDefined());
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
    expect(spy).toHaveBeenLastCalledWith(REPO_A, true, null);
  });

  it("pousser vers un remote choisi : sa branche du même nom, sans changer la branche suivie", async () => {
    // REPO_C a deux remotes : origin (suivi par main) et client, en retard.
    await open(REPO_C);
    const remote = (name: string) => refs(REPO_C).refs.find((r) => r.short === name);
    expect(remote("client/main")?.target).not.toBe(local(REPO_C, "main")!.target);
    expect(await ops().push(REPO_C, false, "client")).toBe(true);
    expect(remote("client/main")?.target).toBe(local(REPO_C, "main")!.target);
    expect(local(REPO_C, "main")).toMatchObject({ upstream: "origin/main", ahead: 1 });
    expect(useApp.getState().notice?.text).toBe("main poussée vers client.");
  });

  it("push refusé par un remote choisi : « Pull » tire depuis ce remote", async () => {
    await open(REPO_C);
    vi.spyOn(api, "push").mockRejectedValueOnce("push_rejected");
    const pull = vi.spyOn(api, "pullFrom");
    const done = ops().push(REPO_C, false, "client");
    expect(await answer("pull")).toBe("Push refusé");
    await done;
    expect(pull).toHaveBeenCalledWith(REPO_C, "client", "main", "ff-only", true);
  });

  it("pousser vers tous les remotes : un échec n'empêche pas les autres, et il est nommé", async () => {
    await open(REPO_C);
    const spy = vi.spyOn(api, "push");
    expect(await ops().pushAll(REPO_C)).toBe(true);
    // origin d'abord : une branche sans suivi suivra origin, pas le premier remote de la liste.
    expect(spy.mock.calls.map((c) => c[2])).toEqual(["origin", "client"]);
    expect(useApp.getState().notice?.text).toBe("main poussée vers origin, client.");

    spy.mockClear();
    spy.mockRejectedValueOnce("auth_failed");
    expect(await ops().pushAll(REPO_C)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useApp.getState().error).toMatch(/^origin : Authentification refusée/);
    expect(useApp.getState().notice).toMatchObject({ text: "main poussée vers client.", sticky: true });
    // L'erreur propose de recommencer.
    expect(useApp.getState().errorActions?.actions.map((a) => a.label)).toEqual(["Réessayer"]);

    // Un remote refuse (commits qu'on n'a pas) : « Pull puis push ».
    spy.mockClear();
    spy.mockRejectedValueOnce("push_rejected");
    const pull = vi.spyOn(api, "pull");
    expect(await ops().pushAll(REPO_C)).toBe(false);
    const actions = useApp.getState().errorActions?.actions ?? [];
    expect(actions.map((a) => a.label)).toEqual(["Pull puis push"]);
    actions[0].onClick();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(4));
  });

  it("fetch en échec réseau : « Réessayer » ; authentification refusée : les profils aussi", async () => {
    await open(REPO_A);
    const spy = vi.spyOn(api, "fetch").mockRejectedValueOnce("network_unreachable");
    expect(await ops().fetch(REPO_A)).toBe(false);
    expect(useApp.getState().errorActions?.actions.map((a) => a.label)).toEqual(["Réessayer"]);
    useApp.getState().errorActions!.actions[0].onClick();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    spy.mockRejectedValueOnce("auth_failed");
    expect(await ops().fetch(REPO_A)).toBe(false);
    expect(useApp.getState().errorActions?.actions.map((a) => a.label)).toEqual(["Réessayer", "Profils et comptes…"]);
  });

  it("pousser vers tous une branche sans suivi : elle suit origin", async () => {
    await open(REPO_C);
    await ops().checkout(REPO_C, "feature/profils");
    expect(await ops().pushAll(REPO_C)).toBe(true);
    expect(local(REPO_C, "feature/profils")?.upstream).toBe("origin/feature/profils");
    expect(refs(REPO_C).refs.some((r) => r.short === "client/feature/profils")).toBe(true);
  });

  it("push refusé par le remote de la branche suivie : « Pull » tire la branche suivie", async () => {
    await open(REPO_C);
    vi.spyOn(api, "push").mockRejectedValueOnce("push_rejected");
    const pull = vi.spyOn(api, "pull");
    const pullFrom = vi.spyOn(api, "pullFrom");
    const done = ops().push(REPO_C, false, "origin");
    await answer("pull");
    await done;
    expect(pull).toHaveBeenCalledTimes(1);
    expect(pullFrom).not.toHaveBeenCalled();
  });

  it("tirer depuis un remote, arrêté sur des conflits : l'avertissement reste affiché", async () => {
    await open(REPO_C);
    vi.spyOn(api, "pullFrom").mockResolvedValueOnce({ stashed: true, stashKept: true, conflicts: true });
    expect(await ops().pullFrom(REPO_C, "client")).toBe(true);
    const notice = useApp.getState().notice;
    expect(notice?.sticky).toBe(true);
    expect(notice?.text).toMatch(/conflits/);
    expect(notice?.text).toContain("GitGR-autostash: main");
  });

  it("tirer depuis un autre remote : la branche du même nom, la branche suivie ne change pas", async () => {
    await open(REPO_C);
    // main (1 commit local) contient déjà client/main : rien à tirer.
    const before = local(REPO_C, "main")!.target;
    expect(await ops().pullFrom(REPO_C, "client")).toBe(true);
    expect(local(REPO_C, "main")).toMatchObject({ target: before, upstream: "origin/main" });
    expect(useApp.getState().notice?.text).toBe("client/main tirée.");

    // Branche absente du remote : erreur de git, traduite.
    await ops().checkout(REPO_C, "feature/profils");
    expect(await ops().pullFrom(REPO_C, "client")).toBe(false);
    expect(useApp.getState().error).toBe("remote_ref_not_found");
  });

  it("ajouter un remote : nom et URL demandés, puis fetch si la case est cochée", async () => {
    await open(REPO_A);
    const fetch = vi.spyOn(api, "fetch");
    let done = ops().addRemote(REPO_A);
    await vi.waitFor(() => expect(useDialogs.getState().current).not.toBeNull());
    const request = useDialogs.getState().current!.request;
    // Nom déjà pris ou invalide : refusé à la frappe.
    expect(request.kind === "input" && request.validate?.("origin")).toBe("Un remote porte déjà ce nom.");
    expect(request.kind === "input" && request.validate?.("pas bon")).toMatch(/Nom invalide/);
    expect(await answer({ value: "client", second: "git@gitlab.client.fr:g/r.git", checked: true })).toBe("Ajouter un remote");
    expect(await done).toBe(true);
    expect(refs(REPO_A).remotes).toEqual([
      { name: "client", url: "git@gitlab.client.fr:g/r.git", pushUrl: null },
      { name: "origin", url: "git@gitlab.exemple.fr:demo/GitGR.git", pushUrl: null },
    ]);
    expect(useGraph.getState().graphs[REPO_A].refs?.remotes).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Case décochée : pas de fetch, un message.
    done = ops().addRemote(REPO_A);
    await answer({ value: "miroir", second: "C:/depots/miroir.git", checked: false });
    expect(await done).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useApp.getState().notice?.text).toBe("Remote miroir ajouté.");
  });

  it("renommer un remote : ses branches et le profil choisi pour lui le suivent", async () => {
    await open(REPO_C);
    await useProfiles.getState().save([{ id: "p", name: "P", userName: "P", userEmail: "p@exemple.fr", sshKey: null, rules: [], color: 0 }]);
    await useProfiles.getState().setRemoteProfile(REPO_C, "client", "p");
    const done = ops().renameRemote(REPO_C, "client");
    expect(await answer({ value: "partenaire", checked: false })).toBe("Renommer le remote client");
    expect(await done).toBe(true);
    expect(refs(REPO_C).remotes.map((r) => r.name)).toEqual(["origin", "partenaire"]);
    expect(refs(REPO_C).refs.some((r) => r.short === "partenaire/main")).toBe(true);
    expect(refs(REPO_C).refs.some((r) => r.short.startsWith("client/"))).toBe(false);
    expect(useProfiles.getState().repoProfiles[REPO_C].remotes).toEqual({ partenaire: "p" });
    expect((await api.getState()).repoProfiles?.[REPO_C].remotes).toEqual({ partenaire: "p" });
  });

  it("renommer ou supprimer un remote : les préférences de sa section suivent", async () => {
    await open(REPO_C);
    useApp.getState().setRepoUi(REPO_C, { collapsed: ["tags", "remote:client/feature", "remote:client-bis"], hidden: ["remote:client"] });
    let done = ops().renameRemote(REPO_C, "client");
    await answer({ value: "partenaire", checked: false });
    await done;
    // `remote:client-bis` est un autre remote : pas touché.
    expect(useApp.getState().repoUi[REPO_C]).toEqual({ collapsed: ["tags", "remote:partenaire/feature", "remote:client-bis"], hidden: ["remote:partenaire"] });

    done = ops().removeRemote(REPO_C, "partenaire");
    await answer("remove");
    await done;
    expect(useApp.getState().repoUi[REPO_C]).toEqual({ collapsed: ["tags", "remote:client-bis"], hidden: [] });
  });

  it("changer l'URL d'un remote", async () => {
    await open(REPO_C);
    const done = ops().editRemoteUrl(REPO_C, "client");
    expect(await answer({ value: "ssh://git@gitlab.client.fr/autre.git", checked: false })).toBe("URL de client");
    expect(await done).toBe(true);
    expect(refs(REPO_C).remotes[0]).toEqual({ name: "client", url: "ssh://git@gitlab.client.fr/autre.git", pushUrl: null });
  });

  it("supprimer un remote : confirmation, ses branches distantes et son profil disparaissent", async () => {
    await open(REPO_C);
    await useProfiles.getState().setRemoteProfile(REPO_C, "client", null);
    const spy = vi.spyOn(api, "removeRemote");
    let done = ops().removeRemote(REPO_C, "client");
    expect(await answer(null)).toBe("Supprimer le remote client ?");
    expect(await done).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    done = ops().removeRemote(REPO_C, "client");
    await answer("remove");
    expect(await done).toBe(true);
    expect(refs(REPO_C).remotes.map((r) => r.name)).toEqual(["origin"]);
    expect(refs(REPO_C).refs.some((r) => r.short.startsWith("client/"))).toBe(false);
    expect(useProfiles.getState().repoProfiles[REPO_C].remotes).toEqual({});
  });

  it("tirer depuis un remote dont la branche a divergé : on demande merge ou rebase", async () => {
    await open(REPO_C);
    const spy = vi.spyOn(api, "pullFrom").mockRejectedValueOnce("not_fast_forward");
    const done = ops().pullFrom(REPO_C, "client");
    expect(await answer("merge")).toBe("Les branches ont divergé");
    expect(await done).toBe(true);
    expect(spy.mock.calls.map((c) => c.slice(1, 4))).toEqual([
      ["client", "main", "ff-only"],
      ["client", "main", "merge"],
    ]);
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

describe("publier", () => {
  const seedProfile = async () => {
    const account = { id: "github|https://github.com|octo", kind: "github" as const, url: "https://github.com", login: "octo", name: null };
    const profile = { id: "p-perso", name: "Perso", userName: "Demo", userEmail: "demo@exemple.fr", sshKey: "~/.ssh/id_ed25519", rules: [], color: 0, accounts: [account] };
    useProfiles.setState({ profiles: [profile], repoProfiles: {} });
    vi.spyOn(useProfiles.getState(), "confirmIdentity").mockResolvedValue(true);
  };

  it("ajoute le remote, lui donne le profil du compte, et pousse la branche avec son suivi", async () => {
    const h = mockHistory(REPO_C);
    h.refs = { ...h.refs, remotes: [], refs: h.refs.refs.filter((r) => r.kind !== "remote").map((r) => ({ ...r, upstream: null, ahead: 0, behind: 0 })) };
    await open(REPO_C);
    await seedProfile();
    const setRemoteProfile = vi.spyOn(useProfiles.getState(), "setRemoteProfile").mockResolvedValue(true);
    const push = vi.spyOn(api, "push");
    expect(await ops().publish(REPO_C, "origin", "git@github.com:octo/neuf.git", "p-perso", true)).toBe(true);
    expect(refs(REPO_C).remotes.map((r) => r.name)).toEqual(["origin"]);
    expect(setRemoteProfile).toHaveBeenCalledWith(REPO_C, "origin", "p-perso");
    expect(push).toHaveBeenCalledWith(REPO_C, false, "origin");
    expect(local(REPO_C, "main")?.upstream).toBe("origin/main");
  });

  it("sans push : seulement le remote ; un nom pris est refusé", async () => {
    const h = mockHistory(REPO_C);
    h.refs = { ...h.refs, remotes: [] };
    await open(REPO_C);
    await seedProfile();
    vi.spyOn(useProfiles.getState(), "setRemoteProfile").mockResolvedValue(true);
    const push = vi.spyOn(api, "push");
    expect(await ops().publish(REPO_C, "origin", "git@github.com:octo/neuf.git", "p-perso", false)).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(await ops().publish(REPO_C, "origin", "git@github.com:octo/autre.git", null, true)).toBe(false);
    expect(useApp.getState().error).toBe("remote_exists");
  });
});
