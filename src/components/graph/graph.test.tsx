import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockHistory } from "../../lib/mockHistory";
import { useApp } from "../../store/app";
import { useGraph, WIP } from "../../store/graph";
import { REPO_A } from "../../test/utils";
import { CommitGraph } from "./CommitGraph";
import { CommitPanel } from "./CommitPanel";
import { RefsSidebar } from "./RefsSidebar";

const history = () => mockHistory(REPO_A);
const g = () => useGraph.getState();

async function loaded() {
  await g().refresh(REPO_A);
}

describe("<CommitGraph />", () => {
  it("n'affiche que les lignes visibles, avec étiquettes de branches", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={0} />);
    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(100); // virtualisé : pas 1000 lignes
    expect(within(rows[0]).getByText("main")).toBeInTheDocument();
    expect(within(rows[0]).getByText(history().commits[0].sha.slice(0, 7))).toBeInTheDocument();
  });

  it("ajoute la ligne « modifications en cours » quand la copie de travail est sale", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={3} />);
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveTextContent("Modifications en cours — 3 fichiers");
  });

  it("clic et flèches du clavier changent la sélection", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={0} />);
    const rows = screen.getAllByRole("option");
    await userEvent.pointer({ keys: "[MouseLeft]", target: rows[2] });
    expect(g().graphs[REPO_A].selected).toBe(history().commits[2].sha);
    await userEvent.keyboard("{ArrowDown}");
    expect(g().graphs[REPO_A].selected).toBe(history().commits[3].sha);
    await userEvent.keyboard("{Home}");
    expect(g().graphs[REPO_A].selected).toBe(history().commits[0].sha);
  });

  it("dépôt sans commit", async () => {
    useGraph.setState({
      graphs: { [REPO_A]: { commits: [], refs: null, loading: false, done: true, selected: null, fingerprint: "" } },
    });
    render(<CommitGraph path={REPO_A} changes={0} />);
    expect(screen.getByText("Aucun commit pour l’instant.")).toBeInTheDocument();
  });
});

describe("<CommitPanel />", () => {
  it("invite à choisir un commit, puis affiche ses détails et ouvre un diff", async () => {
    await loaded();
    const { rerender } = render(<CommitPanel path={REPO_A} changes={0} />);
    expect(screen.getByText(/Sélectionnez un commit/)).toBeInTheDocument();

    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    rerender(<CommitPanel path={REPO_A} changes={0} />);
    expect(await screen.findByRole("heading", { name: c.subject })).toBeInTheDocument();
    expect(screen.getByText(c.sha)).toBeInTheDocument();

    const files = screen.getAllByRole("button").filter((b) => b.className.includes("file-row"));
    await userEvent.click(files[0]);
    expect(g().diffs[REPO_A]?.sha).toBe(c.sha);
  });

  it("un clic sur un parent le sélectionne", async () => {
    await loaded();
    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} changes={0} />);
    await userEvent.click(await screen.findByRole("button", { name: c.parents[0].slice(0, 7) }));
    expect(g().graphs[REPO_A].selected).toBe(c.parents[0]);
  });

  it("bascule la liste des fichiers en arborescence (réglage mémorisé) et replie un dossier", async () => {
    await loaded();
    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} changes={0} />);
    const listBtn = await screen.findByRole("button", { name: "Liste" });
    expect(listBtn).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Arborescence" }));
    expect(useApp.getState().settings.fileView).toBe("tree");
    expect(screen.getByRole("button", { name: "Arborescence" })).toHaveAttribute("aria-pressed", "true");

    const files = screen.getByRole("list", { name: /fichiers? modifiés?/ });
    const dirs = within(files).getAllByRole("button", { expanded: true });
    expect(dirs.length).toBeGreaterThan(0);
    const before = within(files).getAllByRole("button").length;
    await userEvent.click(dirs[0]);
    expect(dirs[0]).toHaveAttribute("aria-expanded", "false");
    expect(within(files).getAllByRole("button").length).toBeLessThan(before);
  });

  it("ligne WIP : résumé de la copie de travail", async () => {
    await loaded();
    g().select(REPO_A, WIP);
    render(<CommitPanel path={REPO_A} changes={2} />);
    expect(screen.getByText("2 fichiers modifiés dans la copie de travail.")).toBeInTheDocument();
  });
});

describe("<RefsSidebar />", () => {
  it("liste les sections ; tags repliés par défaut", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    expect(screen.getByRole("button", { name: /Local/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /origin/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Tags/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("replier une section est mémorisé pour le dépôt", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.click(screen.getByRole("button", { name: /Local/ }));
    expect(screen.getByRole("button", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");
    expect(useApp.getState().repoUi[REPO_A].collapsed).toContain("local");
  });

  it("masquer une section via le menu", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.click(screen.getByRole("button", { name: "Sections affichées" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "origin" }));
    expect(screen.queryByRole("button", { name: /^origin/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 section masquée/ })).toBeInTheDocument();
  });

  it("le filtre ouvre les sections et ne garde que les refs correspondantes", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Filtrer" }), "v0.1");
    expect(screen.getByRole("button", { name: /Tags/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "v0.1.0" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Local/ })).not.toBeInTheDocument();
  });

  it("un clic sur une branche sélectionne son commit", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    const fix = history().refs.refs.find((r) => r.short === "fix/ssh-agent")!;
    await userEvent.click(screen.getAllByRole("button", { name: /^ssh-agent/ })[0]);
    expect(g().graphs[REPO_A].selected).toBe(fix.target);
  });

  it("range les branches à préfixe dans des dossiers repliables (mémorisé)", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    const local = screen.getByRole("navigation").querySelector(".side-group")! as HTMLElement;
    const folder = within(local).getByRole("button", { name: /^feature\s*2$/ });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(within(local).getByRole("button", { name: "graph-rendering" })).toBeInTheDocument();
    expect(within(local).getByRole("button", { name: "profils" })).toBeInTheDocument();

    await userEvent.click(folder);
    expect(within(local).queryByRole("button", { name: "profils" })).not.toBeInTheDocument();
    expect(useApp.getState().repoUi[REPO_A].collapsed).toContain("local/feature");
  });
});
