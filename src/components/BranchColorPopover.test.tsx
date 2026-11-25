import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BRANCH_COLORS } from "../lib/branchColors";
import { useApp } from "../store/app";
import { BranchColorPopoverHost, useBranchColorPopover } from "./BranchColorPopover";

const rules = () => useApp.getState().settings.branchColors;

describe("BranchColorPopover", () => {
  const settings = useApp.getState().settings;
  beforeEach(() => {
    useApp.setState({ settings: { ...settings, branchColors: undefined, branchColorsOff: false } });
    useBranchColorPopover.setState({ open: null });
  });

  it("ajoute en tête une règle au nom exact, puis la met à jour", () => {
    const back = document.createElement("button");
    document.body.append(back);
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "feature/x", back));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("feature/x");
    // Pas de règle à ce nom : « A » (aucune règle) est coché et a le focus ; les couleurs suivent.
    const radios = screen.getAllByRole("radio");
    expect(document.activeElement).toBe(radios[0]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");

    fireEvent.click(radios[4]);
    expect(rules()?.[0]).toEqual({ pattern: "feature/x", color: 3 });
    expect(rules()?.slice(1)).toEqual(DEFAULT_BRANCH_COLORS);
    expect(radios[4].getAttribute("aria-checked")).toBe("true");

    fireEvent.click(radios[6]);
    expect(rules()?.[0]).toEqual({ pattern: "feature/x", color: 5 });
    expect(rules()).toHaveLength(DEFAULT_BRANCH_COLORS.length + 1);

    // Échap ferme et rend le focus à l'élément du clic droit.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(back);
    back.remove();
  });

  it("montre la couleur de la règle exacte existante", () => {
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "develop", null));
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked).toBe(screen.getAllByRole("radio")[6]);
    expect(document.activeElement).toBe(checked);
  });

  it("« A » retire la règle exacte ; Entrée ferme", () => {
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "develop", null));
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(rules()?.some((r) => r.pattern === "develop")).toBe(false);
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("signale le motif qui colore déjà la branche", () => {
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "release/2.0", null));
    expect(screen.getByRole("dialog").textContent).toContain("release/*");
  });

  it("se ferme quand le focus sort", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "x", null));
    fireEvent.blur(screen.getAllByRole("radio")[0], { relatedTarget: outside });
    expect(screen.queryByRole("dialog")).toBeNull();
    outside.remove();
  });

  it("se ferme quand l'écran change (onglet, Réglages)", () => {
    render(<BranchColorPopoverHost />);
    act(() => useBranchColorPopover.getState().show(10, 10, "x", null));
    act(() => useApp.setState({ settingsOpen: !useApp.getState().settingsOpen }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
