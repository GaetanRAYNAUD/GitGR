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
import { api, type BisectVerdict, errorCode } from "../lib/api";
import { useBisect } from "./bisect";
import { nextTagName } from "../lib/releases";
import { useConflictView } from "./range";
import { AUTOSTASH_PREFIX, validBranchName, validRemoteName } from "../lib/branchName";
import { errorMessage } from "../lib/errors";
import { remoteProfile } from "../lib/profiles";
import { splitRemoteBranch } from "../lib/refs";
import type { GitRef, OpResult, RebaseStep, ProviderKind, PullStrategy, ResetMode } from "../lib/types";
import { type NoticeAction, useApp } from "./app";
import { useDialogs } from "./dialogs";
import { useGraph, WIP } from "./graph";
import { useProfiles } from "./profiles";
import { useWork } from "./worktree";
import { matches, plan, snapshot, unchanged } from "../lib/undo";
import { nextEntry, useUndo } from "./undo";

export type OpName = "checkout" | "branch" | "fetch" | "pull" | "push" | "stash" | "pop" | "operation" | "remote";

/** Commandes qui parlent au remote : arrêtables (bouton Annuler, `api.cancelNetwork`). */
export const isNetworkOp = (op: OpName): op is "fetch" | "pull" | "push" => op === "fetch" || op === "pull" || op === "push";

export { AUTOSTASH_PREFIX };

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface OpsStore {
  /** Commande en cours par dépôt. */
  running: Record<string, OpName | undefined>;

  checkout(path: string, branch: string): Promise<boolean>;
  /** Cherry-pick des commits donnés (du plus ancien au plus récent) sur la branche courante. */
  cherryPick(path: string, shas: string[]): Promise<boolean>;
  /** Annule les commits donnés (du plus récent au plus ancien) par de nouveaux commits. */
  revert(path: string, shas: string[]): Promise<boolean>;
  /** Squash d'une suite contiguë de commits (`ordered` : du plus récent au plus ancien), message demandé. */
  squash(path: string, ordered: { sha: string; subject: string }[]): Promise<boolean>;
  /** Branche distante (`origin/x`) : passe sur la locale du même nom, créée au besoin (elle suit
   *  alors la distante). Une locale qui existait déjà est ensuite mise à jour depuis la distante,
   *  comme le bouton Pull (même stratégie, auto-stash, arrêt sur les conflits). */
  checkoutRemote(path: string, branch: string): Promise<boolean>;
  checkoutDetached(path: string, sha: string): Promise<boolean>;
  /** Rebase interactif (`base` : commits après elle). `pushed` : des commits déjà poussés
   *  seront réécrits, à confirmer. */
  interactiveRebase(path: string, base: string | null, onto: boolean, steps: RebaseStep[], pushed: boolean): Promise<boolean>;
  /** Bisect : marque `sha` (le commit extrait si `null`) bon, mauvais ou à passer ; extrait le
   *  suivant à tester (auto-stash). Trouvé : le premier mauvais commit est sélectionné. */
  bisect(path: string, verdict: BisectVerdict, sha: string | null): Promise<boolean>;
  /** Arrête le bisect : retour à la branche de départ. */
  bisectReset(path: string): Promise<boolean>;
  /** Bisect automatique : demande une commande de test, la lance sur chaque commit à tester. */
  bisectRun(path: string): Promise<boolean>;
  /** Déplace la branche courante sur `sha`, mode demandé (soft / mixed / hard). */
  resetTo(path: string, sha: string, mode?: ResetMode): Promise<boolean>;
  /** Branche d'une PR / MR : la distante (même dépôt) ou `pr/<n>` / `mr/<n>` (fork). */
  checkoutPull(path: string, remote: string, kind: ProviderKind, number: number, branch: string, fork: boolean): Promise<boolean>;
  /** Demande un nom puis crée la branche sur `start` (HEAD si `null`) ; `startLabel` est affiché. */
  /** `initial` : nom proposé (branche pour une issue…). */
  newBranch(path: string, start: string | null, startLabel: string, initial?: string): Promise<boolean>;
  renameBranch(path: string, branch: string): Promise<boolean>;
  /** Demande un nom (et un message facultatif : tag annoté) puis crée le tag sur `target`
   *  (HEAD si `null`) ; le pousse si la case est cochée. */
  newTag(path: string, target: string | null, targetLabel: string): Promise<boolean>;
  /** Pousse un tag vers `remote` (`origin` ou le premier si absent). */
  pushTag(path: string, name: string, remote?: string): Promise<boolean>;
  /** Supprime un tag, localement et / ou sur un remote (choix dans la confirmation). */
  deleteTag(path: string, name: string): Promise<boolean>;
  deleteBranch(path: string, branch: string): Promise<boolean>;
  deleteRemoteBranch(path: string, branch: string): Promise<boolean>;
  /** Supprime une branche locale et sa branche distante (`remoteBranch` : `origin/x`), une seule confirmation. */
  deleteBoth(path: string, branch: string, remoteBranch: string): Promise<boolean>;
  /** Avance rapide d'une branche qui n'est pas la courante depuis sa branche suivie (sans checkout). */
  fastForward(path: string, branch: string): Promise<boolean>;
  /** Pousse une branche locale qui n'est pas forcément la courante. */
  pushBranch(path: string, branch: string, force?: boolean): Promise<boolean>;
  /** Branche suivie par `branch` (`origin/x`, ou `null` : plus aucune). */
  setUpstream(path: string, branch: string, upstream: string | null): Promise<boolean>;
  /** Demande la branche distante à suivre (saisie), puis la règle. */
  chooseUpstream(path: string, branch: string): Promise<boolean>;
  /** Fusionne une branche (locale ou distante) dans la branche courante. */
  mergeInto(path: string, ref: GitRef): Promise<boolean>;
  /** Rebase la branche courante sur une branche (locale ou distante). */
  rebaseOnto(path: string, ref: GitRef): Promise<boolean>;
  /** Déplace une branche qui n'est pas la courante sur un commit (confirmation). */
  moveBranch(path: string, branch: string, sha: string): Promise<boolean>;
  /** Cherry-pick de commits (du plus ancien au plus récent) sur une branche : checkout de
   *  celle-ci d'abord si ce n'est pas la courante (auto-stash). */
  cherryPickOnto(path: string, branch: string, shas: string[]): Promise<boolean>;
  /** Annule la dernière opération notée (Ctrl+Z) ou rétablit la dernière annulée (Ctrl+Y). */
  replay(path: string, dir: "undo" | "redo"): Promise<boolean>;
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
/** Auto-stash du dépôt : son propre choix (menu de l'onglet), sinon celui des réglages. */
const autoStash = (path: string) => useApp.getState().repoUi[path]?.autoStash ?? settings().autoStash ?? true;
const currentBranch = (path: string) =>
  useGraph.getState().graphs[path]?.refs?.headBranch ?? useApp.getState().summaries[path]?.data?.branch ?? null;

/** Remote par défaut pour un tag : `origin` s'il existe, sinon le premier (comme côté Rust). */
export function defaultRemote(remotes: string[]): string | null {
  return remotes.includes("origin") ? "origin" : (remotes[0] ?? null);
}

/** Nom de tag refusé par git (`check-ref-format`, règles courantes), message traduit. */
function tagNameError(v: string): string | null {
  return !v || v.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$|\.lock$/.test(v) ? t("tag.invalid") : null;
}

/** Message d'information (auto-stash gardé, conflits…), affiché par l'app. */
function notify(text: string, sticky = false) {
  useApp.getState().notify(text, sticky);
}

/** Message d'une opération faite sans confirmation parce qu'elle s'annule : avec « Annuler ». */
function undoable(path: string, text: string) {
  useApp.getState().notify(text, false, [{ label: t("undo.undoKeys"), onClick: () => void useOps.getState().replay(path, "undo") }]);
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

/** Dernière commande de bisect automatique, par dépôt (le temps de la session). */
const lastBisectCommand = new Map<string, string>();

export const useOps = create<OpsStore>((set, get) => {
  /** Lance `fn` à son tour dans la file du dépôt, puis relit le dépôt. `[nom, libellé]` :
   *  opération notée pour l'annuler (libellé `undo.label.*`) si elle a déplacé des branches
   *  locales ou HEAD ; un nom seul : jamais notée. */
  const exec = <T>(path: string, op: OpName | [OpName, string], fn: () => Promise<T>): Promise<Outcome<T>> => {
    const [name, label] = Array.isArray(op) ? op : [op, null];
    const run = async (): Promise<Outcome<T>> => {
      set((s) => ({ running: { ...s.running, [path]: name } }));
      // État avant, relu à l'instant (pas celui de l'interface, qui peut dater).
      const before = label ? await api.repoRefs(path).then(snapshot, () => null) : null;
      const opBefore = useWork.getState().repos[path]?.status?.operation ?? null;
      let out: Outcome<T>;
      try {
        out = { ok: true, value: await fn() };
      } catch (e) {
        out = { ok: false, error: errorCode(e) };
      }
      try {
        await useApp.getState().refreshRepo(path);
        const refs = useGraph.getState().graphs[path]?.refs;
        // Arrêtée sur des conflits (rebase en cours…) : rien de stable à annuler.
        const status = useWork.getState().repos[path]?.status;
        const pending = !!status?.operation;
        // Vient de s'arrêter sur des conflits (merge, rebase, cherry-pick…) : la résolution du
        // premier fichier s'ouvre d'office.
        if (!opBefore && pending && status?.conflicted.length && !useConflictView.getState().open[path]) {
          useGraph.getState().closeDiff(path);
          useWork.getState().closeDiff(path);
          useConflictView.getState().show(path, status.conflicted[0].path);
        }
        if (label && before && refs && !pending) {
          const after = snapshot(refs);
          if (!unchanged(before, after)) useUndo.getState().record(path, { label, before, after, soft: false });
        }
      } finally {
        set((s) => ({ running: { ...s.running, [path]: undefined } }));
      }
      return out;
    };
    const next = (queues[path] ?? Promise.resolve()).then(run, run);
    queues[path] = next.catch(() => {});
    return next;
  };

  /** Erreur affichée en bas ; `actions` : ce qu'on peut faire tout de suite (Réessayer…). */
  const fail = (error: string, actions?: NoticeAction[]) => {
    // Arrêtée par l'utilisateur (bouton Annuler) : pas une erreur à lui montrer.
    if (error === "cancelled") {
      useApp.getState().notify(t("repo.netCancelled"));
      return false;
    }
    useApp.setState({ error, errorActions: actions?.length ? { for: error, actions } : null });
    return false;
  };

  /** Actions d'une erreur réseau : refaire l'opération, et pour un refus d'authentification,
   *  ouvrir les profils (comptes, clés). */
  const netActions = (error: string, retry: () => unknown): NoticeAction[] => [
    { label: t("errors.retry"), onClick: () => void retry() },
    ...(error === "auth_failed" || error === "wrong_passphrase" ? [{ label: t("errors.openProfiles"), onClick: () => useProfiles.getState().openPage() }] : []),
  ];
  const isNet = (error: string) => ["auth_failed", "network_unreachable", "host_key_unknown", "wrong_passphrase"].includes(error);

  /** Checkout générique : auto-stash, compte rendu, sélection du nouveau HEAD. Renvoie le
   *  résultat de la commande (`null` : échec, erreur affichée). */
  const switchWith = async (path: string, call: (stash: boolean) => Promise<OpResult>, branch?: string) => {
    const label = currentBranch(path) ?? "HEAD";
    const out = await exec(path, ["checkout", "checkout"], () => call(autoStash(path)));
    if (!out.ok) {
      // Branche déjà extraite dans un autre worktree : git refuse ; on propose de l'ouvrir.
      if (out.error === "branch_in_worktree" && branch) {
        const w = (await api.listWorktrees(path).catch(() => [])).find((x) => x.branch === branch && !x.current);
        if (w) return fail(out.error, [{ label: t("worktrees.openTab"), onClick: () => void useApp.getState().openPath(w.path) }]) && null;
      }
      return fail(out.error) && null;
    }
    report(out.value, label);
    await selectHead(path);
    return out.value;
  };
  const switchTo = async (path: string, call: (stash: boolean) => Promise<OpResult>, branch?: string) => !!(await switchWith(path, call, branch));

  return {
    running: {},

    checkout: (path, branch) => switchTo(path, (stash) => api.checkout(path, branch, stash), branch),

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

    async bisect(path, verdict, sha) {
      const out = await exec(path, "checkout", () => api.bisectMark(path, verdict, sha, autoStash(path)));
      if (!out.ok) {
        void useBisect.getState().load(path);
        return fail(out.error);
      }
      const [res, state] = out.value;
      useBisect.getState().set(path, state);
      report(res, "bisect");
      if (state.firstBad) {
        notify(t("bisect.found", { sha: state.firstBad.slice(0, 7) }), true);
        await useGraph.getState().reveal(path, state.firstBad);
      } else if (state.possible.length) notify(t("bisect.ambiguous", { list: state.possible.map((x) => x.slice(0, 7)).join(", ") }), true);
      else await selectHead(path);
      return true;
    },

    async bisectRun(path) {
      const answer = await useDialogs.getState().input({
        title: t("bisect.runTitle"),
        subtitle: t("bisect.runBody"),
        label: t("bisect.runCommand"),
        mono: true,
        initial: lastBisectCommand.get(path) ?? "",
        submit: t("bisect.runSubmit"),
        validate: (v) => (v.trim() ? null : t("bisect.runEmpty")),
      });
      if (!answer) return false;
      const command = answer.value.trim();
      lastBisectCommand.set(path, command);
      const out = await exec(path, "checkout", () => api.bisectRun(path, command, autoStash(path)));
      void useBisect.getState().load(path);
      if (!out.ok) {
        const failed = /^bisect_run_failed:([\s\S]*)$/.exec(out.error);
        if (!failed) return fail(out.error);
        await useDialogs.getState().choose({
          title: t("bisect.runFailedTitle"),
          body: t("bisect.runFailedBody", { command }),
          output: failed[1],
          choices: [{ id: "ok", label: t("bisect.runClose") }],
        });
        return false;
      }
      const [res, state] = out.value;
      useBisect.getState().set(path, state);
      report(res, "bisect");
      if (state.firstBad) {
        notify(t("bisect.found", { sha: state.firstBad.slice(0, 7) }), true);
        await useGraph.getState().reveal(path, state.firstBad);
      } else if (state.possible.length) notify(t("bisect.ambiguous", { list: state.possible.map((x) => x.slice(0, 7)).join(", ") }), true);
      return true;
    },

    async bisectReset(path) {
      const out = await exec(path, "checkout", () => api.bisectReset(path, autoStash(path)));
      void useBisect.getState().load(path);
      if (!out.ok) return fail(out.error);
      report(out.value, "bisect");
      await selectHead(path);
      return true;
    },

    checkoutPull: (path, remote, kind, number, branch, fork) =>
      switchTo(path, async (stash) => (await api.checkoutPull(path, remote, kind, number, branch, fork, stash))[0]),

    async resetTo(path, sha, chosen) {
      const branch = currentBranch(path) ?? "HEAD";
      const title = t("reset.title", { branch, sha: sha.slice(0, 7) });
      // Un seul chemin, d'où qu'on vienne : le mode se choisit dans la fenêtre, expliqué
      // (mixed proposé) ; le bouton dit ce qui va se passer, rouge pour hard.
      const mode = await useDialogs.getState().choose({
        title,
        body: t("reset.intro", { branch, sha: sha.slice(0, 7) }),
        choices: [],
        radio: {
          label: t("reset.mode"),
          initial: chosen ?? "mixed",
          options: (["soft", "mixed", "hard"] as const).map((m) => ({
            id: m,
            label: t(`reset.${m}`),
            hint: t(`reset.${m}Hint`),
            submit: t(`reset.${m}Submit`),
            danger: m === "hard",
          })),
        },
      });
      if (mode !== "soft" && mode !== "mixed" && mode !== "hard") return false;
      const out = await exec(path, ["operation", "reset"], () => api.resetTo(path, sha, mode));
      if (!out.ok) return fail(out.error);
      notify(t("reset.done", { branch, sha: sha.slice(0, 7) }));
      return true;
    },

    async newBranch(path, start, startLabel, initial = "") {
      const existing = new Set(
        (useGraph.getState().graphs[path]?.refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short),
      );
      const answer = await useDialogs.getState().input({
        title: t("branch.newTitle"),
        subtitle: t("branch.newFrom", { start: startLabel }),
        label: t("branch.name"),
        mono: true,
        initial,
        submit: t("branch.create"),
        checkbox: { label: t("branch.checkout"), checked: true },
        validate: (v) => nameError(v) ?? (existing.has(v) ? t("branch.exists") : null),
      });
      if (!answer) return false;
      const label = currentBranch(path) ?? "HEAD";
      const out = await exec(path, ["branch", "newBranch"], () => api.createBranch(path, answer.value, start, answer.checked, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (answer.checked) await selectHead(path);
      return true;
    },

    async newTag(path, target, targetLabel) {
      const refs = useGraph.getState().graphs[path]?.refs;
      const existing = new Set((refs?.refs ?? []).filter((r) => r.kind === "tag").map((r) => r.short));
      const remote = defaultRemote(refs?.remotes.map((r) => r.name) ?? []);
      const answer = await useDialogs.getState().input({
        title: t("tag.newTitle"),
        subtitle: t("tag.newOn", { target: targetLabel }),
        label: t("tag.name"),
        mono: true,
        // Version suivante (patch) du tag le plus récent en numéro, s'il y en a un ; minor et
        // major d'un clic.
        initial: nextTagName([...existing]) ?? "",
        suggestions: {
          label: t("tag.nextVersion"),
          items: (["patch", "minor", "major"] as const).flatMap((level) => {
            const value = nextTagName([...existing], level);
            return value ? [{ label: t(`tag.level.${level}`), value }] : [];
          }),
        },
        submit: t("tag.create"),
        second: { label: t("tag.message"), initial: "", placeholder: t("tag.messageHint"), optional: true },
        ...(remote ? { checkbox: { label: t("tag.pushTo", { remote }), checked: false } } : {}),
        validate: (v) => tagNameError(v) ?? (existing.has(v) ? t("tag.exists") : null),
      });
      if (!answer) return false;
      const out = await exec(path, "branch", () => api.createTag(path, answer.value, target, answer.second || null));
      if (!out.ok) return fail(out.error);
      if (remote && answer.checked) return get().pushTag(path, answer.value, remote);
      notify(t("tag.created", { tag: answer.value }));
      return true;
    },

    async pushTag(path, name, remote) {
      const out = await exec(path, "push", () => api.pushTag(path, name, remote ?? null));
      if (!out.ok) return fail(out.error);
      notify(t("tag.pushed", { tag: name, remote: out.value }));
      return true;
    },

    async deleteTag(path, name) {
      const remotes = useGraph.getState().graphs[path]?.refs?.remotes.map((r) => r.name) ?? [];
      const remote = defaultRemote(remotes);
      const choice = await useDialogs.getState().choose({
        title: t("tag.deleteTitle", { tag: name }),
        body: remote ? t("tag.deleteBodyRemote", { remote }) : t("tag.deleteBody"),
        choices: [
          ...(remote ? [{ id: "remote", label: t("tag.deleteRemote", { remote }), danger: true }] : []),
          ...(remote ? [{ id: "both", label: t("tag.deleteBoth", { remote }), danger: true }] : []),
          { id: "local", label: t("tag.deleteLocal"), danger: true },
        ],
      });
      if (!choice) return false;
      if (choice !== "local") {
        const out = await exec(path, "push", () => api.deleteRemoteTag(path, name, remote));
        if (!out.ok) return fail(out.error);
        if (choice === "remote") {
          notify(t("tag.deletedRemote", { tag: name, remote: out.value }));
          return true;
        }
      }
      const out = await exec(path, "branch", () => api.deleteTag(path, name));
      return out.ok || fail(out.error);
    },

    async renameBranch(path, branch) {
      const answer = await useDialogs.getState().input({
        title: t("branch.renameTitle", { branch }),
        label: t("branch.name"),
        mono: true,
        initial: branch,
        submit: t("branch.rename"),
        validate: nameError,
      });
      if (!answer || answer.value === branch) return false;
      const out = await exec(path, ["branch", "rename"], () => api.renameBranch(path, branch, answer.value));
      return out.ok || fail(out.error);
    },

    // Branche locale : pas de confirmation, la suppression s'annule (message « Annuler »,
    // Ctrl+Z). Une branche non fusionnée le dit quand même avant de la supprimer.
    async deleteBranch(path, branch) {
      const dialogs = useDialogs.getState();
      let out = await exec(path, ["branch", "deleteBranch"], () => api.deleteBranch(path, branch, false));
      if (!out.ok && out.error === "branch_not_merged") {
        const force = await dialogs.choose({
          title: t("branch.notMergedTitle", { branch }),
          body: t("branch.notMergedBody"),
          choices: [{ id: "force", label: t("branch.forceDelete"), danger: true }],
        });
        if (!force) return false;
        out = await exec(path, ["branch", "deleteBranch"], () => api.deleteBranch(path, branch, true));
      }
      if (!out.ok) return fail(out.error);
      undoable(path, t("branch.deleted", { branch }));
      return true;
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

    async deleteBoth(path, branch, remoteBranch) {
      const dialogs = useDialogs.getState();
      const ok = await dialogs.choose({
        title: t("branch.deleteBothTitle", { branch, remote: remoteBranch }),
        body: t("branch.deleteBothBody"),
        choices: [{ id: "delete", label: t("branch.deleteBoth"), danger: true }],
      });
      if (!ok) return false;
      let out = await exec(path, ["branch", "deleteBranch"], () => api.deleteBranch(path, branch, false));
      if (!out.ok && out.error === "branch_not_merged") {
        const force = await dialogs.choose({
          title: t("branch.notMergedTitle", { branch }),
          body: t("branch.notMergedBody"),
          choices: [{ id: "force", label: t("branch.forceDelete"), danger: true }],
        });
        if (!force) return false;
        out = await exec(path, ["branch", "deleteBranch"], () => api.deleteBranch(path, branch, true));
      }
      if (!out.ok) return fail(out.error);
      const remote = await exec(path, "push", () => api.deleteRemoteBranch(path, remoteBranch));
      return remote.ok || fail(remote.error);
    },

    async fastForward(path, branch) {
      const out = await exec(path, ["pull", "pull"], () => api.fastForwardBranch(path, branch));
      if (!out.ok) return fail(out.error === "not_fast_forward" ? "ff_branch_diverged" : out.error);
      notify(t(out.value ? "notice.fastForwarded" : "notice.upToDate", { branch }));
      return true;
    },

    async pushBranch(path, branch, force = false) {
      if (branch === currentBranch(path)) return get().push(path, force);
      if (!force && !(await useProfiles.getState().confirmIdentity(path))) return false;
      const out = await exec(path, "push", () => api.pushBranch(path, branch, force, null));
      if (!out.ok && out.error === "push_rejected" && !force) {
        const pick = await useDialogs.getState().choose({
          title: t("push.rejectedTitle"),
          body: t("push.rejectedOtherBody", { branch }),
          choices: [{ id: "force", label: t("push.force"), danger: true }],
        });
        return pick === "force" ? get().pushBranch(path, branch, true) : false;
      }
      if (!out.ok) return fail(out.error);
      notify(t("notice.pushed", { branch }));
      return true;
    },

    async setUpstream(path, branch, upstream) {
      const out = await exec(path, "branch", () => api.setUpstream(path, branch, upstream));
      if (!out.ok) return fail(out.error);
      notify(upstream ? t("notice.upstreamSet", { branch, upstream }) : t("notice.upstreamUnset", { branch }));
      return true;
    },

    async chooseUpstream(path, branch) {
      const refs = useGraph.getState().graphs[path]?.refs;
      const remote = new Set((refs?.refs ?? []).filter((r) => r.kind === "remote").map((r) => r.short));
      const current = refs?.refs.find((r) => r.kind === "local" && r.short === branch)?.upstream ?? "";
      const answer = await useDialogs.getState().input({
        title: t("upstream.title", { branch }),
        label: t("upstream.label"),
        mono: true,
        initial: current,
        submit: t("upstream.submit"),
        validate: (v) => (remote.has(v) ? null : t("upstream.unknown")),
      });
      if (!answer || answer.value === current) return false;
      return get().setUpstream(path, branch, answer.value);
    },

    async mergeInto(path, ref) {
      const label = currentBranch(path);
      if (!label) return fail("detached_head");
      const out = await exec(path, ["operation", "merge"], () => api.mergeBranch(path, ref.name, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.merged", { source: ref.short, branch: label }));
        await selectHead(path);
      }
      return true;
    },

    async interactiveRebase(path, base, onto, steps, pushed) {
      const label = currentBranch(path);
      if (!label) return fail("detached_head");
      if (pushed) {
        const go = await useDialogs.getState().choose({
          title: t("rebase.pushedTitle"),
          body: t("rebase.pushedBody"),
          choices: [{ id: "go", label: t("rebase.pushedGo"), danger: true }],
        });
        if (go !== "go") return false;
      }
      const out = await exec(path, ["operation", "rebase"], () => api.interactiveRebase(path, base, onto, steps, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("rebase.done", { branch: label }));
        await selectHead(path);
      }
      return true;
    },

    async rebaseOnto(path, ref) {
      const label = currentBranch(path);
      if (!label) return fail("detached_head");
      const out = await exec(path, ["operation", "rebase"], () => api.rebaseOnto(path, ref.name, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.rebased", { branch: label, onto: ref.short }));
        await selectHead(path);
      }
      return true;
    },

    async replay(path, dir) {
      const entry = nextEntry(path, dir);
      if (!entry) return false;
      const [from, to] = dir === "undo" ? [entry.after, entry.before] : [entry.before, entry.after];
      const label = t(`undo.label.${entry.label}`);
      let done = 0;
      const out = await exec(path, "operation", async () => {
        if (!matches(snapshot(await api.repoRefs(path)), from, to)) throw "undo_stale";
        let res: OpResult | null = null;
        for (const step of plan(from, to, entry.soft)) {
          if (step.kind === "checkout") {
            res = step.branch ? await api.checkout(path, step.branch, autoStash(path)) : await api.checkoutDetached(path, step.sha, autoStash(path));
          } else {
            await api.setBranchTip(path, step.branch, step.expected, step.target, step.mode);
          }
          done++;
        }
        return res;
      });
      if (!out.ok) {
        // Le dépôt a changé, ou l'opération s'est arrêtée en route : plus rien n'est fiable.
        if (out.error === "undo_stale" || done > 0) useUndo.getState().clear(path);
        return fail(out.error === "undo_stale" ? "undo_stale" : out.error);
      }
      useUndo.getState().moved(path, dir);
      if (out.value) report(out.value, from.headBranch ?? "HEAD");
      notify(t(dir === "undo" ? "undo.undone" : "undo.redone", { label }));
      await selectHead(path);
      return true;
    },

    // Sans confirmation : le déplacement s'annule (message « Annuler », Ctrl+Z).
    async moveBranch(path, branch, sha) {
      const out = await exec(path, ["branch", "move"], () => api.moveBranch(path, branch, sha));
      if (!out.ok) return fail(out.error);
      undoable(path, t("reset.done", { branch, sha: sha.slice(0, 7) }));
      return true;
    },

    async cherryPickOnto(path, branch, shas) {
      // Autre branche : d'abord sans la checkout (copie de travail intacte) ; sinon (conflit,
      // merge…), checkout puis cherry-pick comme avant.
      if (branch !== currentBranch(path)) {
        const out = await exec(path, ["operation", "cherryPick"], () => api.cherryPickToBranch(path, branch, shas));
        if (out.ok) {
          notify(out.value ? t("notice.cherryPickedAway", { count: out.value, branch }) : t("notice.cherryPickedNothing", { branch }));
          return true;
        }
        if (out.error !== "needs_checkout") return fail(out.error);
      }
      if (branch !== currentBranch(path) && !(await get().checkout(path, branch))) return false;
      // Checkout arrêté (stash gardé en conflit) : la branche n'est peut-être pas celle visée.
      if (currentBranch(path) !== branch) return false;
      return get().cherryPick(path, shas);
    },

    async fetch(path, silent = false) {
      if (silent && get().running[path]) return false;
      const out = await exec(path, "fetch", () => api.fetch(path));
      if (silent) return out.ok;
      if (!out.ok) return fail(out.error, isNet(out.error) ? netActions(out.error, () => get().fetch(path)) : undefined);
      notify(t("notice.fetched"));
      return true;
    },

    async pull(path, strategy) {
      const mode = strategy ?? settings().pullStrategy ?? "ff-only";
      const branch = currentBranch(path) ?? "HEAD";
      const out = await exec(path, ["pull", "pull"], () => api.pull(path, mode, autoStash(path)));
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
      if (!out.ok) return fail(out.error, isNet(out.error) ? netActions(out.error, () => get().pull(path, strategy)) : undefined);
      report(out.value, branch);
      return true;
    },

    async pullFrom(path, remote, branch, strategy) {
      const mode = strategy ?? settings().pullStrategy ?? "ff-only";
      const current = currentBranch(path);
      const source = branch ?? current;
      if (!source) return fail("detached_head");
      const out = await exec(path, ["pull", "pull"], () => api.pullFrom(path, remote, source, mode, autoStash(path)));
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
      if (!out.ok) return fail(out.error, isNet(out.error) ? netActions(out.error, () => get().push(path, force, remote)) : undefined);
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
            // Arrêté par l'utilisateur (Annuler) : pas les remotes suivants.
            if (errorCode(e) === "cancelled") throw e;
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
      // Un remote a des commits qu'on n'a pas : « Pull puis push » ; sinon, réessayer.
      const rejected = failed.find((f) => f.error === "push_rejected");
      const actions: NoticeAction[] = rejected
        ? [
            {
              label: t("push.pullThenPush"),
              onClick: () =>
                void (async () => {
                  const pulled = tracksOn(path, rejected.remote) ? await get().pull(path) : await get().pullFrom(path, rejected.remote);
                  if (pulled) await get().pushAll(path);
                })(),
            },
          ]
        : [{ label: t("errors.retry"), onClick: () => void get().pushAll(path) }];
      return fail(details.join("\n"), actions);
    },

    async addRemote(path) {
      const taken = new Set(remotesOf(path).map((r) => r.name));
      const answer = await useDialogs.getState().input({
        title: t("remotes.addTitle"),
        label: t("remotes.name"),
        mono: true,
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
        mono: true,
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
        mono: true,
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
      const out = await exec(path, ["operation", "cherryPick"], () => api.cherryPick(path, shas, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.cherryPicked", { count: shas.length, branch: label }));
        await selectHead(path);
      }
      return true;
    },

    async squash(path, ordered) {
      const oldest = ordered[ordered.length - 1];
      const answer = await useDialogs.getState().input({
        title: t("squash.title", { count: ordered.length }),
        subtitle: t("squash.subtitle"),
        label: t("squash.message"),
        initial: oldest?.subject ?? "",
        submit: t("squash.submit"),
        validate: (v) => (v.trim() ? null : t("errors.empty_message")),
      });
      if (!answer) return false;
      // Résumé choisi, puis les sujets réunis (du plus ancien au plus récent), comme git.
      const message = [answer.value.trim(), "", ...[...ordered].reverse().map((c) => `* ${c.subject}`)].join("\n");
      const shas = ordered.map((c) => c.sha);
      const label = currentBranch(path) ?? "HEAD";
      let out = await exec(path, ["operation", "squash"], () => api.squash(path, shas, message, false, autoStash(path)));
      if (!out.ok && out.error === "squash_pushed") {
        const go = await useDialogs.getState().choose({
          title: t("squash.pushedTitle"),
          body: t("squash.pushedBody"),
          choices: [{ id: "go", label: t("squash.pushedGo"), danger: true }],
        });
        if (go !== "go") return false;
        out = await exec(path, ["operation", "squash"], () => api.squash(path, shas, message, true, autoStash(path)));
      }
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.squashed", { count: shas.length }));
        await selectHead(path);
      }
      return true;
    },

    async revert(path, shas) {
      const label = currentBranch(path) ?? "HEAD";
      const out = await exec(path, ["operation", "revert"], () => api.revert(path, shas, autoStash(path)));
      if (!out.ok) return fail(out.error);
      report(out.value, label);
      if (!out.value.conflicts) {
        notify(t("notice.reverted", { count: shas.length, branch: label }));
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
        mono: true,
        initial: "",
        submit: t("branch.create"),
        validate: (v) => nameError(v) ?? (existing.has(v) ? t("branch.exists") : null),
      });
      if (!answer) return false;
      const out = await exec(path, ["branch", "newBranch"], () => api.stashBranch(path, sha, answer.value));
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
