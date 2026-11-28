// Bisect en cours, par dépôt : relu avec le dépôt (refs) et après chaque marque.

import { create } from "zustand";
import { api } from "../lib/api";
import type { BisectState } from "../lib/types";

interface BisectStore {
  /** `null` : aucun bisect ; absent : pas encore lu. */
  states: Record<string, BisectState | null | undefined>;
  load(path: string): Promise<void>;
  set(path: string, state: BisectState | null): void;
}

export const useBisect = create<BisectStore>((set) => ({
  states: {},
  async load(path) {
    try {
      const state = await api.bisectState(path);
      set((s) => ({ states: { ...s.states, [path]: state } }));
    } catch {
      // Dépôt illisible : l'erreur est déjà montrée ailleurs.
    }
  },
  set: (path, state) => set((s) => ({ states: { ...s.states, [path]: state } })),
}));
