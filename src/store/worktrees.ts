// Worktrees d'un dépôt, relus à chaque nouvel état des refs ; créer, supprimer, nettoyer,
// ouvrir dans un onglet.

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import { validBranchName } from "../lib/branchName";
import type { RefsInfo, Worktree } from "../lib/types";
import { useApp } from "./app";
import { useDialogs } from "./dialogs";
import { useGraph } from "./graph";

const t = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts);

interface WorktreeList {
  refs: RefsInfo | null;
  list: Worktree[];
}

interface WorktreesState {
  lists: Record<string, WorktreeList | undefined>;
  load(path: string, refs: RefsInfo | null, force?: boolean): void;
  /** Crée un worktree sur la branche locale `branch`, ou sur une nouvelle branche partant de
   *  `start` (commit, branche distante…). Propose d'ouvrir le dossier dans un onglet. */
  create(path: string, from: { branch: string } | { start: string; startLabel: string }): Promise<boolean>;
  remove(path: string, w: Worktree): Promise<boolean>;
  prune(path: string): Promise<boolean>;
  /** Ouvre le worktree dans un onglet (dépôt à part entière). */
  open(w: Worktree): void;
}

const fail = (e: unknown) => {
  useApp.setState({ error: errorCode(e) });
  return false;
};

/** Nom court d'un worktree : sa branche, ou le commit extrait. */
export const worktreeName = (w: Worktree) => w.branch ?? (w.head ? w.head.slice(0, 7) : t("worktrees.noHead"));

export const useWorktrees = create<WorktreesState>((set, get) => ({
  lists: {},
  load(path, refs, force) {
    const cur = get().lists[path];
    if (cur && cur.refs === refs && !force) return;
    set((s) => ({ lists: { ...s.lists, [path]: { refs, list: cur?.list ?? [] } } }));
    api.listWorktrees(path).then(
      (list) => {
        if (get().lists[path]?.refs === refs) set((s) => ({ lists: { ...s.lists, [path]: { refs, list } } }));
      },
      () => {},
    );
  },

  async create(path, from) {
    const refs = useGraph.getState().graphs[path]?.refs ?? null;
    const existing = new Set((refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short));
    const isBranch = "branch" in from;
    const dirFor = (b: string) => api.suggestWorktreeDir(path, b || "worktree").catch(() => "");
    let answer;
    if (isBranch) {
      answer = await useDialogs.getState().input({
        title: t("worktrees.newTitle"),
        subtitle: t("worktrees.onBranch", { branch: from.branch }),
        label: t("worktrees.folder"),
        mono: true,
        initial: await dirFor(from.branch),
        submit: t("worktrees.create"),
        checkbox: { label: t("worktrees.openAfter"), checked: true },
        validate: (v) => (v.trim() ? null : t("worktrees.folderEmpty")),
      });
    } else {
      answer = await useDialogs.getState().input({
        title: t("worktrees.newTitle"),
        subtitle: t("worktrees.fromStart", { start: from.startLabel }),
        label: t("branch.name"),
        mono: true,
        initial: "",
        submit: t("worktrees.create"),
        second: { label: t("worktrees.folder"), initial: await dirFor("worktree"), validate: (v) => (v.trim() ? null : t("worktrees.folderEmpty")) },
        checkbox: { label: t("worktrees.openAfter"), checked: true },
        validate: (v) => (validBranchName(v) ? (existing.has(v) ? t("branch.exists") : null) : t("branch.invalid")),
      });
    }
    if (!answer) return false;
    const dir = (isBranch ? answer.value : (answer.second ?? "")).trim();
    try {
      await api.addWorktree(path, dir, isBranch ? { branch: from.branch } : { newBranch: answer.value, start: from.start });
    } catch (e) {
      return fail(e);
    }
    await useApp.getState().refreshRepo(path);
    get().load(path, useGraph.getState().graphs[path]?.refs ?? null, true);
    useApp.getState().notify(t("worktrees.created", { dir }));
    if (answer.checked) await useApp.getState().openPath(dir);
    return true;
  },

  async remove(path, w) {
    const name = worktreeName(w);
    const sure = await useDialogs.getState().choose({
      title: t("worktrees.removeTitle", { name }),
      body: t("worktrees.removeBody", { dir: w.path }),
      choices: [{ id: "remove", label: t("worktrees.remove"), danger: true }],
    });
    if (sure !== "remove") return false;
    try {
      await api.removeWorktree(path, w.path, false);
    } catch (e) {
      if (errorCode(e) !== "worktree_dirty") return fail(e);
      const force = await useDialogs.getState().choose({
        title: t("worktrees.dirtyTitle", { name }),
        body: t("worktrees.dirtyBody"),
        choices: [{ id: "force", label: t("worktrees.removeAnyway"), danger: true }],
      });
      if (force !== "force") return false;
      try {
        await api.removeWorktree(path, w.path, true);
      } catch (e2) {
        return fail(e2);
      }
    }
    // Onglet ouvert sur ce worktree : il n'a plus de dossier.
    if (useApp.getState().tabs.includes(w.path)) useApp.getState().closeTab(w.path);
    await useApp.getState().refreshRepo(path);
    get().load(path, useGraph.getState().graphs[path]?.refs ?? null, true);
    useApp.getState().notify(t("worktrees.removed", { name }));
    return true;
  },

  async prune(path) {
    try {
      await api.pruneWorktrees(path);
    } catch (e) {
      return fail(e);
    }
    get().load(path, useGraph.getState().graphs[path]?.refs ?? null, true);
    useApp.getState().notify(t("worktrees.pruned"));
    return true;
  },

  open(w) {
    void useApp.getState().openPath(w.path);
  },
}));
