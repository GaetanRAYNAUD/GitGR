// Fenêtre « Connecter un compte » : provider (GitHub / GitLab), instance (vide : github.com /
// gitlab.com) et token personnel. Le token est vérifié par le backend avant d'être rangé dans le
// trousseau ; un refus s'affiche ici, la fenêtre reste ouverte. Pour github.com, « Se connecter
// avec GitHub » (OAuth, device flow) évite de créer un token : un code à saisir sur GitHub, puis
// GitGR demande le token jusqu'à la validation.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { trapTab } from "../lib/focusTrap";
import { onRadioGroupKeyDown } from "../lib/radioKeys";
import { DEFAULT_HOSTS, instance, instanceHost, instanceLabel, PROVIDER_NAMES, PROVIDERS, tokenPageUrl } from "../lib/providers";
import type { Account, DeviceStart, Profile, ProviderKind } from "../lib/types";
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
  /** Connexion OAuth en cours (code affiché, token demandé régulièrement). */
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [copied, setCopied] = useState(false);

  /** Abandonne la connexion OAuth en cours (le backend oublie son code). */
  const stopDevice = useCallback(() => {
    setDevice((d) => {
      if (d) api.githubDeviceCancel(d.flowId).catch(() => {});
      return null;
    });
  }, []);

  // Pendant la vérification, la fenêtre reste : l'appel ne s'annule pas, le compte serait
  // connecté après une « annulation ». Une connexion OAuth, elle, s'abandonne.
  const cancel = useCallback(() => {
    if (busy) return;
    stopDevice();
    onClose(null);
  }, [busy, onClose, stopDevice]);
  useDismiss(ref, true, cancel);

  const inst = instance(kind, url);
  const host = inst ? instanceLabel(inst.url) : DEFAULT_HOSTS[kind];
  // OAuth : github.com seulement (l'application GitGR n'existe pas sur GitHub Enterprise).
  const oauth = kind === "github" && !!inst && instanceHost(inst.url) === "github.com" && inst.url.startsWith("https://");

  // `onClose` change à chaque rendu du parent : lu par une référence, il ne relance pas les
  // demandes (une réponse en vol serait perdue, le compte lié sans que la fenêtre le sache).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Fenêtre fermée pendant une connexion OAuth : le backend oublie son code.
  const deviceRef = useRef<DeviceStart | null>(null);
  deviceRef.current = device;
  useEffect(
    () => () => {
      if (deviceRef.current) api.githubDeviceCancel(deviceRef.current.flowId).catch(() => {});
    },
    [],
  );

  // Demande le token à intervalles réguliers jusqu'à la validation sur GitHub.
  useEffect(() => {
    if (!device) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let interval = device.interval;
    const poll = async () => {
      try {
        const r = await api.githubDevicePoll(profile.id, device.flowId);
        if (!live) return;
        if (r.account) {
          deviceRef.current = null;
          useProfiles.getState().accountConnected(profile.id, r.account);
          closeRef.current(r.account);
          return;
        }
        if (r.interval) interval = r.interval;
        timer = setTimeout(poll, interval * 1000);
      } catch (e) {
        if (!live) return;
        setError(errorCode(e));
        setDevice(null);
      }
    };
    timer = setTimeout(poll, interval * 1000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [device, profile.id]);

  const startDevice = async () => {
    setBusy(true);
    setError(null);
    try {
      setDevice(await api.githubDeviceStart());
      setCopied(false);
    } catch (e) {
      setError(errorCode(e));
    } finally {
      setBusy(false);
    }
  };

  const openGithub = async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
    } catch {
      /* presse-papiers indisponible : le code reste affiché */
    }
    api.openUrl(device.verificationUri).catch(() => {});
  };

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

  // À l'ouverture, le focus entre dans la fenêtre : le champ du token, ou (connexion GitHub
  // proposée) le choix du provider, avant le bouton de connexion.
  useEffect(() => {
    if (!oauth) return;
    ref.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, []);

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acc-title"
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="acc-title">{t("profiles.accountDialogTitle", { profile: profile.name })}</h2>

        {device ? (
          <div className="oauth-device" role="status">
            <p>{t("profiles.accountOAuthCode")}</p>
            <strong className="mono oauth-code">
              {device.userCode}
            </strong>
            <button type="button" className="btn primary" onClick={openGithub}>
              <Icon name="github" size={15} />
              {t("profiles.accountOAuthOpen")}
            </button>
            <p className="account-hint">
              {copied ? `${t("profiles.accountOAuthCopied")} ` : ""}
              {t("profiles.accountOAuthWaiting")}
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={stopDevice}>
                {t("confirm.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="segmented" role="radiogroup" aria-label={t("profiles.accountProvider")} onKeyDown={onRadioGroupKeyDown}>
              {PROVIDERS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={k === kind}
                  tabIndex={k === kind ? 0 : -1}
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

            {oauth && (
              <div className="oauth-start">
                <button type="button" className="btn primary" disabled={busy} onClick={startDevice}>
                  <Icon name="github" size={15} />
                  {t("profiles.accountOAuth")}
                </button>
                <p className="account-hint">{t("profiles.accountOAuthHint")}</p>
                <p className="oauth-or">{t("profiles.accountOr")}</p>
              </div>
            )}

            <label className="input-field">
              <span>{t("profiles.accountToken")}</span>
              <input
                autoFocus={!oauth}
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
          </>
        )}
        {error && (
          <p id="acc-error" className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        {!device && (
          <div className="dialog-actions">
            <button type="button" className="btn" disabled={busy} onClick={cancel}>
              {t("confirm.cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={!inst || !token.trim() || busy}>
              {busy ? t("profiles.accountConnecting") : t("profiles.accountSubmit")}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
