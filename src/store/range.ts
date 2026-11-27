// Vues ouvertes à la place du graphe, une de chaque par dépôt : ce qui part au push / arrive
// au pull (badges ↑ / ↓ de la barre d'outils), un stash, le reflog, la recherche dans les
// modifications, l'historique et le blame d'un fichier. Une seule à la fois : en ouvrir une
// ferme les autres (cf. `closeCenterViews`).

import { create } from "zustand";
import type { RangeDirection, StashEntry } from "../lib/types";

/** Ferme toutes les vues ouvertes à la place du graphe pour ce dépôt. */
export function closeCenterViews(path: string) {
  for (const view of [useRangeView, useStashView, useReflogView, useSearchView, useFileHistoryView, useBlameView, useConflictView]) {
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

/** Vue de fichier (historique ou blame) d'où l'on vient : Retour / Échap y ramènent. */
export type FileViewBack = { kind: "history"; file: string } | { kind: "blame"; target: BlameTarget };

/** Pile de retour entre historique et blame, par dépôt. Ouvrir une de ces vues d'ailleurs (menu
 *  d'un fichier) repart d'une pile vide. */
const fileViewBack = new Map<string, FileViewBack[]>();

function openFileView(path: string, view: FileViewBack) {
  if (view.kind === "history") useFileHistoryView.setState((s) => ({ open: { ...s.open, [path]: view.file } }));
  else useBlameView.setState((s) => ({ open: { ...s.open, [path]: view.target } }));
}

/** Retour depuis l'historique ou le blame : la vue d'avant, sinon le graphe. Renvoie `true`
 *  si une vue d'avant a été rouverte. */
export function fileViewGoBack(path: string): boolean {
  const stack = fileViewBack.get(path) ?? [];
  const prev = stack.pop();
  closeCenterViews(path);
  if (!prev) return false;
  fileViewBack.set(path, stack);
  openFileView(path, prev);
  return true;
}

/** La vue d'avant, s'il y en a une (infobulle du bouton Retour). */
export const fileViewPrev = (path: string): FileViewBack | undefined => fileViewBack.get(path)?.slice(-1)[0];

/** Historique d'un fichier ouvert à la place du graphe (chemin relatif au dépôt), un par dépôt. */
interface FileHistoryViewState {
  open: Record<string, string | undefined>;
  /** `from` : la vue qu'on quitte (Retour y ramène) ; sans, la pile de retour repart à zéro. */
  show(path: string, file: string, from?: FileViewBack): void;
  close(path: string): void;
}

export const useFileHistoryView = create<FileHistoryViewState>((set) => ({
  open: {},
  show: (path, file, from) => {
    fileViewBack.set(path, from ? [...(fileViewBack.get(path) ?? []), from] : []);
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
  /** `from` : la vue qu'on quitte (Retour y ramène) ; sans, la pile de retour repart à zéro. */
  show(path: string, target: BlameTarget, from?: FileViewBack): void;
  close(path: string): void;
}

export const useBlameView = create<BlameViewState>((set) => ({
  open: {},
  show: (path, target, from) => {
    fileViewBack.set(path, from ? [...(fileViewBack.get(path) ?? []), from] : []);
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: target } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));

/** Résolution d'un fichier en conflit (chemin relatif au dépôt), ouverte à la place du graphe. */
interface ConflictViewState {
  open: Record<string, string | undefined>;
  show(path: string, file: string): void;
  close(path: string): void;
}

export const useConflictView = create<ConflictViewState>((set) => ({
  open: {},
  show: (path, file) => {
    closeCenterViews(path);
    set((s) => ({ open: { ...s.open, [path]: file } }));
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));
