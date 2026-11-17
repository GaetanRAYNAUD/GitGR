// Personnes (assignés, relecteurs) et étiquettes proposées pour une PR / MR, par dépôt.
//
// Lire la liste d'une grosse organisation peut prendre plusieurs secondes : on n'attend jamais.
// 1. Ce qui est en cache sur disque s'affiche tout de suite (src-tauri/src/pulls.rs) — et pour un
//    dépôt pas encore lu, la réunion des listes des autres dépôts du même propriétaire : dans une
//    organisation, ce sont les mêmes personnes d'un dépôt à l'autre.
// 2. La liste est relue en arrière-plan si elle est vieille de plus de `STALE` (ou empruntée).
// 3. Elle est préchargée dès qu'un dépôt est ouvert (RepoView), pas à l'ouverture de la fenêtre.

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import type { Person, ProviderKind, PullOptions } from "../lib/types";

/** Au-delà, la liste est relue en arrière-plan (elle reste affichée en attendant). */
export const STALE_SECONDS = 6 * 3600;

export interface OptionsContext {
  kind: ProviderKind;
  /** Adresse de l'instance. */
  url: string;
  /** `propriétaire/nom`. */
  repo: string;
  account: string | null;
}

export interface OptionsEntry {
  options: PullOptions | null;
  loading: boolean;
  error: string | null;
}

/** Derniers choix faits pour un propriétaire (la session) : les PR des dépôts d'un même projet
 *  vont souvent aux mêmes personnes. */
export interface LastChoice {
  assignees: Person[];
  reviewers: Person[];
  labels: string[];
}

interface PullOptionsStore {
  entries: Record<string, OptionsEntry>;
  last: Record<string, LastChoice>;
  /** Montre le cache, puis relit si besoin (`force` : toujours). Sans effet si une lecture est en cours. */
  ensure(ctx: OptionsContext, force?: boolean): Promise<void>;
  remember(ctx: OptionsContext, choice: LastChoice): void;
}

export const optionsKey = (c: Pick<OptionsContext, "kind" | "url" | "repo">) => `${c.kind}|${c.url}|${c.repo.toLowerCase()}`;
export const ownerKey = (c: Pick<OptionsContext, "kind" | "url" | "repo">) => `${c.kind}|${c.url}|${c.repo.toLowerCase().split("/").slice(0, -1).join("/")}`;

const inflight = new Set<string>();

/** La liste doit-elle être relue ? */
export function isStale(options: PullOptions | null, nowSeconds: number): boolean {
  return !options || options.fromOwner || nowSeconds - options.fetchedAt > STALE_SECONDS;
}

export const usePullOptions = create<PullOptionsStore>((set, get) => {
  const patch = (key: string, p: Partial<OptionsEntry>) =>
    set((s) => ({ entries: { ...s.entries, [key]: { ...(s.entries[key] ?? { options: null, loading: false, error: null }), ...p } } }));
  return {
    entries: {},
    last: {},
    async ensure(ctx, force = false) {
      const key = optionsKey(ctx);
      if (inflight.has(key)) return;
      inflight.add(key);
      try {
        if (!get().entries[key]?.options) {
          const cached = await api.cachedPullOptions(ctx.kind, ctx.url, ctx.repo).catch(() => null);
          // Une lecture terminée entre-temps l'emporte.
          if (cached && !get().entries[key]?.options) patch(key, { options: cached });
        }
        if (!ctx.account || (!force && !isStale(get().entries[key]?.options ?? null, Date.now() / 1000))) return;
        patch(key, { loading: true, error: null });
        try {
          const options = await api.refreshPullOptions(ctx.kind, ctx.url, ctx.repo, ctx.account);
          patch(key, { options, loading: false });
        } catch (e) {
          // La liste en cache reste affichée.
          patch(key, { loading: false, error: errorCode(e) });
        }
      } finally {
        inflight.delete(key);
      }
    },
    remember(ctx, choice) {
      set((s) => ({ last: { ...s.last, [ownerKey(ctx)]: choice } }));
    },
  };
});

/** Le cache entre les tests. */
export function resetPullOptions() {
  inflight.clear();
  usePullOptions.setState({ entries: {}, last: {} });
}
