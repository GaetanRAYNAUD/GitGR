// PR / MR ouvertes des remotes d'un dépôt (barre latérale, étiquettes des branches) et PR / MR
// affichée à la place du graphe (vue de suivi : détail, actions).
//
// La liste est lue à l'ouverture du dépôt, relue en arrière-plan quand les refs changent (fetch,
// fetch automatique) au plus toutes les `STALE_SECONDS`, et à la demande.

import { useMemo } from "react";
import { create } from "zustand";
import { closeCenterViews } from "./range";
import { api, errorCode } from "../lib/api";
import { pullTargetOf } from "../lib/pulls";
import type { GitRef, ProviderKind, PullAction, PullDetail, PullList, PullSummary, RefsInfo } from "../lib/types";
import { remoteMarkOf } from "../components/RemoteMark";
import { useGraph } from "./graph";
import { useProfiles } from "./profiles";

/** Au-delà, la liste est relue en arrière-plan (elle reste affichée en attendant). */
export const STALE_SECONDS = 120;

/** Un remote reconnu (GitHub / GitLab) et le compte de son profil. */
export interface PullContext {
  remote: string;
  kind: ProviderKind;
  /** Adresse de l'instance. */
  url: string;
  /** `propriétaire/nom`. */
  repo: string;
  account: string | null;
}

export const pullCtxKey = (c: Pick<PullContext, "kind" | "url" | "repo">) => `${c.kind}|${c.url}|${c.repo.toLowerCase()}`;
const detailKey = (c: PullContext, n: number) => `${pullCtxKey(c)}#${n}`;

/** Login du compte (`<kind>|<url>|<login>`). */
export const accountLogin = (account: string | null) => account?.split("|").pop() ?? null;

export interface ListEntry {
  list: PullList | null;
  loading: boolean;
  error: string | null;
}

export interface DetailEntry {
  detail: PullDetail | null;
  loading: boolean;
  error: string | null;
  /** Action en cours (son type), et la dernière en échec. */
  busy: PullAction["type"] | null;
  actionError: string | null;
}

/** PR / MR montrée dans un dépôt (à la place du graphe). */
export interface OpenPull {
  ctx: PullContext;
  number: number;
}

interface PullListStore {
  lists: Record<string, ListEntry>;
  details: Record<string, DetailEntry>;
  open: Record<string, OpenPull | undefined>;
  ensure(ctx: PullContext, force?: boolean): Promise<void>;
  show(path: string, ctx: PullContext, number: number): void;
  close(path: string): void;
  loadDetail(ctx: PullContext, number: number): Promise<void>;
  /** Lance l'action ; renvoie `true` si elle a réussi (détail et liste relus ensuite). */
  act(ctx: PullContext, number: number, action: PullAction): Promise<boolean>;
}

const inflight = new Set<string>();
/** Dernière lecture en échec, par dépôt distant et compte (millisecondes) : un compte
 *  reconnecté relit tout de suite. */
const failedAt = new Map<string, number>();
/** Numéro de la dernière lecture du détail, par PR / MR. */
const detailSeq = new Map<string, number>();

export const usePullList = create<PullListStore>((set, get) => {
  const patchList = (key: string, p: Partial<ListEntry>) =>
    set((s) => ({ lists: { ...s.lists, [key]: { ...(s.lists[key] ?? { list: null, loading: false, error: null }), ...p } } }));
  const patchDetail = (key: string, p: Partial<DetailEntry>) =>
    set((s) => ({ details: { ...s.details, [key]: { ...(s.details[key] ?? { detail: null, loading: false, error: null, busy: null, actionError: null }), ...p } } }));
  return {
    lists: {},
    details: {},
    open: {},
    async ensure(ctx, force = false) {
      if (!ctx.account) return;
      const key = pullCtxKey(ctx);
      const current = get().lists[key];
      if (inflight.has(key)) return;
      if (!force && current?.list && Date.now() / 1000 - current.list.fetchedAt < STALE_SECONDS) return;
      // Après un échec, pas de nouvel essai d'office avant le délai (le bouton passe outre).
      const failKey = `|${ctx.account}`;
      const failed = failedAt.get(failKey);
      if (!force && failed !== undefined && Date.now() - failed < STALE_SECONDS * 1000) return;
      inflight.add(key);
      patchList(key, { loading: true, error: null });
      try {
        const list = await api.listPulls(ctx.kind, ctx.url, ctx.repo, ctx.account);
        failedAt.delete(failKey);
        patchList(key, { list, loading: false });
      } catch (e) {
        failedAt.set(failKey, Date.now());
        patchList(key, { loading: false, error: errorCode(e) });
      } finally {
        inflight.delete(key);
      }
    },
    show(path, ctx, number) {
      // Une seule vue à la place du graphe.
      closeCenterViews(path);
      set((s) => ({ open: { ...s.open, [path]: { ctx, number } } }));
      void get().loadDetail(ctx, number);
    },
    close(path) {
      set((s) => ({ open: { ...s.open, [path]: undefined } }));
    },
    async loadDetail(ctx, number) {
      const key = detailKey(ctx, number);
      // Une lecture plus récente (après une action) l'emporte sur celle déjà en cours.
      const seq = (detailSeq.get(key) ?? 0) + 1;
      detailSeq.set(key, seq);
      patchDetail(key, { loading: true, error: null });
      try {
        const detail = await api.pullDetail(ctx.kind, ctx.url, ctx.repo, number, ctx.account);
        if (detailSeq.get(key) === seq) patchDetail(key, { detail, loading: false });
      } catch (e) {
        if (detailSeq.get(key) === seq) patchDetail(key, { loading: false, error: errorCode(e) });
      }
    },
    async act(ctx, number, action) {
      const key = detailKey(ctx, number);
      if (get().details[key]?.busy) return false;
      patchDetail(key, { busy: action.type, actionError: null });
      try {
        await api.pullAct(ctx.kind, ctx.url, ctx.repo, number, ctx.account, action);
        patchDetail(key, { busy: null });
        await Promise.all([get().loadDetail(ctx, number), get().ensure(ctx, true)]);
        return true;
      } catch (e) {
        patchDetail(key, { busy: null, actionError: errorCode(e) });
        return false;
      }
    },
  };
});

export function resetPullList() {
  inflight.clear();
  failedAt.clear();
  detailSeq.clear();
  usePullList.setState({ lists: {}, details: {}, open: {} });
}

export const detailEntry = (s: { details: Record<string, DetailEntry> }, ctx: PullContext, n: number) => s.details[detailKey(ctx, n)];

/** Remotes GitHub / GitLab du dépôt (un par dépôt distant : deux remotes vers le même dépôt
 *  n'en font qu'un), avec le compte de leur profil. */
export function usePullContexts(path: string): PullContext[] {
  const remotes = useGraph((s) => s.graphs[path]?.refs?.remotes);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  return useMemo(() => {
    const out: PullContext[] = [];
    for (const r of remotes ?? []) {
      const m = remoteMarkOf(profiles, binding, r);
      if (!m?.url) continue;
      const ctx: PullContext = { remote: r.name, kind: m.provider, url: m.url, repo: m.repo, account: m.account };
      if (!out.some((c) => pullCtxKey(c) === pullCtxKey(ctx))) out.push(ctx);
    }
    return out;
  }, [remotes, profiles, binding]);
}

/** PR / MR ouverte dont la branche source est celle de la ref (même dépôt, pas un fork). */
export function pullOfRef(
  lists: Record<string, ListEntry>,
  contexts: PullContext[],
  refs: RefsInfo | null,
  r: GitRef,
): { ctx: PullContext; pull: PullSummary } | null {
  if (!refs || r.kind === "tag") return null;
  const target = pullTargetOf(refs, r);
  if (!target) return null;
  const ctx = contexts.find((c) => c.remote === target.remote);
  if (!ctx) return null;
  const pull = lists[pullCtxKey(ctx)]?.list?.pulls.find((p) => !p.fork && p.sourceBranch === target.branch);
  return pull ? { ctx, pull } : null;
}

/** Filtres de la section de la barre latérale. */
export type PullFilter = "all" | "mine" | "review";

export function filterPulls(pulls: PullSummary[], filter: PullFilter, me: string | null): PullSummary[] {
  if (filter === "all" || !me) return pulls;
  const is = (login: string | undefined) => !!login && login.toLowerCase() === me.toLowerCase();
  return pulls.filter((p) => (filter === "mine" ? is(p.author?.login) || p.assignees.some((a) => is(a.login)) : p.reviewers.some((x) => is(x.login))));
}
