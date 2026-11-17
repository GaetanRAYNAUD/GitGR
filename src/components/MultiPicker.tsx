// Choix multiple avec recherche (assignés, relecteurs, étiquettes d'une PR / MR) : les choix en
// pastilles, un champ qui filtre la liste en dessous. Fait pour des listes de milliers
// d'éléments : seuls les premiers résultats sont rendus.

import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface PickOption {
  id: string;
  label: string;
  /** Ligne secondaire (nom complet, description). */
  detail?: string | null;
  /** Pastille de couleur (`rrggbb`), pour les étiquettes. */
  color?: string | null;
}

/** Résultats affichés au plus (la recherche affine). */
const SHOWN = 50;

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Options qui correspondent à la recherche : celles qui commencent par elle d'abord. */
export function matchOptions(options: PickOption[], query: string): PickOption[] {
  const q = fold(query.trim());
  if (!q) return options;
  const starts: PickOption[] = [];
  const contains: PickOption[] = [];
  for (const o of options) {
    const label = fold(o.label);
    const detail = fold(o.detail ?? "");
    if (label.startsWith(q) || detail.startsWith(q)) starts.push(o);
    else if (label.includes(q) || detail.includes(q)) contains.push(o);
  }
  return [...starts, ...contains];
}

const swatch = (color: string | null | undefined) => (color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : undefined);

export function MultiPicker({
  label,
  options,
  selected,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  options: PickOption[];
  /** Identifiants choisis, dans l'ordre du choix. */
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const matches = useMemo(() => matchOptions(options, query), [options, query]);
  const shown = matches.slice(0, SHOWN);

  /** Choisit (ou retire) puis ferme la liste : elle ne reste pas par-dessus les champs
   *  suivants. Elle se rouvre en tapant, au clic ou avec ↓. */
  const toggle = (o: PickOption) => {
    onChange(selected.includes(o.id) ? selected.filter((x) => x !== o.id) : [...selected, o.id]);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.max(0, Math.min(shown.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      // Pas d'envoi du formulaire : Entrée choisit.
      e.preventDefault();
      if (open && shown[active]) toggle(shown[active]);
    } else if (e.key === "Backspace" && !query && selected.length) {
      onChange(selected.slice(0, -1));
    } else if (e.key === "Escape" && open) {
      // Ferme la liste, pas la fenêtre.
      e.nativeEvent.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="input-field mpick-field">
      <span id={`${id}-label`}>{label}</span>
      <div className={disabled ? "mpick disabled" : "mpick"}>
        {selected.map((sid) => {
          const o = byId.get(sid);
          const text = o?.label ?? sid;
          return (
            <span key={sid} className="mpick-chip">
              {swatch(o?.color) && <span className="mpick-dot" style={{ background: swatch(o?.color) }} />}
              {text}
              <button type="button" className="mpick-remove" disabled={disabled} aria-label={t("pr.remove", { name: text })} onClick={() => onChange(selected.filter((x) => x !== sid))}>
                ×
              </button>
            </span>
          );
        })}
        <input
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          value={query}
          placeholder={selected.length ? undefined : placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {open && (
        <ul className="mpick-list" role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`} aria-multiselectable="true">
          {shown.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={selected.includes(o.id)}
              className={i === active ? "mpick-option active" : "mpick-option"}
              // Le champ garde le focus (pas de blur, qui fermerait la liste avant le clic).
              onMouseDown={(e) => e.preventDefault()}
              // Au clic, pas au mousedown : la liste fermée, le relâchement du bouton tomberait
              // sur ce qui est dessous (un autre champ, « Retour »…).
              onClick={() => toggle(o)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mpick-check" aria-hidden="true">
                {selected.includes(o.id) ? "✓" : ""}
              </span>
              {swatch(o.color) && <span className="mpick-dot" style={{ background: swatch(o.color) }} />}
              <span className="mpick-label">{o.label}</span>
              {o.detail && <span className="mpick-detail">{o.detail}</span>}
            </li>
          ))}
          {matches.length > SHOWN && <li className="mpick-more">{t("pr.more", { count: matches.length - SHOWN })}</li>}
          {matches.length === 0 && <li className="mpick-more">{options.length ? t("pr.noMatch") : t("pr.noOptions")}</li>}
        </ul>
      )}
    </div>
  );
}
