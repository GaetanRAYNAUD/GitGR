// Menus contextuels des branches, tags et commits (barre latérale et graphe).

import type { TFunction } from "i18next";
import { remoteProfile } from "../../lib/profiles";
import type { GitRef, RefsInfo, RemoteInfo } from "../../lib/types";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import type { MenuItem } from "../ContextMenu";

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

export function refMenu(t: TFunction, path: string, r: GitRef, refs: RefsInfo | null): MenuItem[] {
  const ops = useOps.getState();
  const current = r.kind === "local" && r.short === refs?.headBranch;
  const newBranch: MenuItem = { label: t("menu.newBranch"), onClick: () => ops.newBranch(path, r.name, r.short) };
  const copyName: MenuItem = { label: t("menu.copyName"), onClick: () => copy(r.short) };

  if (r.kind === "local") {
    return [
      { label: t("menu.checkoutBranch", { branch: r.short }), disabled: current, onClick: () => ops.checkout(path, r.short) },
      ...(current
        ? ([
            { label: t("menu.pull"), disabled: !r.upstream || r.gone, onClick: () => ops.pull(path) },
            { label: t("menu.push"), onClick: () => ops.push(path) },
          ] as MenuItem[])
        : []),
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
  );
  return items;
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
