// Couleur fixe pour un nom de branche, choisie depuis le clic droit d'une branche (graphe,
// barre latérale) : petite fenêtre à la position du clic. Le choix s'enregistre tout de suite
// dans les règles de couleur (Réglages > Graphe) ; « A » retire la règle à ce nom exact.
// Entrée, Échap, un clic à côté ou le focus qui sort la ferment.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { DEFAULT_BRANCH_COLORS, exactRule, matchingRule, withExactColor, withoutExactColor } from "../lib/branchColors";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import type { ColorValue } from "../lib/types";
import { ColorChoice } from "./ColorChoice";

interface PopoverState {
  /** `back` : élément qui reprend le focus à la fermeture (celui du clic droit). */
  open: { x: number; y: number; name: string; back: HTMLElement | null; id: number } | null;
  show(x: number, y: number, name: string, back: HTMLElement | null): void;
  close(): void;
}

let seq = 0;

export const useBranchColorPopover = create<PopoverState>((set) => ({
  open: null,
  show: (x, y, name, back) => set({ open: { x, y, name, back, id: ++seq } }),
  close: () => set({ open: null }),
}));

const MARGIN = 6;

export function BranchColorPopoverHost() {
  const open = useBranchColorPopover((s) => s.open);
  // Changement d'écran (onglet, Réglages) au clavier : la fenêtre ne concerne plus ce qui est
  // affiché.
  const active = useApp((s) => s.active);
  const settingsOpen = useApp((s) => s.settingsOpen);
  useEffect(() => useBranchColorPopover.getState().close(), [active, settingsOpen]);
  return open ? <BranchColorPopover key={open.id} {...open} /> : null;
}

function BranchColorPopover({ x, y, name, back }: { x: number; y: number; name: string; back: HTMLElement | null }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const rules = useApp((s) => s.settings.branchColors) ?? DEFAULT_BRANCH_COLORS;
  const color = exactRule(rules, name)?.color;
  /** Motif qui colore déjà la branche sans règle à son nom exact (`release/*`…). */
  const inherited = color === undefined ? matchingRule(rules, name)?.pattern : undefined;
  const hintId = useId();
  const close = useCallback(() => {
    useBranchColorPopover.getState().close();
    if (back?.isConnected) back.focus();
  }, [back]);
  useDismiss(ref, true, close);

  // À la position du clic, sans sortir de la fenêtre ; focus sur la couleur choisie.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN)),
    });
    el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, [x, y]);

  const title = t("branchColors.fixedTitle", { name });
  const save = (c: ColorValue | undefined) =>
    useApp.getState().updateSettings({ branchColors: c === undefined ? withoutExactColor(rules, name) : withExactColor(rules, name, c) });
  return (
    <div
      className="color-popover bc-popover"
      role="dialog"
      aria-label={title}
      aria-describedby={hintId}
      ref={ref}
      style={pos}
      // La sélection suit le focus (flèches) : Entrée ne fait que fermer. Pas sur la pipette,
      // où elle ouvre le sélecteur du système.
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        close();
      }}
      // Tab hors de la fenêtre : elle se ferme (sans voler le focus à ce qui le prend).
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !e.currentTarget.contains(next)) useBranchColorPopover.getState().close();
      }}
    >
      <div className="bc-popover-title" title={title}>
        {title}
      </div>
      <ColorChoice value={color} label={title} auto={t("branchColors.fixedNone")} onChange={save} />
      <div className="bc-popover-hint" id={hintId}>
        {inherited && <div>{t("branchColors.fixedInherited", { pattern: inherited })}</div>}
        <div>{t("branchColors.fixedHint", { name })}</div>
      </div>
    </div>
  );
}
