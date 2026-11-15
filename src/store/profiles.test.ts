import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { Profile } from "../lib/types";
import { REPO_A, REPO_B } from "../test/utils";
import { useApp } from "./app";
import { useDialogs } from "./dialogs";
import { useOps } from "./ops";
import { activeProfile, useProfiles } from "./profiles";

const s = () => useProfiles.getState();

function profile(id: string, rules: string[] = []): Profile {
  return { id, name: id.toUpperCase(), userName: `Nom ${id}`, userEmail: `${id}@exemple.fr`, sshKey: null, rules, color: 0 };
}

/** Répond à la prochaine fenêtre de choix. */
async function answer(id: string | null) {
  await vi.waitFor(() => expect(useDialogs.getState().current).not.toBeNull());
  useDialogs.getState().answer(id);
}

describe("store : profils", () => {
  it("enregistre les profils et les recharge au démarrage", async () => {
    await useApp.getState().init();
    expect(await s().save([profile("perso"), profile("boulot")])).toBe(true);
    useProfiles.setState({ profiles: [] });
    await useApp.getState().init();
    expect(s().profiles.map((p) => p.id)).toEqual(["perso", "boulot"]);
    expect(s().home).toBe("C:/Users/demo");
  });

  it("choisit le profil d'après l'hôte du remote à l'ouverture, une seule fois", async () => {
    await useApp.getState().init();
    await s().save([profile("perso", ["github.com"]), profile("boulot", ["gitlab.exemple.fr"])]);
    await useApp.getState().openPath(REPO_A);
    await vi.waitFor(() => expect(activeProfile(REPO_A)?.id).toBe("boulot"));
    expect(s().repoProfiles[REPO_A]).toEqual({ active: "boulot", allowed: ["boulot"] });
    await vi.waitFor(() => expect(useApp.getState().notice?.text).toMatch(/BOULOT/));

    // Un choix explicite (aucun profil) est respecté ensuite.
    await s().setActive(REPO_A, null);
    await useApp.getState().refreshSummary(REPO_A);
    expect(activeProfile(REPO_A)).toBeNull();
    expect(s().repoProfiles[REPO_A].allowed).toEqual(["boulot"]);
  });

  it("une règle ajoutée après coup sert aux dépôts ouverts sans profil", async () => {
    await useApp.getState().init();
    await useApp.getState().openPath(REPO_B);
    await useApp.getState().refreshSummary(REPO_B);
    expect(s().repoProfiles[REPO_B]).toBeUndefined();
    await s().save([profile("boulot", ["~/work/*"])]);
    expect(activeProfile(REPO_B)?.id).toBe("boulot");
  });

  it("changer de profil l'associe au dépôt ; dissocier retire aussi le profil actif", async () => {
    await s().save([profile("perso"), profile("boulot")]);
    await s().setActive(REPO_A, "perso");
    await s().setActive(REPO_A, "boulot");
    expect(s().repoProfiles[REPO_A]).toEqual({ active: "boulot", allowed: ["perso", "boulot"] });
    await s().dissociate(REPO_A, "boulot");
    expect(s().repoProfiles[REPO_A]).toEqual({ active: null, allowed: ["perso"] });
    const saved = await api.getState();
    expect(saved.repoProfiles?.[REPO_A]).toEqual({ active: null, allowed: ["perso"] });
  });

  it("supprimer un profil le retire des dépôts", async () => {
    await s().save([profile("perso"), profile("boulot")]);
    await s().setActive(REPO_A, "perso");
    await s().save([profile("boulot")]);
    expect(s().repoProfiles[REPO_A]).toEqual({ active: null, allowed: [] });
  });

  it("garde-fou : propose le profil qui correspond au remote, et retient « garder »", async () => {
    await useApp.getState().openPath(REPO_A);
    await useApp.getState().refreshSummary(REPO_A);
    await s().save([profile("perso", ["github.com"]), profile("boulot", ["gitlab.exemple.fr"])]);
    await s().setActive(REPO_A, "perso");

    // Annuler : on ne fait rien.
    let ok = s().confirmIdentity(REPO_A);
    await answer(null);
    expect(await ok).toBe(false);

    // Passer au bon profil.
    ok = s().confirmIdentity(REPO_A);
    expect(useDialogs.getState().current?.request.title).toBe("Profil inattendu pour ce remote");
    await answer("switch");
    expect(await ok).toBe(true);
    expect(activeProfile(REPO_A)?.id).toBe("boulot");
    expect(await s().confirmIdentity(REPO_A)).toBe(true);

    // Garder : plus de question pour ce profil pendant la session.
    await s().setActive(REPO_A, "perso");
    ok = s().confirmIdentity(REPO_A);
    await answer("keep");
    expect(await ok).toBe(true);
    expect(await s().confirmIdentity(REPO_A)).toBe(true);
    expect(useDialogs.getState().current).toBeNull();
  });

  it("le push demande confirmation d'abord ; annulé, rien n'est poussé", async () => {
    await useApp.getState().openPath(REPO_A);
    await useApp.getState().refreshSummary(REPO_A);
    await s().save([profile("perso", ["github.com"]), profile("boulot", ["gitlab.exemple.fr"])]);
    await s().setActive(REPO_A, "perso");
    const push = vi.spyOn(api, "push");
    const done = useOps.getState().push(REPO_A);
    await answer(null);
    expect(await done).toBe(false);
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it("écrit l'identité du profil actif dans .git/config", async () => {
    await s().save([profile("perso")]);
    await s().setActive(REPO_A, "perso");
    const apply = vi.spyOn(api, "applyIdentity");
    await s().applyIdentity(REPO_A);
    expect(apply).toHaveBeenCalledWith(REPO_A, "Nom perso", "perso@exemple.fr");
    apply.mockRestore();
  });

  it("oublier un dépôt oublie ses profils", async () => {
    await useApp.getState().openPath(REPO_A);
    await s().save([profile("perso")]);
    await s().setActive(REPO_A, "perso");
    await useApp.getState().forget(REPO_A);
    expect(s().repoProfiles[REPO_A]).toBeUndefined();
    expect((await api.getState()).repoProfiles?.[REPO_A]).toBeUndefined();
  });

  it("la page se ferme en changeant d'onglet", async () => {
    await useApp.getState().openPath(REPO_A);
    s().openPage("perso");
    expect(s().pageOpen).toBe(true);
    useApp.getState().activate(REPO_A);
    expect(s().pageOpen).toBe(false);
  });
});
