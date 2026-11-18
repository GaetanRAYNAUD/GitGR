// Fenêtre « Publier sur GitHub / GitLab » : quel dépôt.

import { create } from "zustand";

interface PublishDialogStore {
  /** Dépôt à publier, et numéro de la demande (une nouvelle fenêtre repart d'un état neuf). */
  open: { path: string; id: number } | null;
  show(path: string): void;
  close(): void;
}

let seq = 0;

export const usePublishDialog = create<PublishDialogStore>((set) => ({
  open: null,
  show: (path) => set({ open: { path, id: ++seq } }),
  close: () => set({ open: null }),
}));
