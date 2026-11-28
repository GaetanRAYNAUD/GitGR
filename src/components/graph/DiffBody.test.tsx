import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DiffLine, FileDiff } from "../../lib/types";
import { useApp } from "../../store/app";
import { DiffBody, DiffViewToggle, hunkJump, lineOrder, splitRows } from "./DiffBody";
import { mockIgnoreWs } from "../../lib/mockHistory";
import { searchMark } from "./SearchView";

const ctx = (n: number, text: string): DiffLine => ({ kind: " ", old: n, new: n, text });
const add = (n: number, text: string): DiffLine => ({ kind: "+", old: null, new: n, text });
const del = (n: number, text: string): DiffLine => ({ kind: "-", old: n, new: null, text });

const hunk = { header: "@@ -1,4 +1,4 @@", lines: [ctx(1, "a"), del(2, "b"), del(3, "c"), add(2, "B"), ctx(4, "d"), add(4, "e")] };
const data: FileDiff = { binary: false, truncated: false, hunks: [hunk], fingerprint: "x" };

describe("splitRows", () => {
  it("apparie suppressions et ajouts d'un même groupe, contexte des deux côtés", () => {
    const rows = splitRows(hunk).map((r) => [r.left?.l.text ?? null, r.right?.l.text ?? null]);
    expect(rows).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", null],
      ["d", "d"],
      [null, "e"],
    ]);
    // Les indices renvoient aux lignes du hunk (pour la sélection).
    expect(splitRows(hunk)[1].right?.i).toBe(3);
  });

  it("mêmes paires que la comparaison mot à mot quand un « - » suit des « + »", () => {
    const h = { header: "", lines: [del(1, "a"), del(2, "b"), add(1, "A"), del(3, "d"), add(2, "D"), add(3, "f")] };
    const rows = splitRows(h).map((r) => [r.left?.l.text ?? null, r.right?.l.text ?? null]);
    expect(rows).toEqual([
      ["a", "A"],
      ["b", null],
      ["d", "D"],
      [null, "f"],
    ]);
  });
});

describe("<DiffBody /> côte à côte", () => {
  it("la bascule est mémorisée dans les réglages et change l'affichage", async () => {
    render(
      <>
        <DiffViewToggle />
        <DiffBody data={data} />
      </>,
    );
    expect(screen.getByRole("grid")).not.toHaveClass("split");
    await userEvent.click(screen.getByRole("button", { name: "Côte à côte" }));
    expect(useApp.getState().settings.diffView).toBe("split");
    expect(screen.getByRole("grid")).toHaveClass("split");
    expect(screen.getByRole("button", { name: "Côte à côte" })).toHaveAttribute("aria-pressed", "true");
  });

  it("la sélection de lignes fonctionne aussi côte à côte", () => {
    useApp.setState({ settings: { ...useApp.getState().settings, diffView: "split" } });
    const toggle = vi.fn();
    render(<DiffBody data={data} selection={{ selected: new Set(["0:3"]), toggle, extend: vi.fn(), all: vi.fn() }} />);
    const b = screen.getByRole("gridcell", { name: /Ajout, ligne 2 :\s*B/ });
    fireEvent.mouseDown(b);
    expect(toggle).toHaveBeenCalledWith(0, 3, false);
    expect(b).toHaveClass("picked");
    expect(b).toHaveAttribute("aria-selected", "true");
    // Le contexte n'est pas sélectionnable.
    fireEvent.mouseDown(screen.getByRole("gridcell", { name: /Ligne 1 :\s*a/ }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe("<DiffBody /> mots modifiés", () => {
  it("surligne seulement les mots changés d'une ligne remplacée, dans les deux vues", () => {
    const h = { header: "@@", lines: [del(1, "const height = rows * 34;"), add(1, "const height = rows * ROW_H;")] };
    const d: FileDiff = { binary: false, truncated: false, hunks: [h], fingerprint: "y" };
    const { container, unmount } = render(<DiffBody data={d} />);
    const hl = () => [...container.querySelectorAll(".hl")].map((e) => e.textContent);
    expect(hl()).toEqual(["34", "ROW_H"]);
    unmount();
    useApp.setState({ settings: { ...useApp.getState().settings, diffView: "split" } });
    const split = render(<DiffBody data={d} />);
    expect([...split.container.querySelectorAll(".hl")].map((e) => e.textContent)).toEqual(["34", "ROW_H"]);
  });
});

describe("DiffBody côte à côte : séparateur", () => {
  it("au milieu par défaut ; la part choisie règle la colonne de gauche", () => {
    useApp.setState((s) => ({ settings: { ...s.settings, diffView: "split" } }));
    const { container, rerender } = render(<DiffBody data={data} />);
    const sep = screen.getByRole("separator", { name: "Partage entre l’ancienne et la nouvelle version" });
    expect(sep.style.left).toBe("50%");

    useApp.getState().setLayout({ diffSplit: 0.3 });
    rerender(<DiffBody data={data} />);
    expect(sep.style.left).toContain("30%");
    expect((container.querySelectorAll("col")[1] as HTMLElement).style.width).toBe("30%");
  });
});

const two: FileDiff = {
  binary: false,
  truncated: false,
  fingerprint: "z",
  hunks: [hunk, { header: "@@ -20 +20 @@", lines: [ctx(20, "x"), del(21, "y"), add(21, "Y")] }],
};

describe("hunkJump (F7 / Maj+F7)", () => {
  const order = lineOrder(two);
  const at = (hunk: number, line: number) => order.findIndex((r) => r.hunk === hunk && r.line === line);
  it("va à la première ligne modifiée du bloc suivant, rien après le dernier", () => {
    expect(hunkJump(two, order, -1, false)).toBe(at(0, 1));
    expect(hunkJump(two, order, at(0, 4), false)).toBe(at(1, 1));
    expect(hunkJump(two, order, at(1, 2), false)).toBe(-1);
  });
  it("Maj+F7 revient au début du bloc, puis au bloc précédent", () => {
    expect(hunkJump(two, order, at(1, 2), true)).toBe(at(1, 1));
    expect(hunkJump(two, order, at(1, 1), true)).toBe(at(0, 1));
    expect(hunkJump(two, order, at(0, 1), true)).toBe(-1);
  });
});

describe("<DiffBody /> au clavier", () => {
  const setup = () => {
    useApp.setState((s) => ({ settings: { ...s.settings, diffView: "inline" } }));
    const sel = { selected: new Set<string>(), toggle: vi.fn(), extend: vi.fn(), all: vi.fn() };
    const onKeyAction = vi.fn();
    render(<DiffBody data={two} selection={sel} onKeyAction={onKeyAction} />);
    const grid = screen.getByRole("grid", { name: "Lignes du diff" });
    return { sel, onKeyAction, grid };
  };
  const activeText = (grid: HTMLElement) => document.getElementById(grid.getAttribute("aria-activedescendant") ?? "")?.textContent;

  it("une seule tabulation ; le focus arrive sur la première ligne modifiée", async () => {
    const { grid } = setup();
    expect(grid).toHaveAttribute("tabindex", "0");
    await userEvent.tab();
    expect(grid).toHaveFocus();
    expect(activeText(grid)).toContain("b");
  });

  it("flèches, Espace, Maj+flèches, Ctrl+A, F7, Entrée et Suppr", async () => {
    const { grid, sel, onKeyAction } = setup();
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    expect(activeText(grid)).toContain("c");
    await userEvent.keyboard(" ");
    expect(sel.toggle).toHaveBeenCalledWith(0, 2, false);
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(sel.extend).toHaveBeenCalledWith({ hunk: 0, line: 2 }, { hunk: 0, line: 3 });
    await userEvent.keyboard("{Control>}a{/Control}");
    expect(sel.all).toHaveBeenCalled();
    await userEvent.keyboard("{F7}");
    expect(activeText(grid)).toContain("y");
    await userEvent.keyboard("{Enter}");
    expect(onKeyAction).toHaveBeenLastCalledWith("apply", { hunk: 1, line: 1 });
    await userEvent.keyboard("{Delete}");
    expect(onKeyAction).toHaveBeenLastCalledWith("discard", { hunk: 1, line: 1 });
  });

  it("annonce ajout / suppression, sans compter sur la couleur", () => {
    setup();
    expect(screen.getByRole("gridcell", { name: /Suppression, ligne 2 :/ })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /Ajout, ligne 21 :/ })).toBeInTheDocument();
  });
});

describe("<DiffBody /> états", () => {
  it("marque la dernière ligne sans fin de ligne", () => {
    const d: FileDiff = { ...data, hunks: [{ header: "@@", lines: [{ ...ctx(1, "fin"), noEol: true }] }] };
    render(<DiffBody data={d} />);
    expect(screen.getByTitle("Pas de fin de ligne à la fin du fichier")).toHaveTextContent("sans fin de ligne");
  });

  it("erreur : Réessayer", async () => {
    const onRetry = vi.fn();
    render(<DiffBody error="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("espaces ignorés et plus rien à montrer : le dit, et propose de les afficher", async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, diffIgnoreWs: true } }));
    render(<DiffBody data={{ ...data, hunks: [] }} />);
    expect(screen.getByText(/Seuls des espaces changent/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Afficher les espaces" }));
    expect(useApp.getState().settings.diffIgnoreWs).toBe(false);
  });
});

describe("mockIgnoreWs", () => {
  it("un remplacement qui ne change que des espaces devient du contexte", () => {
    const h = { header: "@@", lines: [del(1, "  a = 1"), add(1, "a  =  1"), del(2, "b"), add(2, "B")] };
    const d = mockIgnoreWs({ ...data, hunks: [h, { header: "@@", lines: [del(9, " z"), add(9, "z ")] }] }, true);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].lines.map((l) => l.kind)).toEqual([" ", "-", "+"]);
    expect(mockIgnoreWs(data, false)).toBe(data);
  });
});

describe("countKind", () => {
  it("range les statuts par catégorie", async () => {
    const { countKind } = await import("./FileList");
    expect(["A", "C", "?", "M", "T", "R", "D", "U"].map(countKind)).toEqual([
      "added",
      "added",
      "added",
      "modified",
      "modified",
      "renamed",
      "deleted",
      "conflicted",
    ]);
  });
});

describe("<DiffBody mark />", () => {
  it("surligne le texte cherché, littéral ou en expression, dans les mots modifiés aussi", () => {
    const d: FileDiff = { ...data, hunks: [{ header: "@@ -1 +1 @@", lines: [del(1, "une aiguille ici"), add(1, "deux aiguilles là"), ctx(2, "rien")] }] };
    const { container } = render(<DiffBody data={d} mark={searchMark({ text: "aiguille", regex: false, file: "" })} />);
    expect([...container.querySelectorAll("mark.diff-find")].map((m) => m.textContent)).toEqual(["aiguille", "aiguille"]);
  });

  it("marque aussi un texte à cheval sur un mot modifié", () => {
    const d: FileDiff = { ...data, hunks: [{ header: "@@ -1 +1 @@", lines: [del(1, "const row = lanes"), add(1, "const col = lanes")] }] };
    const { container } = render(<DiffBody data={d} mark={searchMark({ text: "col = lanes", regex: false, file: "" })} />);
    expect([...container.querySelectorAll("mark.diff-find")].map((m) => m.textContent).join("")).toBe("col = lanes");
  });

  it("échappe le texte littéral ; une expression invalide ne surligne rien", () => {
    expect(searchMark({ text: "a.b(", regex: false, file: "" })?.test("xa.b(y")).toBe(true);
    expect(searchMark({ text: "a(", regex: true, file: "" })).toBeNull();
    expect(searchMark({ text: "", regex: false, file: "" })).toBeNull();
  });
});

describe("<DiffBody /> très long", () => {
  it("attend « Afficher quand même » au-delà de la limite", async () => {
    const lines = Array.from({ length: 5001 }, (_, i) => ({ kind: "+" as const, old: null, new: i + 1, text: `l${i}` }));
    const big: FileDiff = { binary: false, truncated: false, fingerprint: "b", hunks: [{ header: "@@ -0,0 +1,5001 @@", lines }] };
    render(<DiffBody data={big} resetKey="f" />);
    expect(screen.queryByRole("grid")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Afficher quand même" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("<DiffBody /> notes", () => {
  it("une note sous sa ligne de la nouvelle version, en ligne et côte à côte", () => {
    const d: FileDiff = { binary: false, truncated: false, fingerprint: "n", hunks: [{ header: "@@ -1,2 +1,2 @@", lines: [ctx(1, "a"), del(2, "b"), add(2, "B")] }] };
    const notes = new Map([[2, <span key="n">Pourquoi B ?</span>]]);
    useApp.setState((s) => ({ settings: { ...s.settings, diffView: "inline" } }));
    const { container, unmount } = render(<DiffBody data={d} notes={notes} />);
    const rows = [...container.querySelectorAll("tr")].map((r) => (r.classList.contains("diff-note") ? "note" : r.textContent));
    expect(rows.indexOf("note")).toBe(rows.length - 1);
    expect(screen.getByText("Pourquoi B ?")).toBeInTheDocument();
    unmount();
    useApp.setState((s) => ({ settings: { ...s.settings, diffView: "split" } }));
    render(<DiffBody data={d} notes={notes} />);
    expect(screen.getByText("Pourquoi B ?")).toBeInTheDocument();
  });
});
