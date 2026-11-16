// Choix d'une couleur : les couleurs de la palette du graphe (`--g0`…), une couleur libre
// au sélecteur du système, et en option « automatique ».

import { useTranslation } from "react-i18next";
import { PALETTE_SIZE } from "../lib/graph";
import type { ColorValue } from "../lib/types";
import { Icon } from "./Icon";

/** Couleur de la palette en `#rrggbb` (point de départ du sélecteur). */
function paletteHex(index: number): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--g${index % PALETTE_SIZE}`).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#888888";
}

interface Props {
  /** `undefined` = automatique (seulement si `auto` est fourni). */
  value: ColorValue | undefined;
  onChange(color: ColorValue | undefined): void;
  /** Libellé de l'option « automatique » ; absente si non fourni. */
  auto?: string;
  label: string;
}

export function ColorChoice({ value, onChange, auto, label }: Props) {
  const { t } = useTranslation();
  const custom = typeof value === "string";
  return (
    <div className="color-choice" role="radiogroup" aria-label={label}>
      {auto !== undefined && (
        <button
          type="button"
          role="radio"
          aria-checked={value === undefined}
          aria-label={auto}
          title={auto}
          className="swatch swatch-auto"
          onClick={() => onChange(undefined)}
        >
          A
        </button>
      )}
      {Array.from({ length: PALETTE_SIZE }, (_, c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(`tabs.colors.${c}`)}
          title={t(`tabs.colors.${c}`)}
          className="swatch"
          style={{ background: `var(--g${c})` }}
          onClick={() => onChange(c)}
        />
      ))}
      {/* Le vrai sélecteur (input color) est invisible par-dessus la pastille. */}
      <label
        className={custom ? "swatch swatch-custom on" : "swatch swatch-custom"}
        title={t("colors.custom")}
        style={custom ? { background: value } : undefined}
      >
        <Icon name="pipette" size={12} />
        <input
          type="color"
          role="radio"
          aria-checked={custom}
          aria-label={t("colors.custom")}
          value={custom ? value : paletteHex(typeof value === "number" ? value : 0)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
