// Menu contextuel de l'app (clic droit sur une branche, un commit…) : un seul ouvert à la
// fois, affiché par <ContextMenuHost /> à la position du clic.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useDismiss } from "../lib/useDismiss";
import { Icon } from "./Icon";

export type MenuItem =
  | {
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Choix exclusif : coche devant l'élément choisi. */
      checked?: boolean;
      /** Pastille de couleur devant le libellé (couleur CSS) ; `null` = cercle vide. */
      swatch?: string | null;
    }
  | "sep";

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

function Menu({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const onClose = useCallback(() => close(), [close]);
  useDismiss(ref, true, onClose);

  // Reste dans la fenêtre : ouvert vers la gauche / le haut s'il déborderait.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x;
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y;
    setPos({ left, top });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className="context-menu" role="menu" ref={ref} style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={`sep${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={`${i}:${item.label}`}
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked}
            className={item.danger ? "menu-item danger" : "menu-item"}
            disabled={item.disabled}
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
            {item.swatch !== undefined && (
              <span className={item.swatch ? "menu-swatch" : "menu-swatch none"} style={item.swatch ? { background: item.swatch } : undefined} aria-hidden="true" />
            )}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  return menu ? <Menu key={menu.id} x={menu.x} y={menu.y} items={menu.items} /> : null;
}
