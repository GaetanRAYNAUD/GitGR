// Barre de recherche du graphe (Ctrl+F) : texte cherché par dépôt, gardé en passant à une
// autre vue et en revenant. `undefined` : barre fermée.

import { create } from "zustand";

interface GraphFindState {
  queries: Record<string, string | undefined>;
  /** Ouvre la barre (texte gardé s'il y en avait un). */
  open(path: string): void;
  setQuery(path: string, text: string): void;
  close(path: string): void;
}

export const useGraphFind = create<GraphFindState>((set) => ({
  queries: {},
  open: (path) => set((s) => ({ queries: { ...s.queries, [path]: s.queries[path] ?? "" } })),
  setQuery: (path, text) => set((s) => ({ queries: { ...s.queries, [path]: text } })),
  close: (path) => set((s) => ({ queries: { ...s.queries, [path]: undefined } })),
}));
