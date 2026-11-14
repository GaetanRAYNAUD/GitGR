import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DiffLine, FileDiff } from "../../lib/types";
import { useApp } from "../../store/app";
import { DiffBody, DiffViewToggle, splitRows } from "./DiffBody";

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
    expect(screen.getByRole("table")).not.toHaveClass("split");
    await userEvent.click(screen.getByRole("button", { name: "Côte à côte" }));
    expect(useApp.getState().settings.diffView).toBe("split");
    expect(screen.getByRole("table")).toHaveClass("split");
    expect(screen.getByRole("button", { name: "Côte à côte" })).toHaveAttribute("aria-pressed", "true");
  });

  it("la sélection de lignes fonctionne aussi côte à côte", () => {
    useApp.setState({ settings: { ...useApp.getState().settings, diffView: "split" } });
    const toggle = vi.fn();
    render(<DiffBody data={data} selection={{ selected: new Set(["0:3"]), toggle }} />);
    fireEvent.mouseDown(screen.getByText("B"));
    expect(toggle).toHaveBeenCalledWith(0, 3, false);
    expect(screen.getByText("B")).toHaveClass("picked");
    // Le contexte n'est pas sélectionnable.
    fireEvent.mouseDown(screen.getAllByText("a")[0]);
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
