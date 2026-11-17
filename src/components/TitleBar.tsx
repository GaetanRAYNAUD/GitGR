import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { repoColor, repoName, useApp } from "../store/app";
import { TabColorPopover } from "./TabColorPopover";
import { type MenuItem, openContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { NotificationsBell } from "./NotificationsBell";
import { Logo } from "./Logo";
import { useProfiles } from "../store/profiles";

/** Distance (px) à parcourir avant qu'un appui devienne un glisser. */
const DRAG_THRESHOLD = 5;

/** Réordonnancement des onglets au glisser-déposer, à la souris.
 *  Événements pointer plutôt que le drag & drop HTML5 : ce dernier est intercepté
 *  par Tauri sous Windows (dépôt de fichiers), et ceci donne un réordonnancement en direct. */
function useTabDrag(container: React.RefObject<HTMLDivElement | null>) {
  const [dragging, setDragging] = useState<string | null>(null);
  /** Retire les écouteurs du glisser en cours (aussi appelé au démontage). */
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent, path: string) => {
    if (e.button !== 0) return;
    stop.current?.();
    const startX = e.clientX;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
        moved = true;
        setDragging(path);
      }
      // Nouvelle position = nombre d'autres onglets dont le milieu est à gauche du pointeur.
      const others = Array.from(container.current?.querySelectorAll<HTMLElement>("[data-tab-path]") ?? []).filter(
        (el) => el.dataset.tabPath !== path,
      );
      const index = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 < ev.clientX;
      }).length;
      useApp.getState().moveTab(path, index);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stop.current = null;
      setDragging(null);
    };

    stop.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return { dragging, onPointerDown };
}

/** Barre de titre personnalisée : logo, onglets de dépôts, réglages, contrôles de fenêtre.
 *  `data-tauri-drag-region` rend les zones vides déplaçables (double-clic = agrandir). */
export function TitleBar() {
  const { t } = useTranslation();
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const repos = useApp((s) => s.repos);
  const activate = useApp((s) => s.activate);
  const closeTab = useApp((s) => s.closeTab);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const profilesOpen = useProfiles((s) => s.pageOpen);
  const tabsRef = useRef<HTMLDivElement>(null);
  const { dragging, onPointerDown } = useTabDrag(tabsRef);
  /** Onglet en cours de renommage (double-clic). */
  const [editing, setEditing] = useState<string | null>(null);
  /** Onglet dont on choisit la couleur (fenêtre sous l'onglet). */
  const [coloring, setColoring] = useState<string | null>(null);

  const repoOf = (path: string) => repos.find((r) => r.path === path);
  const nameOf = (path: string) => {
    const r = repoOf(path);
    return r ? repoName(r) : path;
  };

  const tabMenu = (path: string): MenuItem[] => {
    const r = repoOf(path);
    const { rename } = useApp.getState();
    return [
      { label: t("tabs.rename"), onClick: () => setEditing(path) },
      { label: t("tabs.originalName"), disabled: !r?.alias, onClick: () => rename(path, null) },
      { label: t("tabs.color"), onClick: () => setColoring(path) },
      "sep",
      { label: t("tabs.closeTab"), onClick: () => closeTab(path) },
    ];
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        className={active === null ? "brand on" : "brand"}
        aria-current={active === null ? "page" : undefined}
        onClick={() => activate(null)}
        title={`${t("tabs.home")} (Ctrl T)`}
        aria-label={t("tabs.home")}
      >
        <Logo size={20} tile={false} />
        <span>{t("app.name")}</span>
      </button>

      <div className={dragging ? "tabs dragging" : "tabs"} role="tablist" ref={tabsRef} data-tauri-drag-region>
        {tabs.map((path) => {
          const name = nameOf(path);
          const on = path === active;
          const Main = editing === path ? "div" : "button";
          return (
            <div
              key={path}
              data-tab-path={path}
              className={["tab", on && "on", dragging === path && "dragged"].filter(Boolean).join(" ")}
              title={path}
              onAuxClick={(e) => e.button === 1 && closeTab(path)}
              onContextMenu={(e) => openContextMenu(e, tabMenu(path))}
            >
              {/* Pendant le renommage, pas de <button> autour du champ (contenu interactif
                  imbriqué : clics et sélection du texte pris par le bouton). */}
              <Main
                role="tab"
                aria-selected={on}
                className="tab-main"
                onClick={editing === path ? undefined : () => activate(path)}
                onDoubleClick={() => setEditing(path)}
                onPointerDown={editing === path ? undefined : (e: ReactPointerEvent) => onPointerDown(e, path)}
              >
                <span className="dot" style={{ background: repoColor(path, repoOf(path)?.color) }} />
                {editing === path ? (
                  <input
                    className="tab-rename"
                    autoFocus
                    defaultValue={name}
                    placeholder={repoOf(path)?.name}
                    aria-label={t("tabs.rename")}
                    title={t("tabs.renameHint")}
                    size={Math.max(name.length, 4)}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = name;
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v !== name) useApp.getState().rename(path, v === repoOf(path)?.name ? null : v);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <span className="tab-name" title={t("tabs.renameHint")}>{name}</span>
                )}
              </Main>
              <button className="tab-close" aria-label={t("tabs.close", { name })} onClick={() => closeTab(path)}>
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}
        <button
          className="tab-new"
          aria-label={t("tabs.new")}
          title={`${t("tabs.new")} (Ctrl T)`}
          onClick={() => activate(null)}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      {coloring && repoOf(coloring) && (
        <TabColorPopover
          anchor={tabsRef.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(coloring)}"]`) ?? null}
          repo={repoOf(coloring)!}
          onClose={() => setColoring(null)}
        />
      )}

      <div className="titlebar-spacer" data-tauri-drag-region />

      <NotificationsBell />

      <button
        className={profilesOpen ? "wc on" : "wc"}
        aria-label={t("settings.accounts")}
        aria-pressed={profilesOpen}
        title={t("settings.accounts")}
        onClick={() => (profilesOpen ? useProfiles.getState().closePage() : useProfiles.getState().openPage())}
      >
        <Icon name="user" size={16} />
      </button>
      <button
        className={settingsOpen ? "wc on" : "wc"}
        aria-label={t("settings.title")}
        aria-pressed={settingsOpen}
        title={t("settings.title")}
        onClick={() => (settingsOpen ? useApp.getState().closeSettings() : useApp.getState().openSettings())}
      >
        <Icon name="settings" size={16} />
      </button>

      <div className="window-controls">
        <button className="wc" aria-label={t("window.minimize")} onClick={() => api.window.minimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="wc" aria-label={t("window.maximize")} onClick={() => api.window.toggleMaximize()}>
          <Icon name="maximize" size={13} />
        </button>
        <button className="wc wc-close" aria-label={t("window.close")} onClick={() => api.window.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  );
}
