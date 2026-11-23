// Vue « ce qui part au push / arrive au pull », ouverte à la place du graphe (badges ↑ / ↓
// de la barre d'outils). Une par dépôt.

import { create } from "zustand";
import type { RangeDirection, StashEntry } from "../lib/types";

interface RangeState {
  open: Record<string, RangeDirection | undefined>;
  show(path: string, direction: RangeDirection): void;
  close(path: string): void;
}

export const useRangeView = create<RangeState>((set) => ({
  open: {},
  show: (path, direction) => {
    useStashView.getState().close(path);
    set((s) => ({ open: { ...s.open, [path]: direction } }));
  },
  close: (path) => set((s) => ({ open: { ...s.open, [path]: undefined } })),
}));

/** Stash ouvert à la place du graphe, un par dépôt. */
interface StashViewState {
  open: Record<string, StashEntry | undefined>;
  show(path: string, entry: StashEntry): void;
  close(path: string): void;
}

export const useStashView = create<StashViewState>((set) => ({
  open: {},
  show: (path, entry) => set((s) => ({ open: { ...s.open, [path]: entry } })),
  close: (path) => set((s) => ({ open: { ...s.open, [path]: undefined } })),
}));
