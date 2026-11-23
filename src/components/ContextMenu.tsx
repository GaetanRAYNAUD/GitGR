// Menu contextuel de l'app (clic droit sur une branche, un commit…) : un seul ouvert à la
// fois, affiché par <ContextMenuHost /> à la position du clic.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useDismiss } from "../lib/useDismiss";
import { Icon } from "./Icon";

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
  menu: { x: number; y: number; items: MenuItem[]; id: number } | null;
  open(x: number, y: number, items: MenuItem[]): void;
  close(): void;
}

let seq = 0;

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items, id: ++seq } }),
  close: () => set({ menu: null }),
}));

/** Ouvre le menu à la position de l'événement (et empêche celui du navigateur). */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  if (items.length) useContextMenu.getState().open(e.clientX, e.clientY, items);
}

/** Ouvre le menu sous un bouton (menu déroulant). */
export function openMenuBelow(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  useContextMenu.getState().open(r.left, r.bottom + 4, items);
}

const MARGIN = 6;

interface ListProps {
  x: number;
  y: number;
  items: MenuItem[];
  /** Sous-menu : `altX` = position à gauche du parent s'il déborde à droite. */
  altX?: number;
  /** Ferme ce sous-menu (←) et rend le focus au parent. */
  onBack?: () => void;
  /** Focus sur le premier élément à l'ouverture (menu principal, ou sous-menu ouvert au clavier). */
  focusFirst: boolean;
  /** Le pointeur entre dans ce sous-menu (annule sa fermeture différée). */
  onEnter?: () => void;
}

/** Délai avant de fermer un sous-menu quand le pointeur passe sur un autre élément : le temps
 *  de le rejoindre en diagonale. */
const SUB_CLOSE_MS = 250;

function MenuList({ x, y, items, altX, onBack, focusFirst, onEnter }: ListProps) {
  const close = useContextMenu((s) => s.close);
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
    if (focusFirst) el.querySelector<HTMLButtonElement>(":scope > button:not(:disabled)")?.focus();
  }, [x, y, altX, focusFirst]);

  const openSub = (index: number, el: HTMLElement, focus: boolean) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    setSub({ index, x: r.right + 2, y: r.top - 4, altX: r.left - 2, focus });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Touche venue d'un sous-menu (imbriqué) : c'est à lui de la traiter. Pas de
    // `stopPropagation` : Échap doit encore atteindre `document` (fermeture du menu).
    if ((e.target as HTMLElement).parentElement !== e.currentTarget) return;
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)") ?? []);
    const current = document.activeElement as HTMLButtonElement;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = buttons.indexOf(current);
      buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "ArrowRight" && current?.dataset.sub !== undefined) {
      e.preventDefault();
      openSub(Number(current.dataset.sub), current, true);
    } else if (e.key === "ArrowLeft" && onBack) {
      e.preventDefault();
      onBack();
    }
  };

  const subItem = sub ? items[sub.index] : undefined;

  return (
    <div
      className={altX === undefined ? "context-menu" : "context-menu submenu"}
      role="menu"
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
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub?.index === i}
              data-sub={i}
              className={sub?.index === i ? "menu-item has-sub open" : "menu-item has-sub"}
              disabled={item.disabled}
              title={item.title}
              onMouseEnter={(e) => openSub(i, e.currentTarget, false)}
              onClick={(e) => openSub(i, e.currentTarget, true)}
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
            aria-checked={item.checked}
            className={item.danger ? "menu-item danger" : "menu-item"}
            disabled={item.disabled}
            title={item.title}
            onMouseEnter={() => sub && closeSubSoon()}
            onClick={() => {
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
            ) : item.swatch !== undefined && (
              <span className={item.swatch ? "menu-swatch" : "menu-swatch none"} style={item.swatch ? { background: item.swatch } : undefined} aria-hidden="true" />
            )}
            {item.label}
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

function Menu({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useCallback(() => close(), [close]);
  useDismiss(ref, true, onClose);
  // `display: contents` : le conteneur ne compte pas dans la mise en page, il sert aux clics extérieurs.
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <MenuList x={x} y={y} items={items} focusFirst />
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  return menu ? <Menu key={menu.id} x={menu.x} y={menu.y} items={menu.items} /> : null;
}
