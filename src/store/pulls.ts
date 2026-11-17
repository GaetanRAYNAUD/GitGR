// Fenêtre « Créer une PR / MR » : quel dépôt, et la cible choisie au clic droit (s'il y en a une).

import { create } from "zustand";
import type { PullTarget } from "../lib/pulls";

export interface PullDialogRequest {
  path: string;
  /** Cible choisie au clic droit sur une autre branche ; absente : branche par défaut du dépôt. */
  target?: PullTarget;
  /** Numéro de la demande : une nouvelle fenêtre repart d'un état neuf. */
  id: number;
}

interface PullDialogStore {
  open: PullDialogRequest | null;
  show(path: string, target?: PullTarget): void;
  close(): void;
}

let seq = 0;

export const usePullDialog = create<PullDialogStore>((set) => ({
  open: null,
  show: (path, target) => set({ open: { path, target, id: ++seq } }),
  close: () => set({ open: null }),
}));
