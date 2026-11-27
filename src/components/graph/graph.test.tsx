import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockHistory } from "../../lib/mockHistory";
import { useApp } from "../../store/app";
import { useGraph, WIP } from "../../store/graph";
import { useWork } from "../../store/worktree";
import { REPO_A } from "../../test/utils";
import { api } from "../../lib/api";
import { useContextMenu } from "../ContextMenu";
import { CommitGraph, inkOn, parseColor } from "./CommitGraph";
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
      graphs: { [REPO_A]: { commits: [], refs: null, loading: false, done: true, selected: null, picked: [], focus: null, fingerprint: "" } },
    });
    render(<CommitGraph path={REPO_A} changes={0} />);
    expect(screen.getByText("Aucun commit pour l’instant.")).toBeInTheDocument();
  });
});

describe("<CommitGraph /> : clavier, lecteur d'écran, erreurs", () => {
  afterEach(() => {
    useContextMenu.getState().close();
    vi.restoreAllMocks();
  });
  const labels = () => (useContextMenu.getState().menu?.items ?? []).flatMap((i) => (i === "sep" ? [] : [i.label]));

  it("Maj+F10 et la touche Menu ouvrent le menu de la ligne active", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={0} />);
    const list = screen.getByRole("listbox", { name: "Historique des commits" });
    expect(list).toHaveFocus(); // focus au graphe à l'ouverture
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(labels()).toContain("Copier le SHA");
    useContextMenu.getState().close();
    // Sélection multiple : le menu de la sélection.
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    fireEvent.keyDown(list, { key: "ContextMenu" });
    expect(labels()).toContain("Copier les SHA");
  });

  it("la ligne « en cours » a son menu, même dans un dépôt sans commit", async () => {
    useGraph.setState({
      graphs: { [REPO_A]: { commits: [], refs: null, loading: false, done: true, selected: null, picked: [], focus: null, fingerprint: "" } },
    });
    render(<CommitGraph path={REPO_A} changes={2} />);
    const row = screen.getByRole("option", { name: "Modifications en cours — 2 fichiers" });
    fireEvent.contextMenu(row);
    expect(labels()).toEqual(["Tout indexer", "Stasher les modifications", "Tout abandonner…"]);
    // Sans commit initial, git refuse de stasher : grisé, avec la raison.
    const stash = useContextMenu.getState().menu?.items[1];
    expect(stash !== "sep" && stash && "disabled" in stash && stash.disabled).toBe(true);
  });

  it("liste multisélection, lignes nommées et numérotées, « // » caché du lecteur d'écran", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={1} />);
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    // L'en-tête (boutons, poignées) n'est plus dans la liste.
    expect(within(list).queryByRole("button")).toBeNull();
    const [wip, head] = screen.getAllByRole("option");
    expect(wip).toHaveAccessibleName("Modifications en cours — 1 fichier");
    expect(head).toHaveAttribute("aria-posinset", "2");
    expect(head).toHaveAttribute("aria-setsize", "-1"); // historique pas encore complet
    expect(head.getAttribute("aria-label")).toContain("HEAD (commit courant)");
    expect(head.getAttribute("aria-label")).toContain("main (branche courante)");
  });

  it("l'échec d'une page suivante laisse le graphe et propose de réessayer", async () => {
    await loaded();
    vi.spyOn(api, "repoLog").mockRejectedValueOnce("git_failed");
    await g().loadMore(REPO_A);
    render(<CommitGraph path={REPO_A} changes={0} />);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(10);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Impossible de charger la suite");
    await userEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(g().graphs[REPO_A].done).toBe(true));
    expect(g().graphs[REPO_A].pageError).toBeUndefined();
  });
});

describe("encre des initiales sur un nœud", () => {
  it("lit les couleurs CSS", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#e8c547")).toEqual([232, 197, 71]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColor("var(--x)")).toBeNull();
  });

  it("sombre sur les voies claires, blanche sur les voies foncées", () => {
    expect(inkOn("#e8c547", "#ffffff", "#121418")).toBe("#121418"); // jaune
    expect(inkOn("#9ccc4a", "#ffffff", "#121418")).toBe("#121418"); // vert
    expect(inkOn("#2f6fe0", "#ffffff", "#121418")).toBe("#ffffff"); // bleu
  });
});

describe("<CommitPanel />", () => {
  it("invite à choisir un commit, puis affiche ses détails et ouvre un diff", async () => {
    await loaded();
    const { rerender } = render(<CommitPanel path={REPO_A} />);
    expect(screen.getByText(/Sélectionnez un commit/)).toBeInTheDocument();

    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    rerender(<CommitPanel path={REPO_A} />);
    expect(await screen.findByRole("heading", { name: c.subject })).toBeInTheDocument();
    expect(screen.getByText(c.sha)).toBeInTheDocument();
    // Auteur et e-mail visibles (pas seulement en infobulle).
    expect(screen.getByText(c.email)).toBeInTheDocument();

    const files = screen.getAllByRole("option");
    await userEvent.click(files[0]);
    expect(g().diffs[REPO_A]?.sha).toBe(c.sha);
  });

  it("un clic sur un parent le sélectionne", async () => {
    await loaded();
    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    await userEvent.click(await screen.findByRole("button", { name: `Parent ${c.parents[0].slice(0, 7)} : sélectionner ce commit` }));
    expect(g().graphs[REPO_A].selected).toBe(c.parents[0]);
  });

  it("parent au clavier : focus sur le titre du nouveau commit, Alt+← revient", async () => {
    await loaded();
    const [c] = history().commits;
    const parent = history().commits.find((x) => x.sha === c.parents[0])!;
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^Parent ${parent.sha.slice(0, 7)}`) }));
    const heading = await screen.findByRole("heading", { name: parent.subject });
    await waitFor(() => expect(heading).toHaveFocus());

    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await waitFor(() => expect(g().graphs[REPO_A].selected).toBe(c.sha));
    const back = await screen.findByRole("heading", { name: c.subject });
    await waitFor(() => expect(back).toHaveFocus());
    // Plus rien à remonter : Alt+← ne fait rien.
    await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(g().graphs[REPO_A].selected).toBe(c.sha);
  });

  it("committer différent ou autre date de commit : affichés sous l'auteur", async () => {
    await loaded();
    const c = history().commits[0];
    const real = api.commitDetails;
    vi.spyOn(api, "commitDetails").mockImplementation(async (p, sha) => {
      const d = await real(p, sha);
      return { ...d, committer: "Robot", committerEmail: "robot@example.com", commitTime: d.time + 3600 };
    });
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    expect(await screen.findByText(/^Commité par Robot <robot@example.com> le /)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("erreur de chargement : message et Réessayer", async () => {
    await loaded();
    const c = history().commits[1];
    vi.spyOn(api, "commitDetails").mockRejectedValueOnce("git_failed");
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    const alert = await screen.findByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("heading", { name: c.subject })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("bascule la liste des fichiers en arborescence (réglage mémorisé) et replie un dossier", async () => {
    await loaded();
    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    const listBtn = await screen.findByRole("button", { name: "Liste" });
    expect(listBtn).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Arborescence" }));
    expect(useApp.getState().settings.fileView).toBe("tree");
    expect(screen.getByRole("button", { name: "Arborescence" })).toHaveAttribute("aria-pressed", "true");

    const files = screen.getByRole("tree", { name: /fichiers? modifiés?/ });
    const dirs = within(files).getAllByRole("treeitem", { expanded: true });
    expect(dirs.length).toBeGreaterThan(0);
    const before = within(files).getAllByRole("treeitem").length;
    await userEvent.click(dirs[0]);
    expect(dirs[0]).toHaveAttribute("aria-expanded", "false");
    expect(within(files).getAllByRole("treeitem").length).toBeLessThan(before);
  });

  it("ligne WIP : panneau des modifications en cours", async () => {
    await loaded();
    await useWork.getState().refresh(REPO_A);
    g().select(REPO_A, WIP);
    render(<CommitPanel path={REPO_A} />);
    expect(screen.getByRole("complementary", { name: "Modifications en cours" })).toBeInTheDocument();
    expect(screen.getByText(/la copie de travail est propre/)).toBeInTheDocument();
  });
});

describe("<RefsSidebar />", () => {
  it("liste les sections ; tags repliés par défaut", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    expect(screen.getByRole("treeitem", { name: /Local/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("treeitem", { name: /origin/ })[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: /Tags/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("replier une section est mémorisé pour le dépôt", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.click(screen.getByRole("treeitem", { name: /Local/ }));
    expect(screen.getByRole("treeitem", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");
    expect(useApp.getState().repoUi[REPO_A].collapsed).toContain("local");
  });

  it("masquer une section via le menu", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.click(screen.getByRole("button", { name: "Sections affichées" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "origin" }));
    expect(screen.queryByRole("treeitem", { name: /^origin/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 section masquée/ })).toBeInTheDocument();
  });

  it("le filtre ouvre les sections et ne garde que les refs correspondantes", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Filtrer" }), "v0.1");
    expect(screen.getByRole("treeitem", { name: /Tags/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "v0.1.0" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /Local/ })).not.toBeInTheDocument();
  });

  it("un clic sur une branche sélectionne son commit", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    const fix = history().refs.refs.find((r) => r.short === "fix/ssh-agent")!;
    await userEvent.click(screen.getAllByRole("treeitem", { name: /^ssh-agent/ })[0]);
    expect(g().graphs[REPO_A].selected).toBe(fix.target);
  });

  it("range les branches à préfixe dans des dossiers repliables (mémorisé)", async () => {
    await loaded();
    render(<RefsSidebar path={REPO_A} />);
    const local = screen.getByRole("navigation").querySelector(".side-group")! as HTMLElement;
    const folder = within(local).getByRole("treeitem", { name: /^feature\s*2$/ });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(within(local).getByRole("treeitem", { name: "graph-rendering" })).toBeInTheDocument();
    expect(within(local).getByRole("treeitem", { name: "profils" })).toBeInTheDocument();

    await userEvent.click(folder);
    expect(within(local).queryByRole("treeitem", { name: "profils" })).not.toBeInTheDocument();
    expect(useApp.getState().repoUi[REPO_A].collapsed).toContain("local/feature");
  });
});

describe("<CommitGraph /> colonnes", () => {
  it("le menu des colonnes masque une colonne (mémorisé) ; le message reste toujours", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={0} />);
    const labels = () => Array.from(document.querySelectorAll(".graph-head-label"), (e) => e.textContent);
    expect(labels()).toContain("Auteur");

    await userEvent.click(screen.getByRole("button", { name: "Colonnes affichées" }));
    const menu = screen.getByRole("dialog", { name: "Colonnes affichées" });
    expect(within(menu).getByRole("checkbox", { name: "Message" })).toBeDisabled();
    await userEvent.click(within(menu).getByRole("checkbox", { name: "Auteur" }));
    expect(useApp.getState().settings.hiddenColumns).toEqual(["author"]);
    expect(labels()).toEqual(["Branche / tag", "Graphe", "Message", "Date", "SHA"]);
    expect(screen.getAllByRole("option")[0].querySelector(".commit-author")).toBeNull();
  });

  it("clic droit sur l'en-tête ouvre le menu ; largeur d'une colonne au clavier", async () => {
    await loaded();
    render(<CommitGraph path={REPO_A} changes={0} />);
    fireEvent.contextMenu(document.querySelector(".graph-head")!);
    expect(screen.getByRole("dialog", { name: "Colonnes affichées" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("separator", { name: "Largeur de la colonne « Date »" }), { key: "ArrowRight" });
    // jsdom ne mesure rien : 0 + 16, ramené au minimum.
    expect(useApp.getState().settings.layout?.["col:date"]).toBe(40);
    expect((document.querySelector(".graph-wrap") as HTMLElement).style.getPropertyValue("--cols")).toContain("40px");
  });
});

describe("compteurs de fichiers", () => {
  it("par catégorie dans les détails d'un commit", async () => {
    await loaded();
    const c = history().commits[0];
    g().select(REPO_A, c.sha);
    render(<CommitPanel path={REPO_A} />);
    const counts = await screen.findByRole("img", { name: /modifié|ajouté|supprimé|renommé/ });
    expect(counts.textContent).toMatch(/^([+~→−]\d+)+$/);
  });
});
