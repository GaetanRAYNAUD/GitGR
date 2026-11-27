import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_REPO_UI } from "./graph/RefsSidebar";
import { useTranslation } from "react-i18next";
import { api, inTauri } from "../lib/api";
import { repoColor, repoName, useApp } from "../store/app";
import { TabColorPopover } from "./TabColorPopover";
import { type MenuItem, openContextMenu, openMenuBelow, useContextMenu } from "./ContextMenu";
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

/** macOS : le script de Tauri lance le déplacement natif dès l'appui sur la zone, et ce
 *  déplacement avale le relâchement : le double-clic n'arrive jamais (agrandir ne marche pas).
 *  Ici, les zones portent `data-mac-drag` à la place : le déplacement ne commence qu'une fois la
 *  souris bougée, et le double-clic agrandit / restaure la fenêtre comme une barre de titre macOS. */
const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
const dragRegion = isMac ? { "data-mac-drag": "" } : { "data-tauri-drag-region": "" };

function useMacDragRegion() {
  useEffect(() => {
    if (!inTauri || !isMac) return;
    let start: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target instanceof HTMLElement) || !e.target.hasAttribute("data-mac-drag")) return;
      e.preventDefault();
      if (e.detail === 2) {
        start = null;
        void api.window.toggleMaximize();
      } else start = { x: e.screenX, y: e.screenY };
    };
    const onMove = (e: MouseEvent) => {
      if (!start) return;
      if (!(e.buttons & 1)) start = null;
      else if (Math.hypot(e.screenX - start.x, e.screenY - start.y) >= DRAG_THRESHOLD) {
        start = null;
        void api.window.startDragging();
      }
    };
    const onUp = () => {
      start = null;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
}

/** Onglets plus larges que leur zone : défilement horizontal (la molette aussi), onglet actif
 *  ramené dans le champ, bords coupés en fondu et menu de tous les onglets. */
function useTabOverflow(container: React.RefObject<HTMLDivElement | null>, active: string | null, count: number) {
  const [edges, setEdges] = useState({ over: false, start: false, end: false });

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      const start = over && el.scrollLeft > 1;
      const end = over && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((p) => (p.over === over && p.start === start && p.end === end ? p : { over, start, end }));
    };
    // Molette verticale = défilement horizontal (la barre n'a pas de défilement vertical).
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    measure();
    // La rangée, et chaque onglet : un renommage change la largeur du contenu sans toucher à
    // celle de la rangée quand elle déborde déjà.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const tab of el.children) ro.observe(tab);
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
    };
  }, [container, count]);

  // Onglet actif (raccourci, sélecteur rapide, nouvel onglet) : toujours visible.
  useEffect(() => {
    if (!active) return;
    const tab = container.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(active)}"]`);
    tab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [container, active, count]);

  return edges;
}

/** Fenêtre agrandie : le bouton du milieu devient « Restaurer ». */
function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    void api.window.onMaximizedChange((m) => !gone && setMaximized(m)).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return maximized;
}

/** Barre de titre personnalisée : logo, onglets de dépôts, réglages, contrôles de fenêtre.
 *  Les zones vides déplacent la fenêtre (double-clic = agrandir), cf. `dragRegion`. */
export function TitleBar() {
  const { t } = useTranslation();
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const summaries = useApp((s) => s.summaries);
  const repos = useApp((s) => s.repos);
  const activate = useApp((s) => s.activate);
  const closeTab = useApp((s) => s.closeTab);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const profilesOpen = useProfiles((s) => s.pageOpen);
  const tabsRef = useRef<HTMLDivElement>(null);
  const { dragging, onPointerDown } = useTabDrag(tabsRef);
  const edges = useTabOverflow(tabsRef, active, tabs.length);
  const maximized = useMaximized();
  useMacDragRegion();
  /** Onglet en cours de renommage (F2, double-clic). */
  const [editing, setEditing] = useState<string | null>(null);
  /** Onglet dont on choisit la couleur (fenêtre sous l'onglet). */
  const [coloring, setColoring] = useState<string | null>(null);
  /** Onglet qui a le focus clavier (← / → le déplacent sans changer d'onglet actif) ; à défaut,
   *  l'arrêt de tabulation du groupe est l'onglet actif, ou le premier. */
  const [focused, setFocused] = useState<string | null>(null);
  /** Onglet à refocaliser une fois rendu (fin du renommage, fenêtre Couleur fermée, Suppr). */
  const refocus = useRef<string | null>(null);

  const stop = focused && tabs.includes(focused) ? focused : active && tabs.includes(active) ? active : tabs[0];

  const focusTab = (path: string) => {
    setFocused(path);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(path)}"] .tab-main`)?.focus();
  };

  useEffect(() => {
    const path = refocus.current;
    if (path === null || editing || coloring) return;
    refocus.current = null;
    if (tabs.includes(path)) focusTab(path);
    // Dernier onglet fermé au clavier : le focus passe à l'accueil plutôt qu'au vide.
    else if (path === "") document.querySelector<HTMLElement>(".titlebar .brand")?.focus();
  });

  const repoOf = (path: string) => repos.find((r) => r.path === path);
  const nameOf = (path: string) => {
    const r = repoOf(path);
    return r ? repoName(r) : path;
  };

  /** Auto-stash propre au dépôt : comme les réglages, toujours, jamais. */
  const autoStashSub = (path: string): MenuItem => {
    const app = useApp.getState();
    const ui = app.repoUi[path] ?? DEFAULT_REPO_UI;
    const own = ui.autoStash ?? null;
    const global = app.settings.autoStash ?? true;
    const choose = (v: boolean | null) => app.setRepoUi(path, { ...ui, autoStash: v });
    return {
      label: t("tabs.autoStash"),
      items: [
        { label: t(global ? "tabs.autoStashDefaultOn" : "tabs.autoStashDefaultOff"), checked: own === null, onClick: () => choose(null) },
        { label: t("tabs.autoStashOn"), checked: own === true, onClick: () => choose(true) },
        { label: t("tabs.autoStashOff"), checked: own === false, onClick: () => choose(false) },
      ],
    };
  };

  /** Ferme plusieurs onglets ; `keep` devient l'onglet actif si l'actif en fait partie. */
  const closeMany = (paths: string[], keep: string) => {
    if (paths.includes(useApp.getState().active ?? "")) activate(keep);
    for (const p of paths) closeTab(p);
  };

  const tabMenu = (path: string): MenuItem[] => {
    const r = repoOf(path);
    const { rename } = useApp.getState();
    const others = tabs.filter((p) => p !== path);
    const right = tabs.slice(tabs.indexOf(path) + 1);
    return [
      { label: t("tabs.rename"), onClick: () => setEditing(path) },
      {
        label: t("tabs.originalName"),
        disabled: !r?.alias,
        title: r?.alias ? undefined : t("tabs.originalNameNone"),
        onClick: () => rename(path, null),
      },
      { label: t("tabs.color"), onClick: () => setColoring(path) },
      autoStashSub(path),
      "sep",
      { label: t("tabs.closeTab"), onClick: () => closeTab(path) },
      { label: t("tabs.closeOthers"), disabled: others.length === 0, onClick: () => closeMany(others, path) },
      { label: t("tabs.closeRight"), disabled: right.length === 0, onClick: () => closeMany(right, path) },
    ];
  };

  /** Liste de tous les onglets (bouton au bout de la rangée quand elle déborde). */
  const allTabsMenu = (): MenuItem[] =>
    tabs.map((p) => ({
      label: nameOf(p),
      checked: p === active,
      swatch: repoColor(p, repoOf(p)?.color),
      onClick: () => activate(p),
    }));

  /** Clavier dans la rangée d'onglets : ← / → / Début / Fin déplacent le focus, Entrée / Espace
   *  activent (bouton), Suppr ferme, F2 renomme, Maj+F10 / touche Menu ouvrent le menu. */
  const onTabKeyDown = (e: ReactKeyboardEvent, path: string) => {
    const i = tabs.indexOf(path);
    let to: string | undefined;
    if (e.key === "ArrowRight") to = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") to = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") to = tabs[0];
    else if (e.key === "End") to = tabs[tabs.length - 1];
    else if (e.key === "Delete") {
      e.preventDefault();
      refocus.current = tabs[i + 1] ?? tabs[i - 1] ?? "";
      setFocused(null);
      closeTab(path);
      return;
    } else if (e.key === "F2") {
      e.preventDefault();
      setEditing(path);
      return;
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      useContextMenu.getState().open(box.left, box.bottom, tabMenu(path));
      return;
    } else return;
    e.preventDefault();
    if (to) focusTab(to);
  };

  return (
    <header className="titlebar" {...dragRegion}>
      <button
        className={active === null ? "brand on" : "brand"}
        aria-current={active === null ? "page" : undefined}
        onClick={() => activate(null)}
        title={`${t("tabs.home")} (Ctrl T)`}
        aria-label={`${t("tabs.home")} – ${t("app.name")}`}
      >
        <Logo size={20} tile={false} />
        <span>{t("app.name")}</span>
      </button>

      <div
        className={["tabs", dragging && "dragging", edges.start && "cut-start", edges.end && "cut-end"].filter(Boolean).join(" ")}
        role="tablist"
        aria-label={t("tabs.list")}
        ref={tabsRef}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null);
        }}
        {...dragRegion}
      >
        {tabs.map((path) => {
          const name = nameOf(path);
          const on = path === active;
          // Travail en attente (fichiers pas encore commités, commits à pousser / tirer) :
          // une marque sur la pastille, le détail dans l'infobulle.
          const sum = summaries[path]?.data;
          const pending = !!sum && sum.changes > 0;
          const sync = !!sum && (sum.ahead > 0 || sum.behind > 0);
          const state = [
            pending ? t("tabs.pending", { count: sum.changes }) : null,
            sync ? [sum.ahead ? `↑${sum.ahead}` : "", sum.behind ? `↓${sum.behind}` : ""].filter(Boolean).join(" ") : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const Main = editing === path ? "div" : "button";
          return (
            <div
              key={path}
              data-tab-path={path}
              className={["tab", on && "on", dragging === path && "dragged"].filter(Boolean).join(" ")}
              title={[path, state, t("tabs.renameHint")].filter(Boolean).join("\n")}
              onAuxClick={(e) => e.button === 1 && closeTab(path)}
              onContextMenu={(e) => openContextMenu(e, tabMenu(path))}
            >
              {/* Pendant le renommage, pas de <button> autour du champ (contenu interactif
                  imbriqué : clics et sélection du texte pris par le bouton). */}
              <Main
                role="tab"
                aria-selected={on}
                aria-description={state || undefined}
                tabIndex={editing === path ? undefined : path === stop ? 0 : -1}
                className="tab-main"
                onClick={editing === path ? undefined : () => activate(path)}
                onDoubleClick={() => setEditing(path)}
                onFocus={editing === path ? undefined : () => setFocused(path)}
                onKeyDown={editing === path ? undefined : (e: ReactKeyboardEvent) => onTabKeyDown(e, path)}
                onPointerDown={editing === path ? undefined : (e: ReactPointerEvent) => onPointerDown(e, path)}
              >
                <span
                  className={["dot", "tab-dot", pending && "pending", sync && "sync"].filter(Boolean).join(" ")}
                  style={{ background: repoColor(path, repoOf(path)?.color) }}
                />
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
                      if (e.key === "Enter") {
                        refocus.current = path;
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        refocus.current = path;
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
                  <span className="tab-name">{name}</span>
                )}
              </Main>
              {/* Hors tabulation : au clavier, Suppr ferme l'onglet qui a le focus. */}
              <button
                className="tab-close"
                tabIndex={-1}
                aria-label={t("tabs.close", { name })}
                title={`${t("tabs.closeTab")} (Ctrl W)`}
                onClick={() => closeTab(path)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {edges.over && (
        <button
          className="tab-new"
          aria-label={t("tabs.all")}
          aria-haspopup="menu"
          title={`${t("tabs.all")} (Ctrl E)`}
          onClick={(e) => openMenuBelow(e.currentTarget, allTabsMenu())}
        >
          <Icon name="chevron" size={15} />
        </button>
      )}
      <button className="tab-new" aria-label={t("tabs.new")} title={`${t("tabs.new")} (Ctrl T)`} onClick={() => activate(null)}>
        <Icon name="plus" size={15} />
      </button>

      {coloring && repoOf(coloring) && (
        <TabColorPopover
          anchor={tabsRef.current?.querySelector<HTMLElement>(`[data-tab-path="${CSS.escape(coloring)}"]`) ?? null}
          repo={repoOf(coloring)!}
          name={nameOf(coloring)}
          onClose={() => {
            refocus.current = coloring;
            setColoring(null);
          }}
        />
      )}

      <div className="titlebar-spacer" {...dragRegion} />

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
        <button className="wc" aria-label={t("window.minimize")} title={t("window.minimize")} onClick={() => api.window.minimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button
          className="wc"
          aria-label={t(maximized ? "window.restore" : "window.maximize")}
          title={t(maximized ? "window.restore" : "window.maximize")}
          onClick={() => api.window.toggleMaximize()}
        >
          <Icon name={maximized ? "restore" : "maximize"} size={13} />
        </button>
        <button className="wc wc-close" aria-label={t("window.close")} title={t("window.close")} onClick={() => api.window.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  );
}
