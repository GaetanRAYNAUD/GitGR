import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { repoColor, useApp } from "../store/app";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { SettingsMenu } from "./SettingsMenu";

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
  const tabsRef = useRef<HTMLDivElement>(null);
  const { dragging, onPointerDown } = useTabDrag(tabsRef);

  const nameOf = (path: string) => repos.find((r) => r.path === path)?.name ?? path;

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
          return (
            <div
              key={path}
              data-tab-path={path}
              className={["tab", on && "on", dragging === path && "dragged"].filter(Boolean).join(" ")}
              title={path}
              onAuxClick={(e) => e.button === 1 && closeTab(path)}
            >
              <button
                role="tab"
                aria-selected={on}
                className="tab-main"
                onClick={() => activate(path)}
                onPointerDown={(e) => onPointerDown(e, path)}
              >
                <span className="dot" style={{ background: repoColor(path) }} />
                <span className="tab-name">{name}</span>
              </button>
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

      <div className="titlebar-spacer" data-tauri-drag-region />

      <SettingsMenu />

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
