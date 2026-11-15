// Éditeur des couleurs fixes par nom de branche (réglage global).
// La première règle qui correspond l'emporte : l'ordre se change avec les flèches.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_BRANCH_COLORS } from "../lib/branchColors";
import { PALETTE_SIZE } from "../lib/graph";
import type { BranchColorRule } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { Icon } from "./Icon";

/** Couleur de la palette en `#rrggbb` (point de départ du sélecteur de couleur). */
function paletteHex(index: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--g${index % PALETTE_SIZE}`).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#888888";
}

export function BranchColorsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLFormElement>(null);
  const saved = useApp((s) => s.settings.branchColors);
  const [rules, setRules] = useState<BranchColorRule[]>(() => (saved ?? DEFAULT_BRANCH_COLORS).map((r) => ({ ...r })));
  /** Ligne ajoutée à l'instant : son champ prend le focus. */
  const [added, setAdded] = useState<number | null>(null);
  useDismiss(ref, true, onClose);

  const patch = (i: number, p: Partial<BranchColorRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) =>
    setRules((rs) => {
      const next = [...rs];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  return (
    <div className="overlay">
      <form
        className="dialog branch-colors-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bc-title"
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = rules.map((r) => ({ ...r, pattern: r.pattern.trim() })).filter((r) => r.pattern);
          useApp.getState().updateSettings({ branchColors: clean });
          onClose();
        }}
      >
        <h2 id="bc-title">{t("branchColors.title")}</h2>
        <p>{t("branchColors.help")}</p>
        <ul className="bc-rules">
          {rules.map((r, i) => (
            <li key={i} className="bc-rule">
              <input
                className="bc-pattern"
                autoFocus={i === added}
                value={r.pattern}
                placeholder="feature/*"
                aria-label={t("branchColors.pattern")}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => patch(i, { pattern: e.target.value })}
              />
              <div className="bc-swatches" role="radiogroup" aria-label={t("branchColors.color")}>
                {Array.from({ length: PALETTE_SIZE }, (_, c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={r.color === c}
                    aria-label={t(`tabs.colors.${c}`)}
                    title={t(`tabs.colors.${c}`)}
                    className="bc-swatch"
                    style={{ background: `var(--g${c})` }}
                    onClick={() => patch(i, { color: c })}
                  />
                ))}
                <label
                  className={typeof r.color === "string" ? "bc-swatch bc-custom on" : "bc-swatch bc-custom"}
                  title={t("branchColors.custom")}
                  style={typeof r.color === "string" ? { background: r.color } : undefined}
                >
                  <input
                    type="color"
                    aria-label={t("branchColors.custom")}
                    value={typeof r.color === "string" ? r.color : paletteHex(r.color)}
                    onChange={(e) => patch(i, { color: e.target.value })}
                  />
                </label>
              </div>
              <button type="button" className="icon-btn bc-up" disabled={i === 0} aria-label={t("branchColors.up")} onClick={() => move(i, -1)}>
                <Icon name="chevron" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn bc-down"
                disabled={i === rules.length - 1}
                aria-label={t("branchColors.down")}
                onClick={() => move(i, 1)}
              >
                <Icon name="chevron" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("branchColors.remove")}
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="bc-tools">
          <button type="button" className="btn" onClick={() => {
              setAdded(rules.length);
              setRules((rs) => [...rs, { pattern: "", color: rs.length % PALETTE_SIZE }]);
            }}>
            <Icon name="plus" size={14} />
            {t("branchColors.add")}
          </button>
          <button type="button" className="btn" onClick={() => setRules(DEFAULT_BRANCH_COLORS.map((r) => ({ ...r })))}>
            {t("branchColors.reset")}
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("profiles.cancel")}
          </button>
          <button type="submit" className="btn primary">
            {t("profiles.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
