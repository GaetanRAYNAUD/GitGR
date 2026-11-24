// Barre de recherche du graphe : texte cherché par dépôt (Ctrl+F), ou liste de commits venue
// d'ailleurs (résultats de la recherche dans les modifications) ; gardée en passant à une
// autre vue et en revenant. Rien des deux : barre fermée.

import { create } from "zustand";

/** Commits à mettre en évidence, avec ce qui les a trouvés (affiché dans la barre). */
export interface FoundSet {
  label: string;
  shas: string[];
}

interface GraphFindState {
  queries: Record<string, string | undefined>;
  sets: Record<string, FoundSet | undefined>;
  /** Ouvre la barre en mode texte (texte gardé s'il y en avait un ; une liste est oubliée). */
  open(path: string): void;
  setQuery(path: string, text: string): void;
  /** Met en évidence ces commits (remplace la recherche par texte). */
  showSet(path: string, set: FoundSet): void;
  close(path: string): void;
}

export const useGraphFind = create<GraphFindState>((set) => ({
  queries: {},
  sets: {},
  open: (path) => set((s) => ({ queries: { ...s.queries, [path]: s.queries[path] ?? "" }, sets: { ...s.sets, [path]: undefined } })),
  setQuery: (path, text) => set((s) => ({ queries: { ...s.queries, [path]: text } })),
  showSet: (path, found) => set((s) => ({ sets: { ...s.sets, [path]: found }, queries: { ...s.queries, [path]: undefined } })),
  close: (path) => set((s) => ({ queries: { ...s.queries, [path]: undefined }, sets: { ...s.sets, [path]: undefined } })),
}));
