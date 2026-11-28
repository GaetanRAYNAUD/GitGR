// Barre de recherche du graphe : texte cherché par dépôt (Ctrl+F), ou liste de commits venue
// d'ailleurs (résultats de la recherche dans les modifications) ; gardée en passant à une
// autre vue et en revenant. Ou un filtre par auteurs (e-mails). Rien de tout ça : barre fermée.

import { create } from "zustand";

/** Commits à mettre en évidence, avec ce qui les a trouvés (affiché dans la barre). */
export interface FoundSet {
  label: string;
  shas: string[];
}

interface GraphFindState {
  queries: Record<string, string | undefined>;
  sets: Record<string, FoundSet | undefined>;
  /** Filtre par auteurs : e-mails choisis (liste vide : choix en cours, rien de filtré). */
  authors: Record<string, string[] | undefined>;
  /** Ouvre la barre en mode texte (texte gardé s'il y en avait un ; une liste est oubliée). */
  open(path: string): void;
  setQuery(path: string, text: string): void;
  /** Met en évidence ces commits (remplace la recherche par texte). */
  showSet(path: string, set: FoundSet): void;
  /** Passe la barre en filtre par auteurs (remplace le texte et la liste). */
  showAuthors(path: string, emails: string[]): void;
  close(path: string): void;
}

export const useGraphFind = create<GraphFindState>((set) => ({
  queries: {},
  sets: {},
  authors: {},
  open: (path) =>
    set((s) => ({ queries: { ...s.queries, [path]: s.queries[path] ?? "" }, sets: { ...s.sets, [path]: undefined }, authors: { ...s.authors, [path]: undefined } })),
  setQuery: (path, text) => set((s) => ({ queries: { ...s.queries, [path]: text } })),
  showSet: (path, found) =>
    set((s) => ({ sets: { ...s.sets, [path]: found }, queries: { ...s.queries, [path]: undefined }, authors: { ...s.authors, [path]: undefined } })),
  showAuthors: (path, emails) =>
    set((s) => ({ authors: { ...s.authors, [path]: emails }, queries: { ...s.queries, [path]: undefined }, sets: { ...s.sets, [path]: undefined } })),
  close: (path) =>
    set((s) => ({ queries: { ...s.queries, [path]: undefined }, sets: { ...s.sets, [path]: undefined }, authors: { ...s.authors, [path]: undefined } })),
}));
