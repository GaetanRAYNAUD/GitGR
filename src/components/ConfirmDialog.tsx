// Fenêtre de confirmation pour les actions destructives (abandon de modifications…).

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDismiss } from "../lib/useDismiss";
import { Icon } from "./Icon";

export interface ConfirmAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Actions, de la moins à la plus engageante (la dernière est mise en avant). */
  actions: ConfirmAction[];
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDismiss(ref, true, onClose);
  // Focus sur « Retour » : Entrée par réflexe ne détruit rien.
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <div className="overlay">
      <div className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" ref={ref}>
        <div className="dialog-icon danger">
          <Icon name="alert" />
        </div>
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-body">{request.body}</p>
        <div className="dialog-actions">
          <button className="btn" ref={cancelRef} onClick={onClose}>
            {t("confirm.cancel")}
          </button>
          {request.actions.map((a) => (
            <button
              key={a.label}
              className={a.danger ? "btn danger" : "btn"}
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
