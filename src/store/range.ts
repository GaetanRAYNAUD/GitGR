// Vues ouvertes à la place du graphe, une de chaque par dépôt : ce qui part au push / arrive
// au pull (badges ↑ / ↓ de la barre d'outils), un stash, le reflog, la recherche dans les
// modifications, l'historique et le blame d'un fichier. Une seule à la fois : en ouvrir une
// ferme les autres (cf. `closeCenterViews`).

import { create } from "zustand";
import type { RangeDirection, StashEntry } from "../lib/types";

/** Ferme toutes les vues ouvertes à la place du graphe pour ce dépôt. */
export function closeCenterViews(path: string) {
  for (const view of [useRangeView, useStashView, useReflogView, useSearchView, useFileHistoryView, useBlameView]) {
    view.getState().close(path);
  }
}

interface RangeState {
  open: Record<string, RangeDirection | undefined>;
  show(path: string, direction: RangeDirection): void;
  close(path: string): void;
}

export const useRangeView = create<RangeState>((set) => ({
  open: {},
  show: (path, direction) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: direction } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));

/** Stash ouvert à la place du graphe, un par dépôt. */
interface StashViewState {
  open: Record<string, StashEntry | undefined>;
  show(path: string, entry: StashEntry): void;
  close(path: string): void;
}

export const useStashView = create<StashViewState>((set) => ({
  open: {},
  show: (path, entry) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: entry } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));

/** Reflog ouvert à la place du graphe (`HEAD` ou une branche locale), un par dépôt. */
interface ReflogViewState {
  open: Record<string, string | undefined>;
  show(path: string, refname: string): void;
  close(path: string): void;
}

export const useReflogView = create<ReflogViewState>((set) => ({
  open: {},
  show: (path, refname) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: refname } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));

/** Recherche dans les modifications : la dernière demande, gardée en revenant au graphe. */
export interface ContentQuery {
  text: string;
  regex: boolean;
  file: string;
}

/** Recherche dans les modifications ouverte à la place du graphe, une par dépôt. */
interface SearchViewState {
  open: Record<string, boolean | undefined>;
  queries: Record<string, ContentQuery | undefined>;
  show(path: string): void;
  close(path: string): void;
  setQuery(path: string, q: ContentQuery): void;
}

export const useSearchView = create<SearchViewState>((set) => ({
  open: {},
  queries: {},
  show: (path) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: true } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
  setQuery: (path, q) => set((s) => ({ queries: { ...s.queries, [path]: q } })),
}));

/** Historique d'un fichier ouvert à la place du graphe (chemin relatif au dépôt), un par dépôt. */
interface FileHistoryViewState {
  open: Record<string, string | undefined>;
  show(path: string, file: string): void;
  close(path: string): void;
}

export const useFileHistoryView = create<FileHistoryViewState>((set) => ({
  open: {},
  show: (path, file) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: file } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));

/** Blame d'un fichier : à un commit (`rev`), ou sur la copie de travail si `rev` est nul. */
export interface BlameTarget {
  file: string;
  rev: string | null;
  /** Chemin dont montrer l'historique (le chemin actuel, quand `file` est un ancien nom). */
  historyFile?: string;
}

/** Blame ouvert à la place du graphe, un par dépôt. */
interface BlameViewState {
  open: Record<string, BlameTarget | undefined>;
  show(path: string, target: BlameTarget): void;
  close(path: string): void;
}

export const useBlameView = create<BlameViewState>((set) => ({
  open: {},
  show: (path, target) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: target } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));
