import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, emitMockRepoChanged } from "./lib/api";
import { useApp } from "./store/app";
import { useWork } from "./store/worktree";
import { REPO_A, REPO_B } from "./test/utils";

const s = () => useApp.getState();

describe("rafraîchissement d'un dépôt", () => {
  it("lit les refs avant l'état de la copie de travail (pas de fichiers « en cours » d'un commit déjà fait)", async () => {
    const refs = vi.spyOn(api, "repoRefs");
    const status = vi.spyOn(api, "workStatus");
    await s().refreshRepo(REPO_B);
    expect(refs).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    // L'état n'est demandé qu'une fois les refs (et le graphe) lus.
    expect(status.mock.invocationCallOrder[0]).toBeGreaterThan(refs.mock.invocationCallOrder[0]);
  });

  it("des demandes pendant un rafraîchissement en cours n'en relancent qu'un seul", async () => {
    const status = vi.spyOn(api, "workStatus");
    await Promise.all([s().refreshRepo(REPO_B), s().refreshRepo(REPO_B), s().refreshRepo(REPO_B)]);
    expect(status).toHaveBeenCalledTimes(2);
  });
});

describe("<App /> : surveillance du dépôt actif", () => {
  it("surveille l'onglet actif et se rafraîchit quand il change sur disque", async () => {
    const watch = vi.spyOn(api, "watchRepo");
    await s().openPath(REPO_B);
    render(<App />);
    await vi.waitFor(() => expect(watch).toHaveBeenLastCalledWith(REPO_B));
    await vi.waitFor(() => expect(useWork.getState().repos[REPO_B]?.status).toBeDefined());

    // Indexation faite « ailleurs » (sans passer par le store), puis notification.
    await api.stageAll(REPO_B);
    await new Promise((r) => setTimeout(r, 200)); // fin des chargements du montage
    const status = vi.spyOn(api, "workStatus");
    status.mockClear(); // espion déjà posé par un test précédent : on repart de zéro
    emitMockRepoChanged(REPO_A); // un autre dépôt : ignoré
    await new Promise((r) => setTimeout(r, 50));
    expect(status).not.toHaveBeenCalled();
    emitMockRepoChanged(REPO_B);
    await vi.waitFor(() => expect(useWork.getState().repos[REPO_B]?.status?.unstaged).toEqual([]));
  });
});
