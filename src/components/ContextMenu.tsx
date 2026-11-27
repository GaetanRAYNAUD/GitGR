// Menu contextuel de l'app (clic droit sur une branche, un commit…) : un seul ouvert à la
// fois, affiché par <ContextMenuHost /> à la position du clic.
//
// Clavier (motif menu WAI) : ↑ / ↓, Début / Fin, une lettre va à l'élément suivant qui commence
// par elle ; → ouvre un sous-menu, ← ou Échap le referme ; Tab ferme le menu. Un élément grisé
// reste atteignable aux flèches, sa raison lue avec lui (`aria-disabled`) ; un raccourci
// éventuel est affiché à droite.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useDismiss } from "../lib/useDismiss";
import { Icon } from "./Icon";

/** Raccourci d'une action, affiché à droite dans le menu. */
export interface MenuKeys {
  /** Tel qu'affiché (« Espace », « Ctrl+Maj+B »). */
  label: string;
  /** Pour `aria-keyshortcuts` (« Space », « Control+Shift+B »). */
  aria: string;
}

/** Élément qui lance une action. */
export interface MenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Infobulle (aussi sur un élément grisé : la raison). */
  title?: string;
  /** Choix exclusif : coche devant l'élément choisi. */
  checked?: boolean;
  /** Pastille de couleur devant le libellé (couleur CSS) ; `null` = cercle vide. */
  swatch?: string | null;
  /** Image ronde (avatar de profil) à la place de la pastille. */
  image?: string | null;
  /** Raccourci qui fait la même chose hors du menu. */
  keys?: MenuKeys;
}

/** Sous-menu : ouvert au survol, au clic ou avec → (← le referme). */
export interface MenuSub {
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  title?: string;
}

export type MenuItem = MenuAction | MenuSub | "sep";

export const isSub = (item: MenuItem): item is MenuSub => item !== "sep" && "items" in item;

interface MenuState {
  /** `label` : nom du menu pour les lecteurs d'écran (celui du bouton qui l'ouvre). */
  menu: { x: number; y: number; items: MenuItem[]; id: number; label?: string } | null;
  /** Position du dernier menu ouvert, gardée après sa fermeture (fenêtre ouverte par un
   *  élément du menu, à sa place). */
  at: { x: number; y: number };
  open(x: number, y: number, items: MenuItem[], label?: string): void;
  close(): void;
}

let seq = 0;

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  at: { x: 0, y: 0 },
  open: (x, y, items, label) => set({ menu: { x, y, items, id: ++seq, label }, at: { x, y } }),
  close: () => set({ menu: null }),
}));

/** Ouvre le menu à la position de l'événement (et empêche celui du navigateur). */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  if (items.length) useContextMenu.getState().open(e.clientX, e.clientY, items);
}

/** Ouvre le menu sous un bouton (menu déroulant), nommé comme lui. */
export function openMenuBelow(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  useContextMenu.getState().open(r.left, r.bottom + 4, items, el.getAttribute("aria-label") ?? undefined);
}

const MARGIN = 6;

/** Recherche à la frappe : sans accents ni casse. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Éléments du menu (pas ceux d'un sous-menu imbriqué), grisés compris. */
const entries = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLButtonElement>(":scope > button") ?? []);
const enabled = (b: HTMLButtonElement) => b.getAttribute("aria-disabled") !== "true";

interface ListProps {
  x: number;
  y: number;
  items: MenuItem[];
  label?: string;
  /** Sous-menu : nommé par l'élément qui l'ouvre. */
  labelledBy?: string;
  /** Sous-menu : `altX` = position à gauche du parent s'il déborde à droite. */
  altX?: number;
  /** Ferme ce sous-menu (← ou Échap) et rend le focus au parent. */
  onBack?: () => void;
  /** Focus sur le premier élément à l'ouverture (menu principal, ou sous-menu ouvert au clavier). */
  focusFirst: boolean;
  /** Le pointeur entre dans ce sous-menu (annule sa fermeture différée). */
  onEnter?: () => void;
}

/** Délai avant de fermer un sous-menu quand le pointeur passe sur un autre élément : le temps
 *  de le rejoindre en diagonale. */
const SUB_CLOSE_MS = 250;

function MenuList({ x, y, items, label, labelledBy, altX, onBack, focusFirst, onEnter }: ListProps) {
  const close = useContextMenu((s) => s.close);
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number; altX: number; focus: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const closeSubSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setSub(null), SUB_CLOSE_MS);
  };
  useEffect(() => cancelClose, []);

  // Reste dans la fenêtre : ouvert vers la gauche / le haut s'il déborderait.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, (altX ?? x) - width) : x;
    // Un sous-menu remonte juste ce qu'il faut ; le menu principal s'ouvre au-dessus du clic.
    const top =
      altX !== undefined
        ? Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN))
        : y + height + MARGIN > window.innerHeight
          ? Math.max(MARGIN, y - height)
          : y;
    setPos({ left, top });
    if (focusFirst) (entries(el).find(enabled) ?? entries(el)[0])?.focus();
  }, [x, y, altX, focusFirst]);

  const openSub = (index: number, el: HTMLElement, focus: boolean) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    setSub({ index, x: r.right + 2, y: r.top - 4, altX: r.left - 2, focus });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Touche venue d'un sous-menu (imbriqué) : c'est à lui de la traiter.
    if ((e.target as HTMLElement).parentElement !== e.currentTarget) return;
    const buttons = entries(ref.current);
    const current = document.activeElement as HTMLButtonElement;
    const i = buttons.indexOf(current);
    const go = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      go(i + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      go(e.key === "Home" ? 0 : buttons.length - 1);
    } else if (e.key === "ArrowRight" && current?.dataset.sub !== undefined && enabled(current)) {
      e.preventDefault();
      openSub(Number(current.dataset.sub), current, true);
    } else if ((e.key === "ArrowLeft" || e.key === "Escape") && onBack) {
      // Échap dans un sous-menu ne referme que lui (pas tout le menu, cf. useDismiss).
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      onBack();
    } else if (e.key === "Tab") {
      // Tab quitte le menu : il se ferme et rend le focus (cf. Menu).
      e.preventDefault();
      close();
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Recherche à la frappe : l'élément suivant qui commence par cette lettre.
      const k = fold(e.key);
      for (let n = 1; n <= buttons.length; n++) {
        const b = buttons[(i + n) % buttons.length];
        if (fold(b.querySelector(".menu-label")?.textContent ?? "").startsWith(k)) {
          e.preventDefault();
          b.focus();
          break;
        }
      }
    }
  };

  const subItem = sub ? items[sub.index] : undefined;

  return (
    <div
      className={altX === undefined ? "context-menu" : "context-menu submenu"}
      role="menu"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      ref={ref}
      style={pos}
      onKeyDown={onKeyDown}
      onMouseEnter={onEnter}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === "sep") return <div key={`sep${i}`} className="menu-sep" role="separator" />;
        if (isSub(item)) {
          return (
            <button
              key={`${i}:${item.label}`}
              id={`${uid}-s${i}`}
              role="menuitem"
              tabIndex={-1}
              aria-haspopup="menu"
              aria-expanded={sub?.index === i}
              aria-disabled={item.disabled || undefined}
              aria-description={item.disabled ? item.title : undefined}
              data-sub={i}
              className={sub?.index === i ? "menu-item has-sub open" : "menu-item has-sub"}
              title={item.title}
              onMouseEnter={(e) => {
                e.currentTarget.focus({ preventScroll: true });
                if (!item.disabled) openSub(i, e.currentTarget, false);
              }}
              onClick={(e) => !item.disabled && openSub(i, e.currentTarget, true)}
            >
              <span className="menu-label">{item.label}</span>
              <Icon name="chevron" size={13} className="menu-arrow" />
            </button>
          );
        }
        return (
          <button
            key={`${i}:${item.label}`}
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            tabIndex={-1}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            // La raison d'un élément grisé, lue avec lui (pas seulement en infobulle).
            aria-description={item.disabled ? item.title : undefined}
            aria-keyshortcuts={item.keys?.aria}
            className={item.danger ? "menu-item danger" : "menu-item"}
            // Libellé complet en infobulle quand il est coupé (nom de branche long).
            title={item.title ?? item.label}
            onMouseEnter={(e) => {
              // Le survol déplace le focus : un seul élément mis en avant à la fois.
              e.currentTarget.focus({ preventScroll: true });
              if (sub) closeSubSoon();
            }}
            onClick={() => {
              if (item.disabled) return;
              close();
              item.onClick();
            }}
          >
            {item.checked !== undefined && (
              <span className="menu-radio" aria-hidden="true">
                {item.checked && <Icon name="check" size={13} />}
              </span>
            )}
            {item.image ? (
              <img className="menu-avatar" src={item.image} alt="" aria-hidden="true" draggable={false} />
            ) : (
              item.swatch !== undefined && (
                <span className={item.swatch ? "menu-swatch" : "menu-swatch none"} style={item.swatch ? { background: item.swatch } : undefined} aria-hidden="true" />
              )
            )}
            <span className="menu-label">{item.label}</span>
            {item.keys && (
              <span className="menu-key" aria-hidden="true">
                {item.keys.label}
              </span>
            )}
          </button>
        );
      })}
      {sub && subItem && isSub(subItem) && (
        <MenuList
          key={sub.index}
          x={sub.x}
          y={sub.y}
          altX={sub.altX}
          items={subItem.items}
          labelledBy={`${uid}-s${sub.index}`}
          focusFirst={sub.focus}
          onEnter={cancelClose}
          onBack={() => {
            const index = sub.index;
            setSub(null);
            ref.current?.querySelector<HTMLButtonElement>(`:scope > button[data-sub="${index}"]`)?.focus();
          }}
        />
      )}
    </div>
  );
}

function Menu({ x, y, items, label }: { x: number; y: number; items: MenuItem[]; label?: string }) {
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useCallback(() => close(), [close]);
  useDismiss(ref, true, onClose);
  // Le focus revient à ce qui l'avait avant le menu (ouvert au clavier : la liste du graphe),
  // sauf si l'action choisie l'a déjà mis ailleurs.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const menu = ref.current;
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || !!menu?.contains(now);
      if (lost && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  // `display: contents` : le conteneur ne compte pas dans la mise en page, il sert aux clics extérieurs.
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <MenuList x={x} y={y} items={items} label={label} focusFirst />
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  return menu ? <Menu key={menu.id} x={menu.x} y={menu.y} items={menu.items} label={menu.label} /> : null;
}
