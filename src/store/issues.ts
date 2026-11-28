// Issues des remotes GitHub / GitLab : listes (toutes les ouvertes, les miennes), détail d'une
// issue, vue ouverte à la place du graphe. Lues seulement quand la section est affichée.

import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import type { IssueDetail, IssueSummary } from "../lib/types";
import { accountLogin, pullCtxKey, type PullContext, usePullList } from "./pullList";
import { closeCenterViews } from "./range";

/** Une liste est relue au plus toutes les deux minutes (le bouton passe outre). */
const STALE_MS = 120_000;

export type IssueFilter = "all" | "mine";

interface ListEntry {
  list: IssueSummary[] | null;
  loading: boolean;
  error: string | null;
  at: number;
}

interface IssuesState {
  lists: Record<string, ListEntry | undefined>;
  details: Record<string, { detail: IssueDetail | null; error: string | null } | undefined>;
  open: Record<string, { ctx: PullContext; number: number } | undefined>;
  ensure(ctx: PullContext, filter: IssueFilter, force?: boolean): Promise<void>;
  loadDetail(ctx: PullContext, number: number): Promise<void>;
  show(path: string, ctx: PullContext, number: number): void;
  close(path: string): void;
}

export const listKey = (ctx: PullContext, filter: IssueFilter) => `${pullCtxKey(ctx)}|${filter}`;
export const detailKey = (ctx: PullContext, n: number) => `${pullCtxKey(ctx)}#${n}`;
const inflight = new Set<string>();

export const useIssues = create<IssuesState>((set, get) => ({
  lists: {},
  details: {},
  open: {},
  async ensure(ctx, filter, force = false) {
    if (!ctx.account) return;
    const key = listKey(ctx, filter);
    const cur = get().lists[key];
    if (inflight.has(key) || (!force && cur && Date.now() - cur.at < STALE_MS)) return;
    inflight.add(key);
    set((s) => ({ lists: { ...s.lists, [key]: { list: cur?.list ?? null, loading: true, error: null, at: Date.now() } } }));
    try {
      const list = await api.listIssues(ctx.kind, ctx.url, ctx.account, ctx.repo, filter === "mine" ? accountLogin(ctx.account) : null);
      set((s) => ({ lists: { ...s.lists, [key]: { list, loading: false, error: null, at: Date.now() } } }));
    } catch (e) {
      set((s) => ({ lists: { ...s.lists, [key]: { list: cur?.list ?? null, loading: false, error: errorCode(e), at: Date.now() } } }));
    } finally {
      inflight.delete(key);
    }
  },
  async loadDetail(ctx, number) {
    const key = detailKey(ctx, number);
    try {
      const detail = await api.issueDetail(ctx.kind, ctx.url, ctx.account, ctx.repo, number);
      set((s) => ({ details: { ...s.details, [key]: { detail, error: null } } }));
    } catch (e) {
      set((s) => ({ details: { ...s.details, [key]: { detail: s.details[key]?.detail ?? null, error: errorCode(e) } } }));
    }
  },
  show(path, ctx, number) {
    // Une seule vue à la place du graphe (cf. `closeCenterViews`, qui ferme aussi celle-ci).
    closeCenterViews(path);
    usePullList.getState().close(path);
    set((s) => ({ open: { ...s.open, [path]: { ctx, number } } }));
    void get().loadDetail(ctx, number);
  },
  close: (path) => set((s) => (s.open[path] === undefined ? s : { open: { ...s.open, [path]: undefined } })),
}));
