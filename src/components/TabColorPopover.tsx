// Couleur de la pastille d'un onglet : petite fenêtre sous l'onglet (clic droit → Couleur…).

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepoEntry } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { ColorChoice } from "./ColorChoice";

const MARGIN = 6;

/** `name` : nom affiché de l'onglet (titre de la fenêtre). À la fermeture, le parent rend le
 *  focus à l'onglet. */
export function TabColorPopover({
  anchor,
  repo,
  name,
  onClose,
}: {
  anchor: HTMLElement | null;
  repo: RepoEntry;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: MARGIN, top: 40 });
  const close = useCallback(() => onClose(), [onClose]);
  useDismiss(ref, true, close);

  // Sous l'onglet, sans sortir de la fenêtre.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const w = el.getBoundingClientRect().width;
    setPos({ left: Math.max(MARGIN, Math.min(a.left, window.innerWidth - w - MARGIN)), top: a.bottom + 4 });
  }, [anchor]);

  // Focus sur le choix en cours (l'arrêt de tabulation du groupe) à l'ouverture.
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, []);

  return (
    <div className="color-popover" role="dialog" aria-label={t("tabs.colorOf", { name })} ref={ref} style={pos}>
      <ColorChoice
        value={repo.color}
        label={t("tabs.colorOf", { name })}
        auto={t("tabs.colorAuto")}
        onChange={(c) => useApp.getState().setRepoColor(repo.path, c ?? null)}
      />
    </div>
  );
}
