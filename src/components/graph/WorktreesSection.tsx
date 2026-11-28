// Section « Worktrees » de la barre latérale : les autres copies de travail du dépôt (affichée
// dès qu'il y en a une en plus du dossier ouvert). Clic : ouvrir dans un onglet ; clic droit :
// ouvrir le dossier, copier le chemin, supprimer, nettoyer ceux dont le dossier a disparu.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, errorCode } from "../../lib/api";
import { sectionKey } from "../../lib/layout";
import type { RepoUi, Worktree } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useWorktrees, worktreeName } from "../../store/worktrees";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { ResizableBlock } from "../Splitter";

export const WORKTREES_SECTION = "worktrees";

const NONE: Worktree[] = [];

export function worktreeMenu(t: TFunction, path: string, w: Worktree, list: Worktree[]): MenuItem[] {
  const store = useWorktrees.getState();
  const items: MenuItem[] = [{ header: worktreeName(w) }];
  if (!w.prunable && !w.current) items.push({ label: t("worktrees.openTab"), onClick: () => store.open(w) });
  if (!w.prunable)
    items.push({
      label: t("worktrees.openFolder"),
      onClick: () => void api.openRepoFile(w.path, "", "open").catch((e) => useApp.setState({ error: errorCode(e) })),
    });
  items.push({ label: t("menu.copyAbsolutePath"), onClick: () => void navigator.clipboard?.writeText(w.path).catch(() => {}) });
  if (!w.main) {
    const why = w.current ? t("worktrees.removeCurrent") : w.locked !== null ? t("worktrees.lockedWhy") : undefined;
    items.push("sep", { label: t("worktrees.removeMenu"), danger: true, disabled: !!why, title: why, onClick: () => void store.remove(path, w) });
  }
  if (list.some((x) => x.prunable)) items.push("sep", { label: t("worktrees.prune"), title: t("worktrees.pruneHint"), onClick: () => void store.prune(path) });
  return items;
}

export function WorktreesSection({ path, query, ui }: { path: string; query: string; ui: RepoUi }) {
  const { t } = useTranslation();
  const setUi = useApp((s) => s.setRepoUi);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const list = useWorktrees((s) => s.lists[path]?.list) ?? NONE;
  useEffect(() => useWorktrees.getState().load(path, refs), [path, refs]);

  // Rien que le dossier ouvert : pas de section (« Créer un worktree » est au clic droit
  // d'une branche ou d'un commit).
  if (list.length < 2) return null;
  const q = query.toLowerCase();
  const items = q ? list.filter((w) => worktreeName(w).toLowerCase().includes(q) || w.path.toLowerCase().includes(q)) : list;
  if (q && items.length === 0) return null;
  const open = q !== "" || !ui.collapsed.includes(WORKTREES_SECTION);
  const name = t("worktrees.section");
  const toggleOpen = () =>
    setUi(path, { ...ui, collapsed: open ? [...ui.collapsed, WORKTREES_SECTION] : ui.collapsed.filter((k) => k !== WORKTREES_SECTION) });

  return (
    <div className="side-group">
      <button
        className="section-h section-btn"
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        data-ti={`section:${WORKTREES_SECTION}`}
        onClick={toggleOpen}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: t(open ? "sidebar.collapse" : "sidebar.expand"), onClick: toggleOpen },
            { label: t("sidebar.hideSection"), onClick: () => setUi(path, { ...ui, hidden: [...ui.hidden, WORKTREES_SECTION] }) },
            ...(list.some((w) => w.prunable) ? ["sep" as const, { label: t("worktrees.prune"), onClick: () => void useWorktrees.getState().prune(path) }] : []),
          ])
        }
      >
        <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
        <span className="section-icon">
          <Icon name="folder" size={15} />
        </span>
        <span className="section-name">{name}</span>
        <span className="section-count">{list.length}</span>
      </button>
      {open && (
        <ResizableBlock layoutKey={sectionKey(WORKTREES_SECTION)} label={t("layout.section", { name })} className="side-content">
          <ul role="group" aria-label={name}>
            {items.map((w) => {
              const state = w.prunable ? t("worktrees.gone") : w.current ? t("worktrees.here") : w.main ? t("worktrees.main") : w.locked !== null ? t("worktrees.locked") : null;
              return (
                <li key={w.path}>
                  <button
                    className={w.current ? "side-item worktree-item current" : w.prunable ? "side-item worktree-item gone" : "side-item worktree-item"}
                    role="treeitem"
                    aria-level={2}
                    aria-current={w.current || undefined}
                    data-ti={`worktree:${w.path}`}
                    data-ti-parent={`section:${WORKTREES_SECTION}`}
                    style={{ "--depth": 0 } as React.CSSProperties}
                    title={[w.path, w.current ? t("worktrees.here") : w.prunable ? t("worktrees.goneHint") : t("worktrees.hint")].join("\n")}
                    onClick={() => {
                      if (!w.current && !w.prunable) useWorktrees.getState().open(w);
                    }}
                    onContextMenu={(e) => openContextMenu(e, worktreeMenu(t, path, w, list))}
                  >
                    <span className="side-label">{worktreeName(w)}</span>
                    <span className="side-meta">{[state, w.path.split("/").pop()].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ResizableBlock>
      )}
    </div>
  );
}
