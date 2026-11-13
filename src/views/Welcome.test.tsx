import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useApp } from "../store/app";
import { REPO_A, REPO_B } from "../test/utils";
import { Welcome } from "./Welcome";

describe("<Welcome />", () => {
  it("affiche un message quand aucun dépôt n'est connu", () => {
    render(<Welcome />);
    expect(screen.getByText(/Aucun dépôt pour l’instant/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rechercher un dépôt" })).not.toBeInTheDocument();
  });

  it("filtre les dépôts récents par nom ou chemin", async () => {
    await useApp.getState().openPath(REPO_A);
    await useApp.getState().openPath(REPO_B);
    render(<Welcome />);

    const search = screen.getByRole("textbox", { name: "Rechercher un dépôt" });
    await userEvent.type(search, "api");
    expect(screen.getByText("api-backend")).toBeInTheDocument();
    expect(screen.queryByText("GitGR")).not.toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(screen.getByText(/Aucun dépôt ne correspond/)).toBeInTheDocument();
  });

  it("ouvre un dépôt récent au clic", async () => {
    await useApp.getState().openPath(REPO_A);
    useApp.getState().activate(null);
    render(<Welcome />);

    await userEvent.click(screen.getByRole("button", { name: /^GitGR/ }));
    expect(useApp.getState().active).toBe(REPO_A);
  });

  it("retire un dépôt de la liste", async () => {
    await useApp.getState().openPath(REPO_A);
    render(<Welcome />);

    await userEvent.click(screen.getByRole("button", { name: "Retirer GitGR de la liste" }));
    expect(useApp.getState().repos).toEqual([]);
  });

  it("Cloner et Initialiser sont désactivés pour l'instant", () => {
    render(<Welcome />);
    expect(screen.getByRole("button", { name: /Cloner/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Initialiser/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Ouvrir un dépôt/ })).toBeEnabled();
  });
});
