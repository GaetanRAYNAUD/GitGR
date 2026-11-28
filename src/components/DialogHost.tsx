// Affiche la fenêtre de dialogue demandée par une action (cf. store/dialogs.ts). Comme les
// autres fenêtres : Tab y reste, le focus revient à la fermeture à ce qui l'avait.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDialogs, type ChoiceRequest, type InputRequest } from "../store/dialogs";
import { trapTab } from "../lib/focusTrap";
import { useDismiss } from "../lib/useDismiss";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { Icon } from "./Icon";

function ChoiceDialog({ request }: { request: ChoiceRequest }) {
  const { t } = useTranslation();
  const answer = useDialogs((s) => s.answer);
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDismiss(ref, true, () => answer(null));
  useRestoreFocus();
  const radio = request.radio;
  const [picked, setPicked] = useState(radio?.initial ?? "");
  const option = radio?.options.find((o) => o.id === picked);
  // Focus sur « Retour » : Entrée par réflexe ne lance rien. Avec un choix exclusif, sur
  // l'option proposée (les flèches changent d'option, rien ne part sans le bouton).
  useEffect(() => {
    if (radio) ref.current?.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    else cancelRef.current?.focus();
  }, [radio]);
  const danger = radio ? !!option?.danger : request.choices.some((c) => c.danger);
  return (
    <div className="overlay">
      <div
        className="dialog confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
      >
        <div className={danger ? "dialog-icon danger" : "dialog-icon"}>
          <Icon name="alert" />
        </div>
        <h2 id={`${id}-title`}>{request.title}</h2>
        <p id={`${id}-body`}>{request.body}</p>
        {radio && (
          <fieldset className="dialog-radios">
            <legend className="visually-hidden">{radio.label}</legend>
            {radio.options.map((o) => (
              <label key={o.id} className={o.id === picked ? "dialog-radio on" : "dialog-radio"}>
                <input type="radio" name={`${id}-radio`} value={o.id} checked={o.id === picked} onChange={() => setPicked(o.id)} aria-describedby={`${id}-${o.id}`} />
                <span className="dialog-radio-text">
                  <span className={o.danger ? "dialog-radio-label danger-text" : "dialog-radio-label"}>{o.label}</span>
                  <span id={`${id}-${o.id}`} className="dialog-radio-hint">
                    {o.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="dialog-actions">
          <button className="btn" ref={cancelRef} onClick={() => answer(null)}>
            {t("confirm.cancel")}
          </button>
          {option && (
            <button className={option.danger ? "btn danger" : "btn primary"} onClick={() => answer(option.id)}>
              {option.submit}
            </button>
          )}
          {!radio && request.choices.map((c, i) => (
            <button
              key={c.id}
              className={c.danger ? "btn danger" : i === request.choices.length - 1 ? "btn primary" : "btn"}
              onClick={() => answer(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InputDialog({ request }: { request: InputRequest }) {
  const { t } = useTranslation();
  const answer = useDialogs((s) => s.answer);
  const ref = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(request.initial);
  const [checked, setChecked] = useState(request.checkbox?.checked ?? false);
  const [touched, setTouched] = useState(false);
  const id = useId();
  // Un clic à côté ne jette pas une saisie commencée (Échap et « Retour » ferment toujours).
  const [edited, setEdited] = useState(false);
  useDismiss(
    ref,
    true,
    () => answer(null),
    () => !edited && answer(null),
  );
  useRestoreFocus();
  const [second, setSecond] = useState(request.second?.initial ?? "");
  const [picked, setPicked] = useState(() => new Set(request.picks?.checked ?? []));
  const pickItems = request.picks?.items ?? [];
  const allPicked = pickItems.length > 0 && pickItems.every((i) => picked.has(i.id));
  const error = request.validate?.(value.trim()) ?? null;
  const secondError = request.second?.validate?.(second.trim()) ?? null;
  const empty = value.trim() === "" || (!!request.second && !request.second.optional && second.trim() === "") || (!!request.picks && picked.size === 0);
  const invalid = !!error || !!secondError;
  // Pourquoi « Créer » (…) est grisé : un champ vide, ou rien de coché.
  const why = !empty
    ? null
    : value.trim() === ""
      ? t("dialog.fill", { label: request.label })
      : request.picks && picked.size === 0
        ? t("dialog.pickOne")
        : request.second
          ? t("dialog.fill", { label: request.second.label })
          : null;
  const mono = request.mono ? "mono" : undefined;

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={request.subtitle ? `${id}-sub` : undefined}
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
        onChange={() => setEdited(true)}
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (invalid || empty) return;
          answer({
            value: value.trim(),
            checked,
            ...(request.second ? { second: second.trim() } : {}),
            ...(request.picks ? { picked: pickItems.filter((i) => picked.has(i.id)).map((i) => i.id) } : {}),
          });
        }}
      >
        <h2 id={`${id}-title`}>{request.title}</h2>
        {request.subtitle && (
          <p id={`${id}-sub`} className="mono">
            {request.subtitle}
          </p>
        )}
        <label className="input-field">
          <span>{request.label}</span>
          <input
            autoFocus
            type={request.secret ? "password" : "text"}
            className={mono}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={touched && !!error}
            aria-describedby={touched && error ? `${id}-error` : undefined}
          />
        </label>
        {touched && error && (
          <p id={`${id}-error`} className="input-error" role="alert">
            {error}
          </p>
        )}
        {request.second && (
          <label className="input-field">
            <span>{request.second.label}</span>
            <input
              type="text"
              className={mono}
              value={second}
              placeholder={request.second.placeholder}
              onChange={(e) => {
                setSecond(e.target.value);
                setTouched(true);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched && !!secondError}
              aria-describedby={touched && !error && secondError ? `${id}-error2` : undefined}
            />
          </label>
        )}
        {touched && !error && secondError && (
          <p id={`${id}-error2`} className="input-error" role="alert">
            {secondError}
          </p>
        )}
        {request.picks && (
          <fieldset className="pick-list">
            <legend>
              <label className="menu-check">
                <input
                  type="checkbox"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allPicked && picked.size > 0;
                  }}
                  onChange={() => setPicked(new Set(allPicked ? [] : pickItems.map((i) => i.id)))}
                />
                {request.picks.label}
              </label>
            </legend>
            <ul>
              {pickItems.map((i) => (
                <li key={i.id}>
                  <label className="menu-check">
                    <input
                      type="checkbox"
                      checked={picked.has(i.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (!next.delete(i.id)) next.add(i.id);
                          return next;
                        })
                      }
                    />
                    <span className="mono pick-label" title={i.label}>
                      {i.label}
                    </span>
                    {i.hint && <span className="muted pick-hint">{i.hint}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {request.checkbox && (
          <label className="menu-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {request.checkbox.label}
          </label>
        )}
        <div className="dialog-actions">
          {why && (
            <span id={`${id}-why`} className="dialog-why">
              {why}
            </span>
          )}
          <button type="button" className="btn" onClick={() => answer(null)}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={empty || (touched && invalid)} aria-describedby={why ? `${id}-why` : undefined}>
            {request.submit}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogHost() {
  const current = useDialogs((s) => s.current);
  if (!current) return null;
  // `key` : une nouvelle demande repart d'un état neuf (valeur saisie, focus).
  return current.request.kind === "choice" ? (
    <ChoiceDialog key={current.id} request={current.request} />
  ) : (
    <InputDialog key={current.id} request={current.request} />
  );
}
