// Section « Stashes » de la barre latérale : toute la pile (la plus récente en haut). Clic :
// le commit d'où part le stash dans le graphe ; clic droit : appliquer, pop, supprimer.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { relativeTime } from "../../lib/format";
import { sectionKey } from "../../lib/layout";
import { stashLabel } from "../../lib/stashes";
import type { RepoUi, StashEntry } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { usePullList } from "../../store/pullList";
import { closeCenterViews } from "../../store/range";
import { useStashList } from "../../store/stashes";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { ResizableBlock } from "../Splitter";

export const STASHES_SECTION = "stashes";

/** `onMissing` : le commit de départ n'est pas dans l'historique chargé. */
export function stashMenu(t: TFunction, path: string, s: StashEntry, onMissing: () => void): MenuItem[] {
  const ops = useOps.getState();
  const { text } = stashLabel(s.message);
  return [
    { label: t("stashes.apply"), onClick: () => void ops.applyStash(path, s.sha, false) },
    { label: t("stashes.pop"), onClick: () => void ops.applyStash(path, s.sha, true) },
    {
      label: t("stashes.showBase"),
      onClick: () =>
        void useGraph.getState().reveal(path, s.base).then((ok) => !ok && onMissing()),
    },
    { label: t("stashes.branch"), onClick: () => void ops.stashBranch(path, s.sha, text) },
    { label: t("stashes.renameMenu"), onClick: () => void ops.renameStash(path, s.sha, text) },
    "sep",
    { label: t("stashes.dropMenu"), danger: true, onClick: () => void ops.dropStash(path, s.sha, text) },
    "sep",
    { label: t("stashes.copy"), onClick: () => void navigator.clipboard?.writeText(text).catch(() => {}) },
  ];
}

/** Sélectionne le stash, comme un commit : le graphe revient (ses vues du milieu fermées),
 *  la ligne du stash est amenée à l'écran et son contenu va dans le panneau de droite. */
export function openStash(path: string, s: StashEntry) {
  usePullList.getState().close(path);
  closeCenterViews(path);
  useGraph.getState().closeDiff(path);
  // Sa ligne est dessinée au-dessus de son commit de départ : celui-ci d'abord chargé.
  void useGraph.getState().reveal(path, s.base).then(() => useGraph.getState().select(path, s.sha));
}

export function StashesSection({ path, query, ui }: { path: string; query: string; ui: RepoUi }) {
  const { t } = useTranslation();
  const setUi = useApp((s) => s.setRepoUi);
  const count = useGraph((s) => s.graphs[path]?.refs?.stashes ?? 0);
  const { list } = useStashList(path);
  /** Stash dont le commit de départ n'a pas été trouvé dans l'historique. */
  const [missing, setMissing] = useState<string | null>(null);

  if (!count) return null;
  const q = query.toLowerCase();
  const items = q ? list.filter((s) => s.message.toLowerCase().includes(q)) : list;
  if (q && items.length === 0) return null;
  const open = q !== "" || !ui.collapsed.includes(STASHES_SECTION);
  const name = t("stashes.section");
  const toggleOpen = () => setUi(path, { ...ui, collapsed: open ? [...ui.collapsed, STASHES_SECTION] : ui.collapsed.filter((k) => k !== STASHES_SECTION) });

  return (
    <div className="side-group">
      <button
        className="section-h section-btn"
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        data-ti={`section:${STASHES_SECTION}`}
        onClick={toggleOpen}
        onContextMenu={(e) =>
          openContextMenu(e, [
            { label: t(open ? "sidebar.collapse" : "sidebar.expand"), onClick: toggleOpen },
            { label: t("sidebar.hideSection"), onClick: () => setUi(path, { ...ui, hidden: [...ui.hidden, STASHES_SECTION] }) },
          ])
        }
      >
        <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
        <span className="section-icon">
          <Icon name="stash" size={15} />
        </span>
        <span className="section-name">{name}</span>
        <span className="section-count">{list.length || count}</span>
      </button>
      {open && (
        <ResizableBlock layoutKey={sectionKey(STASHES_SECTION)} label={t("layout.section", { name })} className="side-content">
          <ul role="group" aria-label={name}>
            {items.map((s) => {
              const { branch, text } = stashLabel(s.message);
              const r = relativeTime(s.time * 1000);
              return (
                <li key={s.sha}>
                  <button
                    className="side-item stash-item"
                    role="treeitem"
                    aria-level={2}
                    data-ti={`stash:${s.sha}`}
                    data-ti-parent={`section:${STASHES_SECTION}`}
                    style={{ "--depth": 0 } as React.CSSProperties}
                    title={missing === s.sha ? t("sidebar.notFound") : [s.message, t("stashes.hint")].join("\n")}
                    onClick={() => {
                      setMissing(null);
                      openStash(path, s);
                    }}
                    onContextMenu={(e) => openContextMenu(e, stashMenu(t, path, s, () => setMissing(s.sha)))}
                  >
                    <span className="side-label">{text}</span>
                    <span className="side-meta">{[branch, t(`time.${r.key}`, { count: r.count })].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {missing && (
            <p className="side-empty" role="status">
              {t("sidebar.notFound")}
            </p>
          )}
        </ResizableBlock>
      )}
    </div>
  );
}
