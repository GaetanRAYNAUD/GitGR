// Champ texte avec suggestions (branche cible d'une PR / MR…) : on tape librement, la liste
// sous le champ filtre les valeurs connues. À la place de <datalist>, qui prend le style du
// système et ignore les thèmes de l'app.
//
// Clavier (combobox WAI) : ↓ / ↑ ouvrent la liste et passent d'une suggestion à l'autre,
// Entrée choisit la suggestion active (sans envoyer le formulaire), Échap ferme la liste
// (pas la fenêtre).

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { matchOptions, placeList } from "./MultiPicker";

const SHOWN = 50;

export function ComboField({
  label,
  value,
  onChange,
  options,
  disabled,
  mono,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  disabled?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  const fieldRef = useRef<HTMLLabelElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** Tant qu'on n'a pas tapé, toutes les suggestions (pas seulement celles qui ressemblent à la valeur). */
  const [typed, setTyped] = useState(false);
  const shown = useMemo(() => {
    const all = options.map((o) => ({ id: o, label: o }));
    return (typed ? matchOptions(all, value) : all).slice(0, SHOWN);
  }, [options, value, typed]);
  const [place, setPlace] = useState({ up: false, max: 200 });

  // Sous le champ s'il y a la place, sinon au-dessus (comme les choix multiples).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!open || !field) return;
    let clip: HTMLElement | null = field.parentElement;
    while (clip && !/(auto|scroll|hidden)/.test(getComputedStyle(clip).overflowY)) clip = clip.parentElement;
    const a = clip?.getBoundingClientRect();
    setPlace(placeList(field.getBoundingClientRect(), { top: Math.max(0, a?.top ?? 0), bottom: Math.min(window.innerHeight, a?.bottom ?? window.innerHeight) }));
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setTyped(false);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = shown.length;
      if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter" && open && shown[active]) {
      e.preventDefault();
      pick(shown[active].label);
    } else if (e.key === "Escape" && open) {
      // Ferme la liste, pas la fenêtre.
      e.nativeEvent.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <label ref={fieldRef} className={["input-field mpick-field", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <input
        role="combobox"
        className={mono ? "pf-input mono" : "pf-input"}
        aria-expanded={open && shown.length > 0}
        aria-controls={open && shown.length ? `${id}-list` : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-o${active}` : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {open && shown.length > 0 && (
        <ul className={place.up ? "mpick-list up" : "mpick-list"} style={{ maxHeight: place.max }} role="listbox" id={`${id}-list`} aria-label={label}>
          {shown.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={o.label === value}
              className={i === active ? "mpick-option active" : "mpick-option"}
              // Le champ garde le focus (pas de blur avant le clic).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.label)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="mpick-check" aria-hidden="true">
                {o.label === value ? "✓" : ""}
              </span>
              <span className={mono ? "mpick-label mono" : "mpick-label"}>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
