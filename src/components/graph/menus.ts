// Menus contextuels des branches, tags et commits (barre latérale et graphe).

import type { TFunction } from "i18next";
import { remoteProfile } from "../../lib/profiles";
import { pullSource, pullTargetOf } from "../../lib/pulls";
import type { GitRef, RefsInfo, RemoteInfo } from "../../lib/types";
import { api, errorCode } from "../../lib/api";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useWork } from "../../store/worktree";
import { usePullList } from "../../store/pullList";
import { useBlameView, useFileHistoryView } from "../../store/range";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { usePublishDialog } from "../../store/publish";
import { usePullDialog } from "../../store/pulls";
import type { MenuItem } from "../ContextMenu";
import { squashable } from "../../lib/multiSelect";
import { remoteMarkOf } from "../RemoteMark";

const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

/** Action par défaut d'un double-clic : checkout de la branche (locale ou distante). */
export function checkoutRef(path: string, r: GitRef, refs: RefsInfo | null) {
  const ops = useOps.getState();
  if (r.kind === "local") {
    if (r.short !== refs?.headBranch) ops.checkout(path, r.short);
  } else if (r.kind === "remote") {
    ops.checkoutRemote(path, r.short);
  }
}

/** « pr » / « mr » d'après le provider du remote ; `null` : ni GitHub ni GitLab. */
function pullTermOf(path: string, refs: RefsInfo, remote: string | null): "pr" | "mr" | null {
  const info = refs.remotes.find((x) => x.name === remote);
  const store = useProfiles.getState();
  const provider = info && remoteMarkOf(store.profiles, store.repoProfiles[path], info)?.provider;
  return provider === "gitlab" ? "mr" : provider === "github" ? "pr" : null;
}

/** PR / MR depuis le menu d'une branche : sur la courante, vers la cible par défaut ; sur une
 *  autre (distante, ou locale qui suit une distante), de la courante vers celle-ci. */
function pullItems(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const head = refs?.headBranch;
  if (!refs || !head) return [];
  const show = usePullDialog.getState().show;
  if (r.kind === "local" && r.short === head) {
    const term = pullTermOf(path, refs, pullSource(refs, head)?.remote ?? null);
    return term ? [{ label: t(`pr.menuCreate_${term}`), onClick: () => show(path) }] : [];
  }
  const target = pullTargetOf(refs, r);
  const source = pullSource(refs, head);
  const term = target && pullTermOf(path, refs, target.remote);
  // Pas vers la branche suivie par la courante : ce serait elle-même.
  if (!target || !term || (source && source.remote === target.remote && source.remoteBranch === target.branch)) return [];
  return [
    {
      label: t(`pr.menuTo_${term}`, { source: head, target: `${target.remote}/${target.branch}` }),
      onClick: () => show(path, target),
    },
  ];
}

/** Reset de la branche courante sur un commit : sous-menu soft / mixed / hard (hard confirmé). */
function resetSub(t: TFunction, path: string, sha: string, refs: RefsInfo | null, label: string): MenuItem {
  const ops = useOps.getState();
  const head = refs?.headBranch ?? "HEAD";
  const same = !refs?.head || sha === refs.head;
  return {
    label: t("menu.resetSub", { branch: head, target: label }),
    disabled: same,
    title: !refs?.head ? t("menu.why.noHead") : same ? t("menu.why.sameCommit", { branch: head }) : undefined,
    items: [
      { label: t("menu.resetSoft"), onClick: () => void ops.resetTo(path, sha, "soft") },
      { label: t("menu.resetMixed"), onClick: () => void ops.resetTo(path, sha, "mixed") },
      { label: t("menu.resetHard"), danger: true, onClick: () => void ops.resetTo(path, sha, "hard") },
    ],
  };
}

/** Actions sur le commit pointé par une branche : nouvelle branche, cherry-pick, reset, revert. */
function tipItems(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const head = refs?.headBranch ?? "HEAD";
  const merge = isMergeCommit(path, r.target);
  const noHead = !refs?.head;
  return [
    { label: t("menu.newBranchFrom", { branch: r.short }), onClick: () => ops.newBranch(path, r.name, r.short) },
    {
      label: t("menu.cherryPickTip", { source: r.short, branch: head }),
      disabled: noHead || r.target === refs?.head || merge,
      title: noHead ? t("menu.why.noHead") : merge ? t("multi.cherryPickMerge") : r.target === refs?.head ? t("menu.why.sameCommit", { branch: head }) : undefined,
      onClick: () => void ops.cherryPick(path, [r.target]),
    },
    resetSub(t, path, r.target, refs, r.short),
    {
      label: t("menu.revertTip", { branch: r.short }),
      disabled: noHead || merge,
      title: noHead ? t("menu.why.noHead") : merge ? t("multi.revertMerge") : t("multi.revertHint"),
      onClick: () => void ops.revert(path, [r.target]),
    },
  ];
}

/** Le commit est-il un merge (d'après l'historique chargé) ? */
function isMergeCommit(path: string, sha: string): boolean {
  return (useGraph.getState().graphs[path]?.commits.find((c) => c.sha === sha)?.parents.length ?? 0) > 1;
}

/** Merge de la branche dans la courante, rebase de la courante sur elle. */
function integrateItems(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const head = refs?.headBranch;
  const busy = !!useWork.getState().repos[path]?.status?.operation;
  const why = !head ? t("menu.why.detached") : busy ? t("menu.why.operation") : undefined;
  const label = head ?? "HEAD";
  return [
    { label: t("menu.mergeInto", { source: r.short, branch: label }), disabled: !!why, title: why, onClick: () => void ops.mergeInto(path, r) },
    { label: t("menu.rebaseOnto", { branch: label, onto: r.short }), disabled: !!why, title: why, onClick: () => void ops.rebaseOnto(path, r) },
  ];
}

/** Branche suivie : les branches du même nom sur chaque remote, une autre au choix, aucune. */
function upstreamSub(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem {
  const ops = useOps.getState();
  const remotes = (refs?.remotes ?? []).map((x) => x.name);
  const candidates = (refs?.refs ?? []).filter((x) => x.kind === "remote" && remotes.some((rm) => x.short === `${rm}/${r.short}`));
  const items: MenuItem[] = candidates.map((x) => ({
    label: x.short,
    checked: r.upstream === x.short,
    onClick: () => void ops.setUpstream(path, r.short, x.short),
  }));
  if (r.upstream && !candidates.some((x) => x.short === r.upstream)) {
    items.push({ label: r.upstream, checked: true, onClick: () => {} });
  }
  items.push(
    { label: t("menu.upstreamOther"), onClick: () => void ops.chooseUpstream(path, r.short) },
    "sep",
    { label: t("menu.upstreamNone"), checked: !r.upstream, onClick: () => void ops.setUpstream(path, r.short, null) },
  );
  return {
    label: r.upstream ? t("menu.upstreamOf", { upstream: r.upstream }) : t("menu.upstream"),
    items,
  };
}

/** Clic droit sur une branche (barre latérale ou étiquette du graphe), par groupes : réseau,
 *  merge / rebase, checkout, commit pointé, PR / MR, gestion de la branche. */
export function refMenu(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const head = refs?.headBranch ?? null;
  const copyName: MenuItem = { label: t("menu.copyName"), onClick: () => copy(r.short) };
  const pulls = pullItems(t, path, r, refs);
  const pullGroup: MenuItem[] = pulls.length ? ["sep", ...pulls] : [];
  const detached: MenuItem = {
    label: t("menu.checkoutDetachedAt", { branch: r.short }),
    disabled: r.target === refs?.head && !head,
    onClick: () => ops.checkoutDetached(path, r.target),
  };

  if (r.kind === "local") {
    const current = r.short === head;
    const upstream = r.upstream && !r.gone ? r.upstream : null;
    const noUpstream = r.gone ? t("menu.why.gone", { upstream: r.upstream }) : t("menu.why.noUpstream");
    const remoteOf = upstream ? (refs?.refs ?? []).find((x) => x.kind === "remote" && x.short === upstream) : undefined;
    return [
      {
        label: current ? t("menu.pull") : t("menu.pullBranch", { branch: r.short }),
        disabled: !upstream,
        title: !upstream ? noUpstream : current ? undefined : t("menu.why.ffOnly"),
        onClick: () => void (current ? ops.pull(path) : ops.fastForward(path, r.short)),
      },
      {
        label: current ? t("menu.push") : t("menu.pushBranch", { branch: r.short }),
        onClick: () => void (current ? ops.push(path) : ops.pushBranch(path, r.short)),
      },
      upstreamSub(t, path, r, refs),
      ...(current ? [] : (["sep", ...integrateItems(t, path, r, refs)] as MenuItem[])),
      "sep",
      {
        label: t("menu.checkout"),
        items: [
          { label: t("menu.checkoutBranch", { branch: r.short }), disabled: current, title: current ? t("menu.why.current") : undefined, onClick: () => ops.checkout(path, r.short) },
          detached,
        ],
      },
      "sep",
      ...tipItems(t, path, r, refs),
      ...pullGroup,
      "sep",
      { label: t("menu.rename"), onClick: () => ops.renameBranch(path, r.short) },
      {
        label: t("menu.deleteLocal", { branch: r.short }),
        danger: true,
        disabled: current,
        title: current ? t("menu.why.deleteCurrent") : undefined,
        onClick: () => ops.deleteBranch(path, r.short),
      },
      ...(remoteOf
        ? ([
            { label: t("menu.deleteRemoteOf", { branch: remoteOf.short }), danger: true, onClick: () => ops.deleteRemoteBranch(path, remoteOf.short) },
            {
              label: t("menu.deleteBoth", { branch: r.short, remote: remoteOf.short }),
              danger: true,
              disabled: current,
              title: current ? t("menu.why.deleteCurrent") : undefined,
              onClick: () => ops.deleteBoth(path, r.short, remoteOf.short),
            },
          ] as MenuItem[])
        : []),
      "sep",
      copyName,
    ];
  }
  if (r.kind === "remote") {
    // Branche locale qui suit celle-ci : le pull et la suppression des deux passent par elle.
    const local = (refs?.refs ?? []).find((x) => x.kind === "local" && x.upstream === r.short && !x.gone);
    const localCurrent = !!local && local.short === head;
    return [
      ...(local
        ? ([
            {
              label: t("menu.pullInto", { branch: local.short }),
              title: localCurrent ? undefined : t("menu.why.ffOnly"),
              onClick: () => void (localCurrent ? ops.pull(path) : ops.fastForward(path, local.short)),
            },
            "sep",
          ] as MenuItem[])
        : []),
      ...integrateItems(t, path, r, refs),
      "sep",
      {
        label: t("menu.checkout"),
        items: [
          { label: t("menu.checkoutTracking", { branch: local?.short ?? r.short }), onClick: () => ops.checkoutRemote(path, r.short) },
          detached,
        ],
      },
      "sep",
      ...tipItems(t, path, r, refs),
      ...pullGroup,
      "sep",
      { label: t("menu.deleteRemoteOf", { branch: r.short }), danger: true, onClick: () => ops.deleteRemoteBranch(path, r.short) },
      ...(local
        ? ([
            {
              label: t("menu.deleteLocal", { branch: local.short }),
              danger: true,
              disabled: localCurrent,
              title: localCurrent ? t("menu.why.deleteCurrent") : undefined,
              onClick: () => ops.deleteBranch(path, local.short),
            },
            {
              label: t("menu.deleteBoth", { branch: local.short, remote: r.short }),
              danger: true,
              disabled: localCurrent,
              title: localCurrent ? t("menu.why.deleteCurrent") : undefined,
              onClick: () => ops.deleteBoth(path, local.short, r.short),
            },
          ] as MenuItem[])
        : []),
      "sep",
      copyName,
    ];
  }
  return [
    { label: t("menu.newBranch"), onClick: () => ops.newBranch(path, r.name, r.short) },
    { label: t("menu.checkoutDetached"), onClick: () => ops.checkoutDetached(path, r.target) },
    "sep",
    copyName,
  ];
}

/** Commit déposé sur une branche locale (glisser-déposer) : cherry-pick dessus, et reset de la
 *  courante ou déplacement d'une autre branche sur ce commit. */
export function commitDropMenu(t: TFunction, path: string, sha: string, target: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const short = sha.slice(0, 7);
  const merge = isMergeCommit(path, sha);
  const there = sha === target.target;
  const current = target.short === refs?.headBranch;
  const pickWhy = merge ? t("multi.cherryPickMerge") : there ? t("menu.why.sameCommit", { branch: target.short }) : undefined;
  return [
    {
      label: current ? t("menu.cherryPickOnto", { sha: short, branch: target.short }) : t("menu.cherryPickOntoOther", { sha: short, branch: target.short }),
      disabled: merge || there || !refs?.head,
      title: pickWhy,
      onClick: () => void ops.cherryPickOnto(path, target.short, sha),
    },
    current
      ? resetSub(t, path, sha, refs, short)
      : {
          label: t("menu.moveBranch", { branch: target.short, sha: short }),
          danger: true,
          disabled: there,
          title: there ? t("menu.why.sameCommit", { branch: target.short }) : undefined,
          onClick: () => void ops.moveBranch(path, target.short, sha),
        },
  ];
}

/** Clic droit sur un remote (en-tête de sa section) : pousser / tirer la branche courante,
 *  profil du remote — celui dont la clé SSH (et le compte) sert pour ce remote —, puis le
 *  gérer (renommer, changer l'URL, supprimer). */
export function remoteMenu(t: TFunction, path: string, remote: RemoteInfo, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const store = useProfiles.getState();
  const binding = store.repoProfiles[path];
  const choice = binding?.remotes?.[remote.name];
  // Ce que donnerait le choix automatique (règles sur l'URL, sinon profil du dépôt).
  const auto = remoteProfile(store.profiles, { active: binding?.active ?? null, allowed: [] }, remote).profile;
  const branch = refs?.headBranch;
  const set = (id: string | null | undefined) => () => void store.setRemoteProfile(path, remote.name, id);
  const items: MenuItem[] = [];
  if (branch) {
    items.push(
      { label: t("remotes.push", { branch, remote: remote.name }), onClick: () => ops.push(path, false, remote.name) },
      { label: t("remotes.pull", { branch, remote: remote.name }), onClick: () => ops.pullFrom(path, remote.name) },
      "sep",
    );
  }
  if (store.profiles.length) {
    items.push(
      { label: auto ? t("remotes.auto", { name: auto.name }) : t("remotes.autoNone"), checked: choice === undefined, onClick: set(undefined) },
      ...store.profiles.map((p): MenuItem => ({ label: `${p.name} · ${p.userEmail}`, checked: choice === p.id, onClick: set(p.id) })),
      { label: t("remotes.none"), checked: choice === null, onClick: set(null) },
      "sep",
    );
  }
  items.push(
    { label: t("remotes.rename"), onClick: () => ops.renameRemote(path, remote.name) },
    { label: t("remotes.editUrl"), onClick: () => ops.editRemoteUrl(path, remote.name) },
    { label: t("remotes.remove"), danger: true, onClick: () => ops.removeRemote(path, remote.name) },
    "sep",
    { label: t("remotes.copyUrl"), disabled: !remote.url, onClick: () => copy(remote.url ?? "") },
    { label: t("remotes.addButton"), onClick: () => ops.addRemote(path) },
    { label: t("publish.menu"), onClick: () => usePublishDialog.getState().show(path) },
  );
  return items;
}

/** Clic droit sur une sélection de plusieurs commits (`ordered` : dans l'ordre du graphe,
 *  du plus récent au plus ancien). */
export function pickedMenu(t: TFunction, path: string, ordered: { sha: string; parents: string[]; subject: string }[], refs: RefsInfo | null): MenuItem[] {
  const merges = ordered.some((c) => c.parents.length > 1);
  const canSquash = squashable(ordered);
  const branch = refs?.headBranch ?? "HEAD";
  return [
    {
      label: t("multi.cherryPick", { count: ordered.length, branch }),
      title: merges ? t("multi.cherryPickMerge") : undefined,
      disabled: merges || !refs?.head,
      onClick: () => void useOps.getState().cherryPick(path, ordered.map((c) => c.sha).reverse()),
    },
    {
      label: t("multi.revert", { count: ordered.length }),
      title: merges ? t("multi.revertMerge") : t("multi.revertHint"),
      disabled: merges || !refs?.head,
      onClick: () => void useOps.getState().revert(path, ordered.map((c) => c.sha)),
    },
    {
      label: t("multi.squash", { count: ordered.length }),
      title: canSquash ? t("multi.squashHint") : t("multi.squashNot"),
      disabled: !canSquash || !refs?.head,
      onClick: () => void useOps.getState().squash(path, ordered),
    },
    "sep",
    { label: t("multi.copyShas"), onClick: () => copy(ordered.map((c) => c.sha).join("\n")) },
  ];
}

/** Clic droit sur un commit du graphe. */
export function commitMenu(t: TFunction, path: string, sha: string, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const here = (refs?.refs ?? []).filter((r) => r.target === sha && r.kind === "local" && r.short !== refs?.headBranch);
  return [
    ...here.map((r): MenuItem => ({ label: t("menu.checkoutBranch", { branch: r.short }), onClick: () => ops.checkout(path, r.short) })),
    { label: t("menu.checkoutDetached"), disabled: sha === refs?.head && !refs?.headBranch, onClick: () => ops.checkoutDetached(path, sha) },
    { label: t("menu.newBranch"), onClick: () => ops.newBranch(path, sha, sha.slice(0, 7)) },
    "sep",
    {
      label: t("menu.cherryPick", { branch: refs?.headBranch ?? "HEAD" }),
      disabled: !refs?.head || sha === refs.head,
      onClick: () => void ops.cherryPick(path, [sha]),
    },
    { label: t("menu.revert"), title: t("multi.revertHint"), disabled: !refs?.head, onClick: () => void ops.revert(path, [sha]) },
    {
      label: t("menu.resetHere", { branch: refs?.headBranch ?? "HEAD" }),
      disabled: !refs?.head || sha === refs.head,
      onClick: () => void ops.resetTo(path, sha),
    },
    "sep",
    { label: t("menu.copySha"), onClick: () => copy(sha) },
  ];
}

/** Chemin absolu d'un fichier du dépôt, avec le séparateur du chemin du dépôt. */
export function absolutePath(repo: string, file: string): string {
  const sep = repo.includes("\\") ? "\\" : "/";
  return `${repo.replace(/[\\/]+$/, "")}${sep}${file.split("/").join(sep)}`;
}

/** Clic droit sur un dossier : l'ouvrir dans l'explorateur, copier son chemin. */
export function dirMenu(t: TFunction, repo: string, dir: string): MenuItem[] {
  const run = (how: "open" | "reveal") => () =>
    void api.openRepoFile(repo, dir, how).catch((e) => useApp.setState({ error: errorCode(e) }));
  return [
    { label: t("menu.openDir"), onClick: run("open") },
    { label: t("menu.revealFile"), onClick: run("reveal") },
    "sep",
    { label: t("menu.copyPath"), onClick: () => copy(dir) },
    { label: t("menu.copyAbsolutePath"), onClick: () => copy(absolutePath(repo, dir)) },
  ];
}

/** Ouvre l'historique d'un fichier à la place du graphe (et ferme ce qui le cacherait). */
export function showFileHistory(repo: string, file: string) {
  usePullList.getState().close(repo);
  useGraph.getState().closeDiff(repo);
  useWork.getState().closeDiff(repo);
  useFileHistoryView.getState().show(repo, file);
}

/** Ouvre le blame d'un fichier à la place du graphe (au commit `rev`, ou copie de travail). */
export function showBlame(repo: string, file: string, rev: string | null) {
  usePullList.getState().close(repo);
  useGraph.getState().closeDiff(repo);
  useWork.getState().closeDiff(repo);
  useBlameView.getState().show(repo, { file, rev });
}

/** Clic droit sur un fichier (fichiers d'un commit, modifications en cours). `at` : le
 *  commit où le fichier est montré (blame à ce commit ; sinon sur la copie de travail),
 *  `deleted` s'il n'y existe plus (pas de blame). */
export function fileMenu(t: TFunction, repo: string, file: string, at?: { rev: string; deleted?: boolean }): MenuItem[] {
  const run = (how: "open" | "reveal") => () =>
    void api.openRepoFile(repo, file, how).catch((e) => useApp.setState({ error: errorCode(e) }));
  return [
    { label: t("menu.openFile"), onClick: run("open") },
    { label: t("menu.revealFile"), onClick: run("reveal") },
    { label: t("fileHistory.menu"), onClick: () => showFileHistory(repo, file) },
    {
      label: t("blame.menu"),
      disabled: at?.deleted,
      title: at?.deleted ? t("blame.deleted") : undefined,
      onClick: () => showBlame(repo, file, at?.rev ?? null),
    },
    "sep",
    { label: t("menu.copyPath"), onClick: () => copy(file) },
    { label: t("menu.copyAbsolutePath"), onClick: () => copy(absolutePath(repo, file)) },
  ];
}
