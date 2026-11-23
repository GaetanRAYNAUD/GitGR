// Piles d'annulation / rétablissement par dépôt (en mémoire, pour la session). Remplies par
// `store/ops.ts` et le commit (`store/worktree.ts`) ; rejouées par `useOps.undo / redo`.

import { create } from "zustand";
import type { UndoEntry } from "../lib/undo";

/** Opérations gardées par dépôt. */
const LIMIT = 50;

interface Stacks {
  undo: UndoEntry[];
  redo: UndoEntry[];
}

interface UndoStore {
  stacks: Record<string, Stacks | undefined>;
  /** Nouvelle opération : en haut de la pile d'annulation ; plus rien à rétablir. */
  record(path: string, entry: UndoEntry): void;
  /** Opération annulée (`undo`) ou rétablie (`redo`) : passe dans l'autre pile. */
  moved(path: string, dir: "undo" | "redo"): void;
  /** Le dépôt a changé autrement : plus rien d'annulable. */
  clear(path: string): void;
}

const empty: Stacks = { undo: [], redo: [] };

export const useUndo = create<UndoStore>((set) => ({
  stacks: {},
  record: (path, entry) =>
    set((s) => ({ stacks: { ...s.stacks, [path]: { undo: [...(s.stacks[path]?.undo ?? []), entry].slice(-LIMIT), redo: [] } } })),
  moved: (path, dir) =>
    set((s) => {
      const { undo, redo } = s.stacks[path] ?? empty;
      const [from, to] = dir === "undo" ? [undo, redo] : [redo, undo];
      const entry = from[from.length - 1];
      if (!entry) return s;
      const rest = from.slice(0, -1);
      const next = [...to, entry];
      return { stacks: { ...s.stacks, [path]: dir === "undo" ? { undo: rest, redo: next } : { undo: next, redo: rest } } };
    }),
  clear: (path) => set((s) => ({ stacks: { ...s.stacks, [path]: empty } })),
}));

/** Prochaine opération à annuler (`undo`) ou à rétablir (`redo`). */
export function nextEntry(path: string, dir: "undo" | "redo"): UndoEntry | undefined {
  const st = useUndo.getState().stacks[path];
  const list = dir === "undo" ? st?.undo : st?.redo;
  return list?.[list.length - 1];
}
