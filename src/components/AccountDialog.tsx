// Fenêtre « Connecter un compte » : provider (GitHub / GitLab), instance (vide : github.com /
// gitlab.com) et token personnel. Le token est vérifié par le backend avant d'être rangé dans le
// trousseau ; un refus s'affiche ici, la fenêtre reste ouverte.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { DEFAULT_HOSTS, instance, instanceLabel, PROVIDER_NAMES, PROVIDERS, tokenPageUrl } from "../lib/providers";
import type { Account, Profile, ProviderKind } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useProfiles } from "../store/profiles";
import { Icon } from "./Icon";

interface Props {
  profile: Profile;
  /** Compte à reconnecter : provider et instance déjà remplis. */
  initial?: Pick<Account, "kind" | "url"> | null;
  /** Compte connecté, ou `null` si la fenêtre est fermée sans rien faire. */
  onClose(account: Account | null): void;
}

export function AccountDialog({ profile, initial, onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<ProviderKind>(initial?.kind ?? "github");
  const [url, setUrl] = useState(initial ? instanceLabel(initial.url) : "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pendant la vérification, la fenêtre reste : l'appel ne s'annule pas, le compte serait
  // connecté après une « annulation ».
  const cancel = useCallback(() => {
    if (!busy) onClose(null);
  }, [busy, onClose]);
  useDismiss(ref, true, cancel);

  const inst = instance(kind, url);
  const host = inst ? instanceLabel(inst.url) : DEFAULT_HOSTS[kind];

  const submit = async () => {
    if (!inst || !token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onClose(await useProfiles.getState().connectAccount(profile.id, kind, url, token));
    } catch (e) {
      setError(errorCode(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acc-title"
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="acc-title">{t("profiles.accountDialogTitle", { profile: profile.name })}</h2>

        <div className="segmented" role="radiogroup" aria-label={t("profiles.accountProvider")}>
          {PROVIDERS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              className={k === kind ? "seg on" : "seg"}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
            >
              <Icon name={k} size={15} />
              {PROVIDER_NAMES[k]}
            </button>
          ))}
        </div>

        <label className="input-field">
          <span>{t("profiles.accountInstance")}</span>
          <input
            type="text"
            value={url}
            placeholder={DEFAULT_HOSTS[kind]}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!inst}
            aria-describedby="acc-instance-hint"
          />
        </label>
        <p id="acc-instance-hint" className={inst ? "account-hint" : "input-error"} role={inst ? undefined : "alert"}>
          {inst ? t(`profiles.accountInstanceHint_${kind}`) : t("profiles.accountInstanceInvalid")}
        </p>

        {inst?.url.startsWith("http://") && (
          <p className="account-hint warn" role="note">
            {t("profiles.accountInsecure")}
          </p>
        )}

        <label className="input-field">
          <span>{t("profiles.accountToken")}</span>
          <input
            autoFocus
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? "acc-error" : "acc-token-hint"}
          />
        </label>
        <p id="acc-token-hint" className="account-hint">
          <button type="button" className="link" disabled={!inst} onClick={() => inst && api.openUrl(tokenPageUrl(kind, inst.url)).catch(() => {})}>
            {t("profiles.accountTokenCreate", { host })}
          </button>
          <br />
          {t(`profiles.accountTokenHint_${kind}`)}
        </p>
        {error && (
          <p id="acc-error" className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={cancel}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!inst || !token.trim() || busy}>
            {busy ? t("profiles.accountConnecting") : t("profiles.accountSubmit")}
          </button>
        </div>
      </form>
    </div>
  );
}
