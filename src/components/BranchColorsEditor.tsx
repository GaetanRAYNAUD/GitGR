// Éditeur des couleurs fixes par nom de branche (page des paramètres ; l'aide est sur la
// ligne du réglage, au-dessus).
// La première règle qui correspond l'emporte : l'ordre se change avec les flèches.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_BRANCH_COLORS } from "../lib/branchColors";
import { PALETTE_SIZE } from "../lib/graph";
import type { BranchColorRule } from "../lib/types";
import { useApp } from "../store/app";
import { useDialogs } from "../store/dialogs";
import { ColorChoice } from "./ColorChoice";
import { Icon } from "./Icon";

/** Éditeur des règles, enregistrées à chaque changement (les lignes sans motif restent
 *  à l'écran mais ne sont pas enregistrées). */
export function BranchColorsEditor({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const saved = useApp((s) => s.settings.branchColors);
  const [rules, setRulesState] = useState<BranchColorRule[]>(() => (saved ?? DEFAULT_BRANCH_COLORS).map((r) => ({ ...r })));
  /** Ligne ajoutée à l'instant : son champ prend le focus. */
  const [added, setAdded] = useState<number | null>(null);

  const setRules = (next: BranchColorRule[]) => {
    setRulesState(next);
    const clean = next.map((r) => ({ ...r, pattern: r.pattern.trim() })).filter((r) => r.pattern);
    useApp.getState().updateSettings({ branchColors: clean });
  };
  const patch = (i: number, p: Partial<BranchColorRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setRules(next);
  };

  /** Retour aux règles de départ, après confirmation : les règles actuelles sont perdues. */
  const reset = async () => {
    const choice = await useDialogs.getState().choose({
      title: t("branchColors.resetTitle"),
      body: t("branchColors.resetBody"),
      choices: [{ id: "ok", label: t("branchColors.resetOk"), danger: true }],
    });
    if (choice === "ok") setRules(DEFAULT_BRANCH_COLORS.map((r) => ({ ...r })));
  };

  return (
    <fieldset className="bc-editor" disabled={disabled}>
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
              <ColorChoice
                value={r.color}
                label={t("branchColors.color")}
                onChange={(c) => c !== undefined && patch(i, { color: c })}
              />
              <button type="button" className="icon-btn bc-up" disabled={i === 0} aria-label={t("branchColors.up")} title={t("branchColors.up")} onClick={() => move(i, -1)}>
                <Icon name="chevron" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn bc-down"
                disabled={i === rules.length - 1}
                aria-label={t("branchColors.down")}
                title={t("branchColors.down")}
                onClick={() => move(i, 1)}
              >
                <Icon name="chevron" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("branchColors.remove")}
                title={t("branchColors.remove")}
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="bc-tools">
          <button type="button" className="btn" onClick={() => {
              setAdded(rules.length);
              setRules([...rules, { pattern: "", color: rules.length % PALETTE_SIZE }]);
            }}>
            <Icon name="plus" size={14} />
            {t("branchColors.add")}
          </button>
          <button type="button" className="btn" onClick={() => void reset()}>
            {t("branchColors.reset")}
          </button>
        </div>
    </fieldset>
  );
}
