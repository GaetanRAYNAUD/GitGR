import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useApp } from "../store/app";
import { GitMissing } from "./GitMissing";

describe("<GitMissing />", () => {
  it("fenêtre modale, focus sur l'action principale ; « Réessayer » dit ce qu'il trouve", async () => {
    useApp.setState({ recheckGit: vi.fn(async () => {}) });
    render(<GitMissing />);
    const dialog = screen.getByRole("alertdialog", { name: "Git est introuvable" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Pas de bouton mort « Git embarqué » tant que la fonction n'existe pas.
    expect(screen.queryByRole("button", { name: /embarqué/ })).not.toBeInTheDocument();
    // Sous Linux (la CI), Git s'installe par le gestionnaire de paquets : pas de téléchargement,
    // « Réessayer » est l'action principale.
    const linux = navigator.userAgent.toLowerCase().includes("linux");
    expect(screen.getByRole("button", { name: linux ? "Réessayer" : "Télécharger Git" })).toHaveFocus();
    expect(screen.queryAllByRole("button", { name: "Télécharger Git" })).toHaveLength(linux ? 0 : 1);

    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Git n’est toujours pas trouvé dans le PATH");
  });

  it("une recherche qui échoue le dit", async () => {
    useApp.setState({ recheckGit: vi.fn(async () => Promise.reject(new Error("x"))) });
    render(<GitMissing />);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("status")).toHaveTextContent("La recherche de Git a échoué");
  });
});
