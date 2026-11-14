import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { ResizableBlock, Splitter } from "./Splitter";

const s = () => useApp.getState();

describe("<Splitter />", () => {
  it("glisser : tailles intermédiaires, puis taille finale au relâcher", () => {
    const onChange = vi.fn();
    render(<Splitter dir="x" label="Largeur" measure={() => 200} onChange={onChange} onReset={() => {}} />);
    const handle = screen.getByRole("separator", { name: "Largeur" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 130, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(230, false);
    expect(document.body).toHaveClass("resizing-x");
    fireEvent.pointerUp(window, { clientX: 130, clientY: 0 });
    expect(onChange).toHaveBeenLastCalledWith(230, true);
    expect(document.body).not.toHaveClass("resizing-x");
  });

  it("sens inversé (panneau de droite) et flèches du clavier", () => {
    const onChange = vi.fn();
    render(<Splitter dir="x" label="Panneau" measure={() => 300} sign={-1} onChange={onChange} onReset={() => {}} />);
    const handle = screen.getByRole("separator", { name: "Panneau" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(316, true);
    fireEvent.keyDown(handle, { key: "ArrowUp" }); // sans effet sur une barre verticale
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("un simple clic sans mouvement n'enregistre rien ; double-clic = taille par défaut", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<Splitter dir="y" label="Hauteur" measure={() => 80} onChange={onChange} onReset={onReset} />);
    const handle = screen.getByRole("separator", { name: "Hauteur" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 10 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalled();
  });
});

describe("<ResizableBlock />", () => {
  it("hauteur naturelle par défaut, puis hauteur choisie (bornée) et enregistrée", () => {
    const save = vi.spyOn(api, "setSettings");
    render(
      <ResizableBlock layoutKey="h:test" label="Section">
        <p>contenu</p>
      </ResizableBlock>,
    );
    const block = screen.getByText("contenu").parentElement!;
    expect(block).not.toHaveClass("sized");

    fireEvent.keyDown(screen.getByRole("separator", { name: "Section" }), { key: "ArrowDown" });
    // jsdom ne mesure rien (0 px) : 0 + 16, ramené au minimum.
    expect(s().settings.layout?.["h:test"]).toBe(48);
    expect(block).toHaveClass("sized");
    expect(block.style.height).toBe("48px");
    expect(save).toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByRole("separator", { name: "Section" }));
    expect(s().settings.layout?.["h:test"]).toBeUndefined();
    expect(block).not.toHaveClass("sized");
  });
});

describe("store : setLayout", () => {
  it("n'écrit l'état qu'à la fin d'un glisser", () => {
    const save = vi.spyOn(api, "setSettings");
    s().setLayout({ sidebar: 300.1234 }, false);
    expect(s().settings.layout).toEqual({ sidebar: 300.123 });
    expect(save).not.toHaveBeenCalled();
    s().setLayout({ sidebar: 310 });
    expect(save).toHaveBeenCalledTimes(1);
    s().setLayout({ sidebar: null });
    expect(s().settings.layout).toEqual({});
  });
});

describe("bornes", () => {
  it("setLayout ignore une taille non finie", () => {
    s().setLayout({ sidebar: Number.NaN });
    expect(s().settings.layout).toEqual({});
  });

  it("diffSplitBounds garde de la place aux deux côtés et aux numéros", async () => {
    const { diffSplitBounds } = await import("../lib/layout");
    expect(diffSplitBounds(1000)).toEqual([0.15, 0.836]);
    const [lo, hi] = diffSplitBounds(400);
    expect(lo * 400).toBe(60);
    expect(hi * 400 + 2 * 52).toBeCloseTo(400 - 60);
    expect(diffSplitBounds(100)[0]).toBe(diffSplitBounds(100)[1]);
  });
});
