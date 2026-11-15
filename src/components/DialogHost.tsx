// Affiche la fenêtre de dialogue demandée par une action (cf. store/dialogs.ts).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDialogs, type ChoiceRequest, type InputRequest } from "../store/dialogs";
import { useDismiss } from "../lib/useDismiss";
import { Icon } from "./Icon";

function ChoiceDialog({ request }: { request: ChoiceRequest }) {
  const { t } = useTranslation();
  const answer = useDialogs((s) => s.answer);
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDismiss(ref, true, () => answer(null));
  // Focus sur « Retour » : Entrée par réflexe ne lance rien.
  useEffect(() => cancelRef.current?.focus(), []);
  const danger = request.choices.some((c) => c.danger);
  return (
    <div className="overlay">
      <div className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body" ref={ref}>
        <div className={danger ? "dialog-icon danger" : "dialog-icon"}>
          <Icon name="alert" />
        </div>
        <h2 id="dlg-title">{request.title}</h2>
        <p id="dlg-body">{request.body}</p>
        <div className="dialog-actions">
          <button className="btn" ref={cancelRef} onClick={() => answer(null)}>
            {t("confirm.cancel")}
          </button>
          {request.choices.map((c, i) => (
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
  useDismiss(ref, true, () => answer(null));
  const [second, setSecond] = useState(request.second?.initial ?? "");
  const error = request.validate?.(value.trim()) ?? null;
  const secondError = request.second?.validate?.(second.trim()) ?? null;
  const empty = value.trim() === "" || (!!request.second && second.trim() === "");
  const invalid = !!error || !!secondError;

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!invalid && !empty) answer({ value: value.trim(), checked, ...(request.second ? { second: second.trim() } : {}) });
        }}
      >
        <h2 id="dlg-title">{request.title}</h2>
        {request.subtitle && <p className="mono">{request.subtitle}</p>}
        <label className="input-field">
          <span>{request.label}</span>
          <input
            autoFocus
            type={request.secret ? "password" : "text"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setTouched(true);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={touched && !!error}
            aria-describedby={touched && error ? "dlg-error" : undefined}
          />
        </label>
        {touched && error && (
          <p id="dlg-error" className="input-error" role="alert">
            {error}
          </p>
        )}
        {request.second && (
          <label className="input-field">
            <span>{request.second.label}</span>
            <input
              type="text"
              value={second}
              placeholder={request.second.placeholder}
              onChange={(e) => {
                setSecond(e.target.value);
                setTouched(true);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched && !!secondError}
            />
          </label>
        )}
        {touched && !error && secondError && (
          <p className="input-error" role="alert">
            {secondError}
          </p>
        )}
        {request.checkbox && (
          <label className="menu-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {request.checkbox.label}
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => answer(null)}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={empty || (touched && invalid)}>
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
