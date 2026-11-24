// Clavier d'un groupe de boutons radio (motif WAI) : un seul arrêt de tabulation, l'option
// choisie ; les flèches, Début et Fin passent d'une option à l'autre et la choisissent.

import type { KeyboardEvent } from "react";

/** Option visée par une touche, `null` si la touche ne déplace pas la sélection. */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** À brancher sur `onKeyDown` du conteneur `role="radiogroup"`. Un champ (sélecteur de
 *  couleur) prend seulement le focus : le cliquer ouvrirait sa fenêtre. */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')].filter((r) => !(r as HTMLButtonElement).disabled);
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const next = radioKeyTarget(e.key, i, radios.length);
  if (next === null) return;
  e.preventDefault();
  const el = radios[next];
  el.focus();
  if (!(el instanceof HTMLInputElement)) el.click();
}

/** `tabIndex` d'une option : seule l'option choisie (ou la première, si aucune) est atteinte
 *  par Tab. */
export function radioTabIndex(checked: boolean, first: boolean, anyChecked: boolean): 0 | -1 {
  return checked || (first && !anyChecked) ? 0 : -1;
}
