// Menus contextuels des branches, tags et commits (barre latérale et graphe).

import type { TFunction } from "i18next";
import { remoteProfile } from "../../lib/profiles";
import { pullSource, pullTargetOf } from "../../lib/pulls";
import type { GitRef, RefsInfo, RemoteInfo } from "../../lib/types";
import { api, errorCode } from "../../lib/api";
import { useApp } from "../../store/app";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { usePublishDialog } from "../../store/publish";
import { usePullDialog } from "../../store/pulls";
import type { MenuItem } from "../ContextMenu";
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

export function refMenu(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const current = r.kind === "local" && r.short === refs?.headBranch;
  const newBranch: MenuItem = { label: t("menu.newBranch"), onClick: () => ops.newBranch(path, r.name, r.short) };
  const copyName: MenuItem = { label: t("menu.copyName"), onClick: () => copy(r.short) };
  const pulls = pullItems(t, path, r, refs);
  const pullGroup: MenuItem[] = pulls.length ? ["sep", ...pulls] : [];

  if (r.kind === "local") {
    return [
      { label: t("menu.checkoutBranch", { branch: r.short }), disabled: current, onClick: () => ops.checkout(path, r.short) },
      ...(current
        ? ([
            { label: t("menu.pull"), disabled: !r.upstream || r.gone, onClick: () => ops.pull(path) },
            { label: t("menu.push"), onClick: () => ops.push(path) },
          ] as MenuItem[])
        : []),
      ...pullGroup,
      "sep",
      newBranch,
      { label: t("menu.rename"), onClick: () => ops.renameBranch(path, r.short) },
      { label: t("menu.delete"), danger: true, disabled: current, onClick: () => ops.deleteBranch(path, r.short) },
      "sep",
      copyName,
    ];
  }
  if (r.kind === "remote") {
    return [
      { label: t("menu.checkoutBranch", { branch: r.short }), onClick: () => ops.checkoutRemote(path, r.short) },
      ...pullGroup,
      "sep",
      newBranch,
      { label: t("menu.deleteRemote"), danger: true, onClick: () => ops.deleteRemoteBranch(path, r.short) },
      "sep",
      copyName,
    ];
  }
  return [
    newBranch,
    { label: t("menu.checkoutDetached"), onClick: () => ops.checkoutDetached(path, r.target) },
    "sep",
    copyName,
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
export function pickedMenu(t: TFunction, path: string, ordered: { sha: string; parents: string[] }[], refs: RefsInfo | null): MenuItem[] {
  const merges = ordered.some((c) => c.parents.length > 1);
  const branch = refs?.headBranch ?? "HEAD";
  return [
    {
      label: t("multi.cherryPick", { count: ordered.length, branch }),
      title: merges ? t("multi.cherryPickMerge") : undefined,
      disabled: merges || !refs?.head,
      onClick: () => void useOps.getState().cherryPick(path, ordered.map((c) => c.sha).reverse()),
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

/** Clic droit sur un fichier (fichiers d'un commit, modifications en cours). */
export function fileMenu(t: TFunction, repo: string, file: string): MenuItem[] {
  const run = (how: "open" | "reveal") => () =>
    void api.openRepoFile(repo, file, how).catch((e) => useApp.setState({ error: errorCode(e) }));
  return [
    { label: t("menu.openFile"), onClick: run("open") },
    { label: t("menu.revealFile"), onClick: run("reveal") },
    "sep",
    { label: t("menu.copyPath"), onClick: () => copy(file) },
    { label: t("menu.copyAbsolutePath"), onClick: () => copy(absolutePath(repo, file)) },
  ];
}
