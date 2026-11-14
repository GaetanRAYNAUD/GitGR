// Menus contextuels des branches, tags et commits (barre latérale et graphe).

import type { TFunction } from "i18next";
import type { GitRef, RefsInfo } from "../../lib/types";
import { useOps } from "../../store/ops";
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
