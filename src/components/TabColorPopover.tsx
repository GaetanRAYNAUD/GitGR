// Couleur de la pastille d'un onglet : petite fenêtre sous l'onglet (clic droit → Couleur…).

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepoEntry } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { ColorChoice } from "./ColorChoice";

const MARGIN = 6;

export function TabColorPopover({ anchor, repo, onClose }: { anchor: HTMLElement | null; repo: RepoEntry; onClose: () => void }) {
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

  return (
    <div className="color-popover" role="dialog" aria-label={t("tabs.color")} ref={ref} style={pos}>
      <ColorChoice
        value={repo.color}
        label={t("tabs.color")}
        auto={t("tabs.colorAuto")}
        onChange={(c) => useApp.getState().setRepoColor(repo.path, c ?? null)}
      />
    </div>
  );
}
