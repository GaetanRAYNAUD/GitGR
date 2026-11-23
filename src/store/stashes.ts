// Pile des stashes d'un dépôt, relue à chaque nouvel état des refs (stash fait, appliqué,
// supprimé, renommé…) et partagée entre la barre latérale, le graphe et la vue d'un stash.

import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import type { RefsInfo, StashEntry } from "../lib/types";
import { useGraph } from "./graph";

interface StashList {
  /** État des refs pour lequel la liste a été lue. */
  refs: RefsInfo | null;
  list: StashEntry[];
  /** La liste est celle de ces refs (sinon : l'ancienne, en attendant la lecture). */
  ready: boolean;
}

interface StashesState {
  lists: Record<string, StashList | undefined>;
  load(path: string, refs: RefsInfo | null): void;
}

const NONE: StashEntry[] = [];

export const useStashes = create<StashesState>((set, get) => ({
  lists: {},
  load: (path, refs) => {
    const cur = get().lists[path];
    if (cur && cur.refs === refs) return;
    const put = (list: StashEntry[]) => set((s) => ({ lists: { ...s.lists, [path]: { refs, list, ready: true } } }));
    if (!refs?.stashes) {
      put(NONE);
      return;
    }
    // Marque la lecture en cours (pas de seconde lecture pour les mêmes refs), en gardant
    // l'ancienne liste affichée en attendant.
    set((s) => ({ lists: { ...s.lists, [path]: { refs, list: cur?.list ?? NONE, ready: false } } }));
    api.listStashes(path).then(
      (list) => {
        if (get().lists[path]?.refs === refs) put(list);
      },
      () => {},
    );
  },
}));

/** Pile des stashes du dépôt (vide tant qu'elle n'a pas été lue). */
export function useStashList(path: string): { list: StashEntry[]; ready: boolean } {
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const entry = useStashes((s) => s.lists[path]);
  const load = useStashes((s) => s.load);
  useEffect(() => {
    if (refs) load(path, refs);
  }, [path, refs, load]);
  return { list: entry?.list ?? NONE, ready: !!entry?.ready && entry.refs === refs };
}
