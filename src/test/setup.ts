import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import i18n from "../i18n";
import { resetMockHistory } from "../lib/mockHistory";
import { resetMockWorktree } from "../lib/mockWorktree";
import { resetStore } from "./utils";

// Langue fixe pour que les tests ne dépendent pas de la machine.
beforeEach(async () => {
  localStorage.clear();
  resetStore();
  resetMockHistory();
  resetMockWorktree();
  await i18n.changeLanguage("fr");
});

afterEach(() => cleanup());

// jsdom n'implémente pas matchMedia (utilisé par le thème).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom n'implémente pas ResizeObserver (utilisé par la liste virtualisée du graphe).
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Ni canvas dans jsdom : le graphe ne dessine rien (et jsdom ne doit pas s'en plaindre).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
