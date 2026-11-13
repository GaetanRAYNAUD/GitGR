import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { NOT_A_REPO, REPO_A, REPO_B, REPO_C } from "../test/utils";
import { repoColor, useApp } from "./app";

const s = () => useApp.getState();

async function openAll(...paths: string[]) {
  for (const p of paths) await s().openPath(p);
}

describe("store : ouverture de dépôts", () => {
  it("ouvre un dépôt dans un nouvel onglet actif et l'ajoute aux récents", async () => {
    await s().openPath(REPO_A);
    expect(s().tabs).toEqual([REPO_A]);
    expect(s().active).toBe(REPO_A);
    expect(s().repos.map((r) => r.name)).toEqual(["GitGR"]);
  });

  it("rouvrir un dépôt déjà ouvert ne duplique pas l'onglet et le remonte en tête des récents", async () => {
    await openAll(REPO_A, REPO_B, REPO_A);
    expect(s().tabs).toEqual([REPO_A, REPO_B]);
    expect(s().active).toBe(REPO_A);
    expect(s().repos.map((r) => r.path)).toEqual([REPO_A, REPO_B]);
  });

  it("un dossier qui n'est pas un dépôt donne une erreur et n'ouvre rien", async () => {
    await s().openPath(NOT_A_REPO);
    expect(s().error).toBe("not_a_repo");
    expect(s().tabs).toEqual([]);
  });

  it("charge le résumé du dépôt ouvert", async () => {
    await s().openPath(REPO_A);
    await s().refreshSummary(REPO_A);
    expect(s().summaries[REPO_A].data?.branch).toBeTruthy();
    expect(s().summaries[REPO_A].loading).toBe(false);
  });
});

describe("store : robustesse", () => {
  it("une réponse de résumé plus ancienne n'écrase pas la plus récente", async () => {
    let resolveOld!: (v: Awaited<ReturnType<typeof api.repoSummary>>) => void;
    const base = await api.repoSummary(REPO_A);
    const spy = vi
      .spyOn(api, "repoSummary")
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce({ ...base, changes: 0 });

    const old = s().refreshSummary(REPO_A);
    await s().refreshSummary(REPO_A); // la plus récente répond d'abord
    resolveOld({ ...base, changes: 7 }); // puis l'ancienne, en retard
    await old;

    expect(s().summaries[REPO_A].data?.changes).toBe(0);
    spy.mockRestore();
  });

  it("un échec au démarrage affiche l'erreur au lieu d'une fenêtre vide", async () => {
    const spy = vi.spyOn(api, "getState").mockRejectedValueOnce("boom");
    await s().init();
    expect(s().ready).toBe(true);
    expect(s().error).toBe("boom");
    spy.mockRestore();
  });

  it("un échec du sélecteur de dossier est affiché", async () => {
    const spy = vi.spyOn(api, "pickFolder").mockRejectedValueOnce("dialog cassé");
    await s().pickAndOpen("titre");
    expect(s().error).toBe("dialog cassé");
    spy.mockRestore();
  });
});

describe("store : onglets", () => {
  it("fermer l'onglet actif active son voisin de droite, sinon celui de gauche", async () => {
    await openAll(REPO_A, REPO_B, REPO_C);
    s().activate(REPO_B);
    s().closeTab(REPO_B);
    expect(s().active).toBe(REPO_C);
    s().closeTab(REPO_C);
    expect(s().active).toBe(REPO_A);
    s().closeTab(REPO_A);
    expect(s().active).toBeNull();
  });

  it("fermer un onglet inactif ne change pas l'onglet actif", async () => {
    await openAll(REPO_A, REPO_B);
    s().closeTab(REPO_A);
    expect(s().active).toBe(REPO_B);
  });

  it("Ctrl+Tab fait le tour des onglets puis de l'accueil", async () => {
    await openAll(REPO_A, REPO_B);
    s().activate(REPO_A);
    s().cycleTab(1);
    expect(s().active).toBe(REPO_B);
    s().cycleTab(1);
    expect(s().active).toBeNull();
    s().cycleTab(1);
    expect(s().active).toBe(REPO_A);
    s().cycleTab(-1);
    expect(s().active).toBeNull();
  });

  it("déplace un onglet, sans changer l'onglet actif", async () => {
    await openAll(REPO_A, REPO_B, REPO_C);
    s().moveTab(REPO_C, 0);
    expect(s().tabs).toEqual([REPO_C, REPO_A, REPO_B]);
    s().moveTab(REPO_C, 2);
    expect(s().tabs).toEqual([REPO_A, REPO_B, REPO_C]);
    expect(s().active).toBe(REPO_C);
  });

  it("borne la position cible et ignore un onglet inconnu", async () => {
    await openAll(REPO_A, REPO_B);
    s().moveTab(REPO_A, 99);
    expect(s().tabs).toEqual([REPO_B, REPO_A]);
    s().moveTab(REPO_A, -5);
    expect(s().tabs).toEqual([REPO_A, REPO_B]);
    s().moveTab("C:/inconnu", 0);
    expect(s().tabs).toEqual([REPO_A, REPO_B]);
  });

  it("le nouvel ordre est persisté", async () => {
    await openAll(REPO_A, REPO_B);
    s().moveTab(REPO_B, 0);
    expect((await api.getState()).session.openTabs).toEqual([REPO_B, REPO_A]);
  });

  it("retirer un dépôt de la liste ferme aussi son onglet", async () => {
    await openAll(REPO_A, REPO_B);
    await s().forget(REPO_B);
    expect(s().repos.map((r) => r.path)).toEqual([REPO_A]);
    expect(s().tabs).toEqual([REPO_A]);
    expect(s().active).toBeNull();
  });
});

describe("store : persistance", () => {
  it("restaure les onglets et l'onglet actif au démarrage", async () => {
    await openAll(REPO_A, REPO_B);
    s().activate(REPO_A);
    // Simule un redémarrage de l'app.
    useApp.setState({ ready: false, tabs: [], active: null, repos: [] });
    await s().init();
    expect(s().tabs).toEqual([REPO_A, REPO_B]);
    expect(s().active).toBe(REPO_A);
  });

  it("ignore au démarrage les onglets de dépôts qui ne sont plus connus", async () => {
    await api.setSession({ openTabs: ["C:/disparu", REPO_A], active: "C:/disparu" });
    await api.openRepo(REPO_A);
    await s().init();
    expect(s().tabs).toEqual([REPO_A]);
    expect(s().active).toBeNull();
  });

  it("enregistre les réglages", async () => {
    s().updateSettings({ theme: "light" });
    expect(s().settings).toEqual({ theme: "light", language: "system" });
    expect((await api.getState()).settings.theme).toBe("light");
  });
});

describe("repoColor", () => {
  it("est stable pour un même chemin et reste dans la palette", () => {
    expect(repoColor(REPO_A)).toBe(repoColor(REPO_A));
    for (const p of [REPO_A, REPO_B, REPO_C, "", "x"]) {
      expect(repoColor(p)).toMatch(/^var\(--l[0-3]\)$/);
    }
  });
});
