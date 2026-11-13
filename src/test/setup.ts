import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import i18n from "../i18n";
import { resetStore } from "./utils";

// Langue fixe pour que les tests ne dépendent pas de la machine.
beforeEach(async () => {
  localStorage.clear();
  resetStore();
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
