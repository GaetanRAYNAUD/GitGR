// Vue « ce qui part au push / arrive au pull », ouverte à la place du graphe (badges ↑ / ↓
// de la barre d'outils). Une par dépôt.

import { create } from "zustand";
import type { RangeDirection } from "../lib/types";

interface RangeState {
  open: Record<string, RangeDirection | undefined>;
  show(path: string, direction: RangeDirection): void;
  close(path: string): void;
}

export const useRangeView = create<RangeState>((set) => ({
  open: {},
  show: (path, direction) => set((s) => ({ open: { ...s.open, [path]: direction } })),
  close: (path) => set((s) => ({ open: { ...s.open, [path]: undefined } })),
}));
