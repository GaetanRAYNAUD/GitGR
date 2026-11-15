// Branches et réseau : checkout (avec auto-stash), création / renommage / suppression de
// branches, fetch, pull, push, stash / pop, et opérations en cours (merge, rebase…).
//
// Les commandes git d'un même dépôt passent une par une (file d'attente par dépôt) ; les
// questions à l'utilisateur (confirmation, nom de branche) sont posées en dehors de la file.
// Après chaque commande, tout le dépôt est relu (résumé, graphe, copie de travail).

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import { AUTOSTASH_PREFIX, validBranchName } from "../lib/branchName";
import type { OpResult, PullStrategy } from "../lib/types";
import { useApp } from "./app";
import { useDialogs } from "./dialogs";
import { useGraph, WIP } from "./graph";
import { useProfiles } from "./profiles";
import { useWork } from "./worktree";

export type OpName = "checkout" | "branch" | "fetch" | "pull" | "push" | "stash" | "pop" | "operation";

export { AUTOSTASH_PREFIX };

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface OpsStore {
  /** Commande en cours par dépôt. */
  running: Record<string, OpName | undefined>;

  checkout(path: string, branch: string): Promise<boolean>;
  /** Branche distante (`origin/x`) : passe sur la locale qui la suit, créée au besoin. */
  checkoutRemote(path: string, branch: string): Promise<boolean>;
  checkoutDetached(path: string, sha: string): Promise<boolean>;
  /** Demande un nom puis crée la branche sur `start` (HEAD si `null`) ; `startLabel` est affiché. */
  newBranch(path: string, start: string | null, startLabel: string): Promise<boolean>;
  renameBranch(path: string, branch: string): Promise<boolean>;
  deleteBranch(path: string, branch: string): Promise<boolean>;
  deleteRemoteBranch(path: string, branch: string): Promise<boolean>;
  /** `silent` (fetch automatique) : ni erreur ni message, et rien si une commande tourne déjà. */
  fetch(path: string, silent?: boolean): Promise<boolean>;
  /** `strategy` absente : celle des réglages. */
  pull(path: string, strategy?: PullStrategy): Promise<boolean>;
  push(path: string, force?: boolean): Promise<boolean>;
  stash(path: string): Promise<boolean>;
  pop(path: string): Promise<boolean>;
  abortOperation(path: string): Promise<boolean>;
  continueOperation(path: string): Promise<boolean>;
}

const t = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts);

/** File d'attente par dépôt. */
const queues: Record<string, Promise<unknown>> = {};

const settings = () => useApp.getState().settings;
const autoStash = () => settings().autoStash ?? true;
const currentBranch = (path: string) =>
  useGraph.getState().graphs[path]?.refs?.headBranch ?? useApp.getState().summaries[path]?.data?.branch ?? null;

/** Message d'information (auto-stash gardé, conflits…), affiché par l'app. */
function notify(text: string, sticky = false) {
  useApp.getState().notify(text, sticky);
}

/** Conséquences d'une commande passée par l'auto-stash : stash gardé, conflits. */
function report(r: OpResult, label: string) {
  // Arrêté sur des conflits avec un auto-stash : les deux messages, sinon les modifications
  // mises de côté passeraient inaperçues.
  const parts = [
    r.conflicts && t("notice.conflicts"),
    r.stashKept && t("notice.stashKept", { label: AUTOSTASH_PREFIX + label }),
  ].filter(Boolean);
  if (parts.length) notify(parts.join(" "), true);
}

/** Après un changement de HEAD sans modifications en cours : le nouveau commit courant est sélectionné. */
async function selectHead(path: string) {
  const g = useGraph.getState();
  const head = g.graphs[path]?.refs?.head;
  const changes = useWork.getState().repos[path]?.status;
  const dirty = !!changes && changes.staged.length + changes.unstaged.length + changes.conflicted.length > 0;
  if (head && !dirty) await g.reveal(path, head);
}

const nameError = (name: string) => (validBranchName(name) ? null : t("branch.invalid"));

export const useOps = create<OpsStore>((set, get) => {
  /** Lance `fn` à son tour dans la file du dépôt, puis relit le dépôt. */
  const exec = <T>(path: string, name: OpName, fn: () => Promise<T>): Promise<Outcome<T>> => {
    const run = async (): Promise<Outcome<T>> => {
      set((s) => ({ running: { ...s.running, [path]: name } }));
      let out: Outcome<T>;
      try {
        out = { ok: true, value: await fn() };
      } catch (e) {
        out = { ok: false, error: errorCode(e) };
      }
      try {
        await useApp.getState().refreshRepo(path);
      } finally {
        set((s) => ({ running: { ...s.running, [path]: undefined } }));
      }
      return out;
    };
    const next = (queues[path] ?? Promise.resolve()).then(run, run);
    queues[path] = next.catch(() => {});
    return next;
  };

  const fail = (error: string) => {
    useApp.setState({ error });
    return false;
  };

  /** Checkout générique : auto-stash, compte rendu, sélection du nouveau HEAD. */
  const switchTo = async (path: string, call: (stash: boolean) => Promise<OpResult>) => {
    const label = currentBranch(path) ?? "HEAD";
    const out = await exec(path, "checkout", () => call(autoStash()));
    if (!out.ok) return fail(out.error);
    report(out.value, label);
    await selectHead(path);
    return true;
  };

  return {
    running: {},

    checkout: (path, branch) => switchTo(path, (stash) => api.checkout(path, branch, stash)),

    checkoutRemote: (path, branch) =>
      switchTo(path, async (stash) => (await api.checkoutRemote(path, branch, stash))[0]),

    checkoutDetached: (path, sha) => switchTo(path, (stash) => api.checkoutDetached(path, sha, stash)),

    async newBranch(path, start, startLabel) {
      const existing = new Set(
        (useGraph.getState().graphs[path]?.refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short),
      );
      const answer = await useDialogs.getState().input({
        title: t("branch.newTitle"),
        subtitle: t("branch.newFrom", { start: startLabel }),
        label: t("branch.name"),
        initial: "",
        submit: t("branch.create"),
        checkbox: { label: t("branch.checkout"), checked: true },
        validate: (v) => nameError(v) ?? (existing.has(v) ? t("branch.exists") : null),
      });
      if (!answer) return false;
      const label = currentBranch(path) ?? "HEAD";
      const out = await exec(path, "branch", () => api.createBranch(path, answer.value, start, answer.checked, autoStash()));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (answer.checked) await selectHead(path);
      return true;
    },

    async renameBranch(path, branch) {
      const answer = await useDialogs.getState().input({
        title: t("branch.renameTitle", { branch }),
        label: t("branch.name"),
        initial: branch,
        submit: t("branch.rename"),
        validate: nameError,
      });
      if (!answer || answer.value === branch) return false;
      const out = await exec(path, "branch", () => api.renameBranch(path, branch, answer.value));
      return out.ok || fail(out.error);
    },

    async deleteBranch(path, branch) {
      const dialogs = useDialogs.getState();
      const ok = await dialogs.choose({
        title: t("branch.deleteTitle", { branch }),
        body: t("branch.deleteBody"),
        choices: [{ id: "delete", label: t("branch.delete"), danger: true }],
      });
      if (!ok) return false;
      let out = await exec(path, "branch", () => api.deleteBranch(path, branch, false));
      if (!out.ok && out.error === "branch_not_merged") {
        const force = await dialogs.choose({
          title: t("branch.notMergedTitle", { branch }),
          body: t("branch.notMergedBody"),
          choices: [{ id: "force", label: t("branch.forceDelete"), danger: true }],
        });
        if (!force) return false;
        out = await exec(path, "branch", () => api.deleteBranch(path, branch, true));
      }
      return out.ok || fail(out.error);
    },

    async deleteRemoteBranch(path, branch) {
      const ok = await useDialogs.getState().choose({
        title: t("branch.deleteRemoteTitle", { branch }),
        body: t("branch.deleteRemoteBody"),
        choices: [{ id: "delete", label: t("branch.deleteRemote"), danger: true }],
      });
      if (!ok) return false;
      const out = await exec(path, "push", () => api.deleteRemoteBranch(path, branch));
      return out.ok || fail(out.error);
    },

    async fetch(path, silent = false) {
      if (silent && get().running[path]) return false;
      const out = await exec(path, "fetch", () => api.fetch(path));
      if (silent) return out.ok;
      if (!out.ok) return fail(out.error);
      notify(t("notice.fetched"));
      return true;
    },

    async pull(path, strategy) {
      const mode = strategy ?? settings().pullStrategy ?? "ff-only";
      const branch = currentBranch(path) ?? "HEAD";
      const out = await exec(path, "pull", () => api.pull(path, mode, autoStash()));
      if (!out.ok && out.error === "not_fast_forward") {
        const pick = await useDialogs.getState().choose({
          title: t("pull.divergedTitle"),
          body: t("pull.divergedBody", { branch }),
          choices: [
            { id: "merge", label: t("pull.merge") },
            { id: "rebase", label: t("pull.rebase") },
          ],
        });
        return pick ? get().pull(path, pick as PullStrategy) : false;
      }
      if (!out.ok) return fail(out.error);
      report(out.value, branch);
      return true;
    },

    async push(path, force = false) {
      // Garde-fou : profil actif qui ne correspond pas au remote (une seule fois par session).
      if (!force && !(await useProfiles.getState().confirmIdentity(path))) return false;
      const out = await exec(path, "push", () => api.push(path, force));
      if (!out.ok && out.error === "push_rejected" && !force) {
        const pick = await useDialogs.getState().choose({
          title: t("push.rejectedTitle"),
          body: t("push.rejectedBody"),
          choices: [
            { id: "force", label: t("push.force"), danger: true },
            { id: "pull", label: t("push.pullFirst") },
          ],
        });
        if (pick === "pull") return get().pull(path);
        return pick === "force" ? get().push(path, true) : false;
      }
      if (!out.ok) return fail(out.error);
      // Lu après le push : le dépôt vient d'être relu (au démarrage, il pouvait ne pas l'être encore).
      notify(t("notice.pushed", { branch: currentBranch(path) ?? "HEAD" }));
      return true;
    },

    async stash(path) {
      const message = t("repo.stashMessage", { branch: currentBranch(path) ?? "HEAD" });
      const out = await exec(path, "stash", () => api.stashAll(path, message));
      return out.ok || fail(out.error);
    },

    async pop(path) {
      const out = await exec(path, "pop", () => api.stashPop(path));
      if (!out.ok) return fail(out.error);
      if (out.value.stashKept) notify(t("notice.popConflict"), true);
      // Les modifications réappliquées sont ce qu'on veut voir.
      useGraph.getState().select(path, WIP);
      return true;
    },

    async abortOperation(path) {
      const ok = await useDialogs.getState().choose({
        title: t("op.abortTitle"),
        body: t("op.abortBody"),
        choices: [{ id: "abort", label: t("op.abort"), danger: true }],
      });
      if (!ok) return false;
      const out = await exec(path, "operation", () => api.abortOperation(path));
      return out.ok || fail(out.error);
    },

    async continueOperation(path) {
      const out = await exec(path, "operation", () => api.continueOperation(path));
      if (!out.ok) return fail(out.error);
      report(out.value, currentBranch(path) ?? "HEAD");
      return true;
    },
  };
});
