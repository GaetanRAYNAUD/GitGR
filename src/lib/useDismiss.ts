import { useEffect, type RefObject } from "react";

/** Ferme un menu ouvert au clic à l'extérieur de `ref` ou avec Échap.
 *  Échap est consommé : il ne ferme pas aussi ce qui se trouve derrière (diff ouvert…).
 *  Un menu contextuel ouvert par-dessus (choix dans une fenêtre) passe d'abord : tant qu'il est
 *  là, clic et Échap ne ferment que lui. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, outside: () => void = close) {
  useEffect(() => {
    if (!open) return;
    /** Un menu contextuel est ouvert, et ce n'est pas `ref` (ni ce qu'il contient). */
    const menuAbove = () => {
      const menu = document.querySelector(".context-menu");
      return !!menu && !!ref.current && !menu.contains(ref.current) && !ref.current.contains(menu);
    };
    const onDown = (e: MouseEvent) => {
      if (menuAbove()) return;
      if (ref.current && !ref.current.contains(e.target as Node)) outside();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || menuAbove()) return;
      // Les écouteurs de `document` passent avant ceux de `window` (DiffView).
      e.stopPropagation();
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close, outside]);
}
