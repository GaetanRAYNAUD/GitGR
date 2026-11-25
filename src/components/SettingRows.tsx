// Lignes de réglage partagées par les pages de gestion (réglages, profils) : libellé à gauche,
// contrôle à droite, aide dessous (cf. DESIGN.md, « Lignes de réglage »).

import type { ReactNode } from "react";
import { onRadioGroupKeyDown, radioTabIndex } from "../lib/radioKeys";

/** Une ligne de réglage : libellé à gauche, contrôle à droite, aide dessous sur toute la
 *  largeur. */
export function Row({
  id,
  title,
  help,
  htmlFor,
  disabled,
  children,
}: {
  id: string;
  title: ReactNode;
  help?: ReactNode;
  /** Champ de saisie que le libellé désigne (un vrai `<label>`). */
  htmlFor?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "st-row off" : "st-row"}>
      {htmlFor ? (
        <label id={id} htmlFor={htmlFor} className="st-row-title">
          {title}
        </label>
      ) : (
        <span id={id} className="st-row-title">
          {title}
        </span>
      )}
      <div className="st-row-control">{children}</div>
      {help && (
        <p id={`${id}-help`} className="st-row-help">
          {help}
        </p>
      )}
    </div>
  );
}

/** Réglage oui / non : la case devant son libellé, l'aide dessous ; toute la ligne coche la
 *  case. */
export function Check({ id, title, help, checked, disabled, onChange }: { id: string; title: string; help?: ReactNode; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={disabled ? "st-check off" : "st-check"}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={id}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span id={id} className="st-row-title">
        {title}
      </span>
      {help && (
        <span id={`${id}-help`} className="st-row-help">
          {help}
        </span>
      )}
    </label>
  );
}

/** Choix exclusif : un seul arrêt de tabulation, les flèches changent l'option. L'aide de
 *  l'option choisie s'affiche dessous. */
export function Segmented<T extends string>({
  labelledBy,
  rowHelp,
  value,
  options,
  disabled,
  onChange,
}: {
  labelledBy: string;
  /** La ligne a une aide (`<labelledBy>-help`) : le groupe la cite aussi. */
  rowHelp?: boolean;
  value: T;
  options: { value: T; label: string; icon?: ReactNode; hint?: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  const hint = options.find((o) => o.value === value)?.hint;
  // Aide de la ligne (`rowHelp`) et aide de l'option choisie.
  const describedBy = [rowHelp ? `${labelledBy}-help` : "", hint ? `${labelledBy}-option` : ""].filter(Boolean).join(" ") || undefined;
  const anyChecked = options.some((o) => o.value === value);
  return (
    <>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onRadioGroupKeyDown}
      >
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={radioTabIndex(o.value === value, i === 0, anyChecked)}
            disabled={disabled}
            className={o.value === value ? "seg on" : "seg"}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      {hint && (
        <p id={`${labelledBy}-option`} className="st-option-help">
          {hint}
        </p>
      )}
    </>
  );
}
