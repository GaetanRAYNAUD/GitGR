import { useEffect, type RefObject } from "react";

/** Ferme un menu ouvert au clic à l'extérieur de `ref` ou avec Échap.
 *  Échap est consommé : il ne ferme pas aussi ce qui se trouve derrière (diff ouvert…). */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
  }, [ref, open, close]);
}
