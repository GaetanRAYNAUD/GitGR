// Garde le focus dans une fenêtre modale : Tab sur le dernier élément revient au premier, et
// Maj+Tab sur le premier va au dernier.

import type { KeyboardEvent } from "react";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Éléments atteignables par Tab dans `root`, dans l'ordre du document. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.closest("[hidden]"));
}

/** À brancher sur `onKeyDown` de la fenêtre. */
export function trapTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const list = tabbables(root);
  if (list.length === 0) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey ? active === first || !root.contains(active) : active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}
