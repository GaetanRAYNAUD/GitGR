import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useWork } from "../../store/worktree";
import { REPO_B } from "../../test/utils";
import { DialogHost } from "../DialogHost";
import { CommitBox } from "./CommitBox";
import { StagingPanel } from "./StagingPanel";
import { WorkDiffView } from "./WorkDiffView";

// REPO_B : modifications simulées (cf. lib/mockWorktree.ts).
const w = () => useWork.getState();
const repo = () => w().repos[REPO_B];

async function panel() {
  await w().refresh(REPO_B);
  render(
    <>
      <StagingPanel path={REPO_B} />
      <DialogHost />
    </>,
  );
}

const list = (name: string) => screen.getByRole("list", { name: new RegExp(`^${name}$`) });

// Un clic lance l'action sans l'attendre (git, puis relecture du graphe, de l'état et du diff) :
// on la laisse se terminer pour qu'elle ne déborde pas sur le test suivant.
afterEach(async () => {
  await vi.waitFor(() => expect(repo()?.busy ?? false).toBe(false));
  await new Promise((r) => setTimeout(r, 200));
});

describe("<StagingPanel />", () => {
  it("affiche les sections non indexés / indexés avec leurs fichiers", async () => {
    await panel();
    expect(within(list("Non indexés")).getByText("render.ts")).toBeInTheDocument();
    expect(within(list("Non indexés")).getByText("notes.txt")).toBeInTheDocument();
    expect(within(list("Indexés")).getByText("lanes.ts")).toBeInTheDocument();
    expect(screen.queryByText("Conflits")).not.toBeInTheDocument();
  });

  it("indexer un fichier, tout retirer", async () => {
    await panel();
    const row = within(list("Non indexés")).getByText("render.ts").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Indexer" }));
    expect(await within(list("Indexés")).findByText("render.ts")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tout retirer" }));
    expect(await screen.findByText("Rien d’indexé pour l’instant.")).toBeInTheDocument();
  });

  it("un double-clic indexe le fichier", async () => {
    await panel();
    await userEvent.dblClick(within(list("Non indexés")).getByText("notes.txt"));
    expect(await within(list("Indexés")).findByText("notes.txt")).toBeInTheDocument();
  });

  it("abandonner un fichier demande confirmation", async () => {
    await panel();
    const spy = vi.spyOn(api, "discardFiles");
    await userEvent.click(screen.getByRole("button", { name: "Annuler les modifications de notes.txt" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Le fichier non suivi notes.txt sera supprimé");
    await userEvent.click(within(dialog).getByRole("button", { name: "Retour" }));
    expect(spy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Annuler les modifications de notes.txt" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler les modifications" }));
    expect(spy).toHaveBeenCalledWith(REPO_B, [], ["notes.txt"]);
  });

  it("tout annuler propose de stasher à la place", async () => {
    await panel();
    const stash = vi.spyOn(api, "stashAll");
    await userEvent.click(screen.getByRole("button", { name: "Tout annuler" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Stasher à la place" }));
    expect(stash).toHaveBeenCalled();
    expect(await screen.findByText(/la copie de travail est propre/)).toBeInTheDocument();
  });

  it("un clic sur un fichier ouvre son diff du bon côté", async () => {
    await panel();
    await userEvent.click(within(list("Non indexés")).getByText("notes.txt"));
    expect(repo().diff).toMatchObject({ area: "untracked", file: { path: "notes.txt" } });
  });
});

describe("<CommitBox />", () => {
  it("bouton désactivé sans résumé ; commit au clic ; compteur de caractères", async () => {
    await w().refresh(REPO_B);
    render(<CommitBox path={REPO_B} />);
    const button = screen.getByRole("button", { name: "Commiter 2 fichiers" });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("Résumé"), "fix: x");
    expect(screen.getByText("6 / 72")).toBeInTheDocument();
    const spy = vi.spyOn(api, "commit");
    await userEvent.click(button);
    expect(spy).toHaveBeenCalledWith(REPO_B, "fix: x", false);
  });

  it("Ctrl+Entrée commite ; rien d'indexé : bouton désactivé avec explication", async () => {
    await w().refresh(REPO_B);
    await w().unstageAll(REPO_B);
    render(<CommitBox path={REPO_B} />);
    await userEvent.type(screen.getByPlaceholderText("Résumé"), "x");
    expect(screen.getByRole("button", { name: "Commiter" })).toBeDisabled();
    expect(screen.getByText("Indexez des fichiers pour commiter.")).toBeInTheDocument();

    await w().stageAll(REPO_B);
    const spy = vi.spyOn(api, "commit");
    await userEvent.type(screen.getByPlaceholderText("Résumé"), "{Control>}{Enter}{/Control}");
    expect(spy).toHaveBeenCalled();
  });

  it("amend : message du dernier commit et bouton dédié", async () => {
    await useGraph.getState().refresh(REPO_B);
    await w().refresh(REPO_B);
    render(<CommitBox path={REPO_B} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Amend" }));
    expect(screen.getByRole("button", { name: "Modifier le dernier commit" })).toBeEnabled();
    expect((screen.getByPlaceholderText("Résumé") as HTMLInputElement).value).not.toBe("");
  });
});

describe("<WorkDiffView />", () => {
  async function openRender() {
    await w().refresh(REPO_B);
    await w().openDiff(REPO_B, repo().status!.unstaged[0], "unstaged");
    return render(
      <>
        <WorkDiffView path={REPO_B} diff={repo().diff!} />
        <DialogHost />
      </>,
    );
  }

  it("sélection de lignes au clic puis indexation des lignes choisies", async () => {
    const view = await openRender();
    const spy = vi.spyOn(api, "stageLines");
    const added = screen.getByText(/const width/).closest("tr")!;
    await userEvent.pointer({ keys: "[MouseLeft]", target: added });
    expect(screen.getByText("1 ligne sélectionnée")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Indexer la ligne" }));
    expect(spy).toHaveBeenCalledWith(REPO_B, "src/graph/render.ts", null, [{ hunk: 0, line: 3 }], expect.any(String), false);
    view.unmount();
  });

  it("Maj+clic sélectionne une plage de lignes modifiées", async () => {
    await openRender();
    // La ligne est découpée en segments (mots modifiés surlignés) : on cherche la ligne entière.
    const first = screen.getAllByRole("row").find((r) => r.textContent?.includes("rows.length * 34"))!;
    const last = screen.getByText(/const width/).closest("tr")!;
    fireEvent.mouseDown(first);
    fireEvent.mouseDown(last, { shiftKey: true });
    expect(screen.getByText("3 lignes sélectionnées")).toBeInTheDocument();
  });

  it("indexer un bloc entier ; annuler un bloc demande confirmation", async () => {
    await openRender();
    const stage = vi.spyOn(api, "stageLines");
    await userEvent.click(screen.getByRole("button", { name: "Indexer le bloc" }));
    expect(stage.mock.calls[0][3]).toEqual([
      { hunk: 0, line: 1 },
      { hunk: 0, line: 2 },
      { hunk: 0, line: 3 },
    ]);
  });

  it("annuler un bloc passe par une confirmation", async () => {
    await openRender();
    const discard = vi.spyOn(api, "discardLines");
    await userEvent.click(screen.getByRole("button", { name: "Annuler le bloc" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Annuler ce bloc (3 lignes) ?");
    expect(discard).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler les modifications" }));
    expect(discard).toHaveBeenCalled();
    expect(useApp.getState().error).toBeNull();
  });
});

describe("<CommitBox /> dépôt sans commit", () => {
  it("amend est désactivé tant qu'il n'y a pas de commit", async () => {
    await w().refresh(REPO_B);
    render(<CommitBox path={REPO_B} />);
    expect(screen.getByRole("checkbox", { name: "Amend" })).toBeDisabled();
  });
});
