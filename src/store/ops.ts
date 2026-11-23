// Branches et réseau : checkout (avec auto-stash), création / renommage / suppression de
// branches, fetch, pull, push, stash / pop, et opérations en cours (merge, rebase…).
//
// Fetch lit tous les remotes ; push et pull peuvent viser un remote choisi (« Pousser vers… »,
// « Pousser vers tous les remotes », « Tirer depuis… »), chacun avec la clé de son profil.
//
// Les commandes git d'un même dépôt passent une par une (file d'attente par dépôt) ; les
// questions à l'utilisateur (confirmation, nom de branche) sont posées en dehors de la file.
// Après chaque commande, tout le dépôt est relu (résumé, graphe, copie de travail).

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import { AUTOSTASH_PREFIX, validBranchName, validRemoteName } from "../lib/branchName";
import { errorMessage } from "../lib/errors";
import { remoteProfile } from "../lib/profiles";
import { splitRemoteBranch } from "../lib/refs";
import type { OpResult, ProviderKind, PullStrategy } from "../lib/types";
import { useApp } from "./app";
import { useDialogs } from "./dialogs";
import { useGraph, WIP } from "./graph";
import { useProfiles } from "./profiles";
import { useWork } from "./worktree";

export type OpName = "checkout" | "branch" | "fetch" | "pull" | "push" | "stash" | "pop" | "operation" | "remote";

export { AUTOSTASH_PREFIX };

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface OpsStore {
  /** Commande en cours par dépôt. */
  running: Record<string, OpName | undefined>;

  checkout(path: string, branch: string): Promise<boolean>;
  /** Cherry-pick des commits donnés (du plus ancien au plus récent) sur la branche courante. */
  cherryPick(path: string, shas: string[]): Promise<boolean>;
  /** Branche distante (`origin/x`) : passe sur la locale du même nom, créée au besoin (elle suit
   *  alors la distante). Une locale qui existait déjà est ensuite mise à jour depuis la distante,
   *  comme le bouton Pull (même stratégie, auto-stash, arrêt sur les conflits). */
  checkoutRemote(path: string, branch: string): Promise<boolean>;
  checkoutDetached(path: string, sha: string): Promise<boolean>;
  /** Branche d'une PR / MR : la distante (même dépôt) ou `pr/<n>` / `mr/<n>` (fork). */
  checkoutPull(path: string, remote: string, kind: ProviderKind, number: number, branch: string, fork: boolean): Promise<boolean>;
  /** Demande un nom puis crée la branche sur `start` (HEAD si `null`) ; `startLabel` est affiché. */
  newBranch(path: string, start: string | null, startLabel: string): Promise<boolean>;
  renameBranch(path: string, branch: string): Promise<boolean>;
  deleteBranch(path: string, branch: string): Promise<boolean>;
  deleteRemoteBranch(path: string, branch: string): Promise<boolean>;
  /** `silent` (fetch automatique) : ni erreur ni message, et rien si une commande tourne déjà. */
  fetch(path: string, silent?: boolean): Promise<boolean>;
  /** `strategy` absente : celle des réglages. */
  pull(path: string, strategy?: PullStrategy): Promise<boolean>;
  /** Tire la branche courante depuis un autre remote (« Tirer depuis… ») : la branche du même
   *  nom, ou `branch`. La branche suivie ne change pas. */
  pullFrom(path: string, remote: string, branch?: string, strategy?: PullStrategy): Promise<boolean>;
  /** `remote` : destination choisie (« Pousser vers… ») ; absente : celle de la branche suivie. */
  push(path: string, force?: boolean, remote?: string): Promise<boolean>;
  /** Pousse la branche courante vers chaque remote, chacun avec la clé de son profil. */
  pushAll(path: string): Promise<boolean>;
  /** Demande un nom et une URL, ajoute le remote, puis le récupère si la case est cochée. */
  addRemote(path: string): Promise<boolean>;
  /** Dépôt distant tout juste créé (fenêtre « Publier ») : ajoute le remote `remote`, lui donne
   *  le profil `profile` (celui du compte) si le choix automatique en désigne un autre, puis, si
   *  `push`, pousse la branche courante en configurant son suivi. */
  publish(path: string, remote: string, url: string, profile: string | null, push: boolean): Promise<boolean>;
  renameRemote(path: string, remote: string): Promise<boolean>;
  editRemoteUrl(path: string, remote: string): Promise<boolean>;
  /** Après confirmation : ses branches distantes disparaissent, rien n'est touché sur le serveur. */
  removeRemote(path: string, remote: string): Promise<boolean>;
  stash(path: string): Promise<boolean>;
  pop(path: string): Promise<boolean>;
  /** Réapplique un stash de la pile ; `drop` : le retire aussi (pop). */
  applyStash(path: string, sha: string, drop: boolean): Promise<boolean>;
  /** Supprime un stash, après confirmation. */
  dropStash(path: string, sha: string, label: string): Promise<boolean>;
  /** Renomme un stash (nouveau message demandé). */
  renameStash(path: string, sha: string, label: string): Promise<boolean>;
  /** Nouvelle branche depuis un stash (`git stash branch`), nom demandé. */
  stashBranch(path: string, sha: string, label: string): Promise<boolean>;
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
const remoteNameError = (name: string) => (validRemoteName(name) ? null : t("remotes.invalidName"));
const remotesOf = (path: string) => useGraph.getState().graphs[path]?.refs?.remotes ?? [];

/** La branche courante suit-elle une branche de ce remote ? */
function tracksOn(path: string, remote: string): boolean {
  const refs = useGraph.getState().graphs[path]?.refs;
  const local = refs?.refs.find((r) => r.kind === "local" && r.short === refs.headBranch);
  return !!local?.upstream?.startsWith(`${remote}/`);
}

/** Préférences de la section d'un remote (repliée, masquée, dossiers repliés) : renommées avec
 *  lui (`next`), ou retirées s'il est supprimé (`null`). */
function moveRemoteUi(path: string, old: string, next: string | null) {
  const app = useApp.getState();
  const ui = app.repoUi[path];
  if (!ui) return;
  const prefix = `remote:${old}`;
  const mine = (key: string) => key === prefix || key.startsWith(`${prefix}/`);
  const move = (keys: string[]) => keys.flatMap((k) => (!mine(k) ? [k] : next === null ? [] : [`remote:${next}${k.slice(prefix.length)}`]));
  if (ui.collapsed.some(mine) || ui.hidden.some(mine)) app.setRepoUi(path, { ...ui, collapsed: move(ui.collapsed), hidden: move(ui.hidden) });
}

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

  /** Checkout générique : auto-stash, compte rendu, sélection du nouveau HEAD. Renvoie le
   *  résultat de la commande (`null` : échec, erreur affichée). */
  const switchWith = async (path: string, call: (stash: boolean) => Promise<OpResult>) => {
    const label = currentBranch(path) ?? "HEAD";
    const out = await exec(path, "checkout", () => call(autoStash()));
    if (!out.ok) return fail(out.error) && null;
    report(out.value, label);
    await selectHead(path);
    return out.value;
  };
  const switchTo = async (path: string, call: (stash: boolean) => Promise<OpResult>) => !!(await switchWith(path, call));

  return {
    running: {},

    checkout: (path, branch) => switchTo(path, (stash) => api.checkout(path, branch, stash)),

    async checkoutRemote(path, branch) {
      const before = useGraph.getState().graphs[path]?.refs;
      const split = splitRemoteBranch((before?.remotes ?? []).map((r) => r.name), branch);
      const existed = !!split && !!before?.refs.some((r) => r.kind === "local" && r.short === split.local);
      let local = "";
      const r = await switchWith(path, async (stash) => {
        const [res, l] = await api.checkoutRemote(path, branch, stash);
        local = l;
        return res;
      });
      if (!r) return false;
      // Locale créée à l'instant : déjà à jour. Conflits ou stash gardé : à régler d'abord.
      if (!existed || !split || r.conflicts || r.stashKept || currentBranch(path) !== local) return true;
      const upstream = useGraph.getState().graphs[path]?.refs?.refs.find((x) => x.kind === "local" && x.short === local)?.upstream;
      // Elle suit cette distante : le Pull habituel ; sinon, tirée depuis celle-ci sans changer son suivi.
      return upstream === branch ? get().pull(path) : get().pullFrom(path, split.remote, local);
    },

    checkoutDetached: (path, sha) => switchTo(path, (stash) => api.checkoutDetached(path, sha, stash)),

    checkoutPull: (path, remote, kind, number, branch, fork) =>
      switchTo(path, async (stash) => (await api.checkoutPull(path, remote, kind, number, branch, fork, stash))[0]),

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

    async pullFrom(path, remote, branch, strategy) {
      const mode = strategy ?? settings().pullStrategy ?? "ff-only";
      const current = currentBranch(path);
      const source = branch ?? current;
      if (!source) return fail("detached_head");
      const out = await exec(path, "pull", () => api.pullFrom(path, remote, source, mode, autoStash()));
      if (!out.ok && out.error === "not_fast_forward") {
        const pick = await useDialogs.getState().choose({
          title: t("pull.divergedTitle"),
          body: t("pull.divergedFromBody", { branch: current ?? "HEAD", source: `${remote}/${source}` }),
          choices: [
            { id: "merge", label: t("pull.merge") },
            { id: "rebase", label: t("pull.rebase") },
          ],
        });
        return pick ? get().pullFrom(path, remote, source, pick as PullStrategy) : false;
      }
      if (!out.ok) return fail(out.error);
      report(out.value, current ?? "HEAD");
      // Conflits ou stash gardé : l'avertissement posé par `report` reste affiché.
      if (!out.value.conflicts && !out.value.stashKept) notify(t("notice.pulledFrom", { source: `${remote}/${source}` }));
      return true;
    },

    async push(path, force = false, remote) {
      // Garde-fou : profil actif qui ne correspond pas au remote (une seule fois par session).
      if (!force && !(await useProfiles.getState().confirmIdentity(path))) return false;
      const out = await exec(path, "push", () => api.push(path, force, remote ?? null));
      if (!out.ok && out.error === "push_rejected" && !force) {
        const pick = await useDialogs.getState().choose({
          title: t("push.rejectedTitle"),
          body: t("push.rejectedBody"),
          choices: [
            { id: "force", label: t("push.force"), danger: true },
            { id: "pull", label: t("push.pullFirst") },
          ],
        });
        // « Pull » : depuis le remote qui a refusé. Si c'est celui de la branche suivie, c'est elle
        // qui a reçu le push (son nom peut différer) ; sinon, la branche du même nom.
        if (pick === "pull") return remote && !tracksOn(path, remote) ? get().pullFrom(path, remote) : get().pull(path);
        return pick === "force" ? get().push(path, true, remote) : false;
      }
      if (!out.ok) return fail(out.error);
      // Lu après le push : le dépôt vient d'être relu (au démarrage, il pouvait ne pas l'être encore).
      const branch = currentBranch(path) ?? "HEAD";
      notify(remote ? t("notice.pushedTo", { branch, remote }) : t("notice.pushed", { branch }));
      return true;
    },

    async pushAll(path) {
      if (!(await useProfiles.getState().confirmIdentity(path))) return false;
      // `origin` d'abord : une branche qui ne suit rien suit le premier remote qui la reçoit.
      const remotes = remotesOf(path)
        .map((r) => r.name)
        .sort((a, b) => Number(b === "origin") - Number(a === "origin"));
      if (remotes.length === 0) return fail("no_remote");
      // Une seule commande pour l'interface ; un remote en échec n'empêche pas les suivants.
      const out = await exec(path, "push", async () => {
        const failed: { remote: string; error: string }[] = [];
        for (const remote of remotes) {
          try {
            await api.push(path, false, remote);
          } catch (e) {
            failed.push({ remote, error: errorCode(e) });
          }
        }
        return failed;
      });
      if (!out.ok) return fail(out.error);
      const failed = out.value;
      const done = remotes.filter((r) => !failed.some((f) => f.remote === r));
      const branch = currentBranch(path) ?? "HEAD";
      if (done.length) notify(t("notice.pushedTo", { branch, remote: done.join(", ") }), failed.length > 0);
      if (failed.length === 0) return true;
      const details = failed.map((f) => t("push.remoteFailed", { remote: f.remote, error: errorMessage(i18n.t, f.error) }));
      return fail(details.join("\n"));
    },

    async addRemote(path) {
      const taken = new Set(remotesOf(path).map((r) => r.name));
      const answer = await useDialogs.getState().input({
        title: t("remotes.addTitle"),
        label: t("remotes.name"),
        // Le premier remote d'un dépôt s'appelle « origin » par convention.
        initial: taken.size === 0 ? "origin" : "",
        submit: t("remotes.add"),
        second: { label: t("remotes.url"), initial: "", placeholder: "git@github.com:mon-org/depot.git" },
        checkbox: { label: t("remotes.fetchNow"), checked: true },
        validate: (v) => remoteNameError(v) ?? (taken.has(v) ? t("remotes.exists") : null),
      });
      if (!answer) return false;
      const out = await exec(path, "remote", () => api.addRemote(path, answer.value, answer.second ?? ""));
      if (!out.ok) return fail(out.error);
      if (answer.checked) return get().fetch(path);
      notify(t("remotes.added", { remote: answer.value }));
      return true;
    },

    async publish(path, remote, url, profile, push) {
      const out = await exec(path, "remote", () => api.addRemote(path, remote, url));
      if (!out.ok) return fail(out.error);
      // La clé SSH et le compte du remote : ceux du profil du compte qui vient de créer le dépôt.
      const store = useProfiles.getState();
      if (profile && remoteProfile(store.profiles, store.repoProfiles[path], { name: remote, url }).profile?.id !== profile) {
        await store.setRemoteProfile(path, remote, profile);
      }
      if (!push) return true;
      // Sans suivi, `push` pousse vers la branche du même nom et la fait suivre (`-u`).
      return get().push(path, false, remote);
    },

    async renameRemote(path, remote) {
      const taken = new Set(remotesOf(path).map((r) => r.name));
      const answer = await useDialogs.getState().input({
        title: t("remotes.renameTitle", { remote }),
        label: t("remotes.name"),
        initial: remote,
        submit: t("branch.rename"),
        validate: (v) => remoteNameError(v) ?? (v !== remote && taken.has(v) ? t("remotes.exists") : null),
      });
      if (!answer || answer.value === remote) return false;
      const out = await exec(path, "remote", () => api.renameRemote(path, remote, answer.value));
      if (!out.ok) return fail(out.error);
      // Le profil choisi pour ce remote et les préférences de sa section le suivent.
      moveRemoteUi(path, remote, answer.value);
      await useProfiles.getState().moveRemoteProfile(path, remote, answer.value);
      return true;
    },

    async editRemoteUrl(path, remote) {
      const current = remotesOf(path).find((r) => r.name === remote)?.url ?? "";
      const answer = await useDialogs.getState().input({
        title: t("remotes.urlTitle", { remote }),
        label: t("remotes.url"),
        initial: current,
        submit: t("remotes.save"),
      });
      if (!answer || answer.value === current) return false;
      const out = await exec(path, "remote", () => api.setRemoteUrl(path, remote, answer.value));
      return out.ok || fail(out.error);
    },

    async removeRemote(path, remote) {
      const ok = await useDialogs.getState().choose({
        title: t("remotes.removeTitle", { remote }),
        body: t("remotes.removeBody"),
        choices: [{ id: "remove", label: t("remotes.removeConfirm"), danger: true }],
      });
      if (!ok) return false;
      const out = await exec(path, "remote", () => api.removeRemote(path, remote));
      if (!out.ok) return fail(out.error);
      // Un remote ajouté plus tard sous ce nom ne reprend ni son profil ni sa section masquée.
      moveRemoteUi(path, remote, null);
      await useProfiles.getState().moveRemoteProfile(path, remote, null);
      return true;
    },

    async cherryPick(path, shas) {
      const label = currentBranch(path) ?? "HEAD";
      const out = await exec(path, "operation", () => api.cherryPick(path, shas, autoStash()));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.cherryPicked", { count: shas.length, branch: label }));
        await selectHead(path);
      }
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

    async applyStash(path, sha, drop) {
      const out = await exec(path, "pop", () => api.stashApply(path, sha, drop));
      if (!out.ok) return fail(out.error);
      if (out.value.stashKept) notify(t("notice.popConflict"), true);
      useGraph.getState().select(path, WIP);
      return true;
    },

    async stashBranch(path, sha, label) {
      const existing = new Set(
        (useGraph.getState().graphs[path]?.refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short),
      );
      const answer = await useDialogs.getState().input({
        title: t("branch.newTitle"),
        subtitle: t("stashes.branchFrom", { name: label }),
        label: t("branch.name"),
        initial: "",
        submit: t("branch.create"),
        validate: (v) => nameError(v) ?? (existing.has(v) ? t("branch.exists") : null),
      });
      if (!answer) return false;
      const out = await exec(path, "branch", () => api.stashBranch(path, sha, answer.value));
      if (!out.ok) return fail(out.error);
      // Les modifications réappliquées sur la nouvelle branche.
      useGraph.getState().select(path, WIP);
      return true;
    },

    async renameStash(path, sha, label) {
      const answer = await useDialogs.getState().input({
        title: t("stashes.renameTitle"),
        subtitle: t("stashes.renameHint"),
        label: t("stashes.renameLabel"),
        initial: label,
        submit: t("stashes.rename"),
        validate: (v) => (v.trim() ? null : t("staging.stashFileEmpty")),
      });
      if (!answer || answer.value.trim() === label) return false;
      const out = await exec(path, "stash", () => api.stashRename(path, sha, answer.value.trim()));
      return out.ok || fail(out.error);
    },

    async dropStash(path, sha, label) {
      const ok = await useDialogs.getState().choose({
        title: t("stashes.dropTitle"),
        body: t("stashes.dropBody", { name: label }),
        choices: [{ id: "drop", label: t("stashes.drop"), danger: true }],
      });
      if (ok !== "drop") return false;
      const out = await exec(path, "stash", () => api.stashDrop(path, sha));
      return out.ok || fail(out.error);
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
