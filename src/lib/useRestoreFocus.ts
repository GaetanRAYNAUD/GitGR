import { useEffect, useState } from "react";

/** Fenêtre modale : rend le focus, à la fermeture, à ce qui l'avait avant l'ouverture (le
 *  bouton qui l'a ouverte), s'il est encore dans la page. Lu au premier rendu : un champ
 *  `autoFocus` de la fenêtre prend le focus avant les effets. */
export function useRestoreFocus() {
  const [before] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      // Après le démontage : la fenêtre a quitté la page, le focus tombait sur `body`.
      setTimeout(() => {
        if (before?.isConnected && (document.activeElement === document.body || !document.activeElement)) before.focus();
      }, 0);
    },
    [before],
  );
}
