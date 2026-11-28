// Fenêtre « Publier sur GitHub / GitLab » : crée le dépôt distant (vide) sur un compte connecté
// — le compte lui-même, une organisation ou un groupe —, ajoute le remote, puis pousse la
// branche courante en configurant son suivi (`push -u` : ahead / behind tout de suite).
//
// Le dépôt distant est créé d'abord : si l'ajout du remote ou le push échoue ensuite, la fenêtre
// est déjà fermée (recommencer buterait sur « nom déjà pris ») et l'erreur s'affiche comme pour
// un push ordinaire.
//
// Clavier : Tab reste dans la fenêtre, Visibilité et Protocole se choisissent aux flèches ; un
// nom déjà pris remet le focus sur le nom, l'erreur sous le champ.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { validRemoteName } from "../lib/branchName";
import { repoUrl } from "../lib/clone";
import { errorMessage } from "../lib/errors";
import { trapTab } from "../lib/focusTrap";
import { onRadioGroupKeyDown } from "../lib/radioKeys";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { profileColor } from "../lib/profiles";
import { accountLabel, linkedAccounts, PROVIDER_NAMES } from "../lib/providers";
import { freeRemoteName, repoNameFromFolder, validRepoName } from "../lib/publish";
import type { Namespace } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { useOwnerAvatars } from "../store/avatars";
import { useGraph } from "../store/graph";
import { useOps } from "../store/ops";
import { activeProfile, useProfiles } from "../store/profiles";
import { usePublishDialog } from "../store/publish";
import { Icon } from "./Icon";
import { Picker, ProfileMark } from "./Picker";

type NamespaceState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; list: Namespace[] };

export function PublishDialogHost() {
  const open = usePublishDialog((s) => s.open);
  return open ? <PublishDialog key={open.id} path={open.path} /> : null;
}

const folderOf = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";

function PublishDialog({ path }: { path: string }) {
  const { t } = useTranslation();
  const close = usePublishDialog((s) => s.close);
  const ref = useRef<HTMLFormElement>(null);
  const profiles = useProfiles((s) => s.profiles);
  const active = useProfiles((s) => activeProfile(path, s));
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const accounts = useMemo(() => linkedAccounts(profiles), [profiles]);
  const taken = useMemo(() => (refs?.remotes ?? []).map((r) => r.name), [refs]);

  // Compte proposé : celui du profil actif du dépôt, sinon le premier.
  const [accountId, setAccountId] = useState(() => (accounts.find((l) => l.profile.id === active?.id) ?? accounts[0])?.account.id ?? "");
  const linked = accounts.find((l) => l.account.id === accountId) ?? null;
  const [namespaces, setNamespaces] = useState<NamespaceState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [namespace, setNamespace] = useState("");
  const [name, setName] = useState(() => repoNameFromFolder(folderOf(path)));
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [remote, setRemote] = useState(() => freeRemoteName(taken, linked?.account.kind ?? "origin"));
  /** Nom du remote saisi à la main : il ne suit plus le provider du compte choisi. */
  const [remoteTouched, setRemoteTouched] = useState(false);
  const [ssh, setSsh] = useState(!!linked?.profile.sshKey);
  const branch = refs?.headBranch ?? null;
  // Rien à pousser sans commit, ni sans branche (HEAD détachée).
  const canPush = !!branch && !!refs?.head;
  /** Case décochée par l'utilisateur (sinon cochée dès qu'il y a de quoi pousser). */
  const [noPush, setNoPush] = useState(false);
  const push = canPush && !noPush;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (!busy) close();
  }, [busy, close]);
  useDismiss(ref, true, cancel);
  useRestoreFocus();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    setNamespaces({ status: "loading" });
    api.listAccountNamespaces(accountId).then(
      (list) => {
        if (!live) return;
        setNamespaces({ status: "ready", list });
        setNamespace(list[0]?.id ?? "");
      },
      (e) => live && setNamespaces({ status: "error", error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [accountId, reload]);

  // « Nom déjà pris » (réponse du serveur) : dit sous le nom, comme une erreur de saisie.
  const nameError = name && !validRepoName(name) ? t("publish.invalidName") : error === "repo_exists" ? errorMessage(t, error) : null;
  const remoteError = !validRemoteName(remote) ? t("remotes.invalidName") : taken.includes(remote) ? t("remotes.exists") : null;
  const owner = namespaces.status === "ready" ? namespaces.list.find((n) => n.id === namespace) : undefined;
  const ownerPaths = useMemo(() => (namespaces.status === "ready" ? namespaces.list.map((n) => n.path) : []), [namespaces]);
  const avatars = useOwnerAvatars(linked?.account.kind ?? null, linked?.account.url ?? null, ownerPaths, linked?.account.id ?? null);
  const ready = !!linked && !!owner && !!name && !nameError && !remoteError && !busy;

  const submit = async () => {
    if (!ready || !linked) return;
    setBusy(true);
    setError(null);
    let created;
    try {
      created = await api.createAccountRepo(linked.account.id, { namespace, name, description, private: isPrivate });
    } catch (e) {
      setError(errorCode(e));
      setBusy(false);
      // Les champs, grisés pendant l'envoi, ont perdu le focus : retour au nom.
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }
    close();
    const web = created.httpUrl.replace(/\.git$/, "");
    const done = await useOps.getState().publish(path, remote, repoUrl(created, ssh), linked.profile.id, push);
    if (!done) {
      // Le dépôt distant existe déjà : le dire avec l'erreur (une nouvelle publication buterait
      // sur « nom déjà pris »). Rien si l'utilisateur a annulé (garde-fou du profil).
      const app = useApp.getState();
      if (app.error) useApp.setState({ error: t("publish.createdButFailed", { repo: created.fullName, url: web, error: errorMessage(t, app.error) }) });
      return;
    }
    useApp.getState().notify(t("publish.done", { repo: created.fullName }), false, [
      { label: t("pr.open"), onClick: () => void api.openUrl(web).catch(() => {}) },
      { label: t("pr.copy"), keep: true, onClick: () => void navigator.clipboard?.writeText(web).catch(() => {}) },
    ]);
  };

  const provider = linked ? PROVIDER_NAMES[linked.account.kind] : "";
  const noOwner = namespaces.status === "ready" && namespaces.list.length === 0;
  // Ce qui manque encore pour publier, dit à côté du bouton grisé.
  const why = busy || !linked ? null : namespaces.status === "loading" ? t("publish.whyLoading") : !owner ? null : !name ? t("publish.whyName") : null;

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog clone-dialog publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="publish-title">{t("publish.title")}</h2>

        {accounts.length === 0 ? (
          <div className="clone-empty">
            <p>{t("publish.noAccount")}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                close();
                useProfiles.getState().openPage();
              }}
            >
              {t("clone.manageAccounts")}
            </button>
          </div>
        ) : (
          linked && (
            <>
              <div className="input-field">
                <span>{t("clone.account")}</span>
                {accounts.length > 1 ? (
                  <Picker
                    label={t("clone.account")}
                    disabled={busy}
                    items={() =>
                      accounts.map((l) => ({
                        label: `${PROVIDER_NAMES[l.account.kind]} · ${accountLabel(l.account)} (${l.profile.name})`,
                        checked: l.account.id === accountId,
                        swatch: profileColor(l.profile),
                        image: l.profile.image,
                        onClick: () => {
                          setAccountId(l.account.id);
                          setSsh(!!l.profile.sshKey);
                          setError(null);
                          // Nom du remote proposé d'après le provider, tant qu'il n'a pas été saisi.
                          if (!remoteTouched) setRemote(freeRemoteName(taken, l.account.kind));
                        },
                      }))
                    }
                  >
                    <Icon name={linked.account.kind} size={15} />
                    <span className="picker-text">{accountLabel(linked.account)}</span>
                    <ProfileMark profile={linked.profile} />
                  </Picker>
                ) : (
                  <span className="clone-account">
                    <Icon name={linked.account.kind} size={15} />
                    <span className="picker-text">{accountLabel(linked.account)}</span>
                    <ProfileMark profile={linked.profile} />
                  </span>
                )}
              </div>

              <div className="publish-row">
                <div className="input-field publish-owner">
                  <span>{t("publish.owner")}</span>
                  {/* Un menu plutôt qu'un <select> : il montre l'avatar de chaque propriétaire. */}
                  <Picker
                    label={t("publish.owner")}
                    disabled={busy || namespaces.status !== "ready"}
                    items={() =>
                      namespaces.status === "ready"
                        ? namespaces.list.map((n) => ({
                            label: n.path,
                            checked: n.id === namespace,
                            image: avatars[n.path],
                            swatch: null,
                            onClick: () => setNamespace(n.id),
                          }))
                        : []
                    }
                  >
                    {owner && avatars[owner.path] ? (
                      <img className="picker-avatar" src={avatars[owner.path]!} alt="" draggable={false} />
                    ) : (
                      <Icon name={owner?.kind === "user" ? "user" : "folder"} size={15} />
                    )}
                    <span className="picker-text">{owner?.path ?? (namespaces.status === "loading" ? t("publish.loadingOwners") : "")}</span>
                  </Picker>
                </div>
                <span className="publish-slash" aria-hidden="true">
                  /
                </span>
                <label className="input-field publish-name">
                  <span>{t("publish.name")}</span>
                  <input
                    ref={nameRef}
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => {
                      // Espaces changés en « - », comme le font GitHub et GitLab.
                      setName(e.target.value.replace(/\s/g, "-"));
                      setError(null);
                    }}
                    onPaste={(e) => {
                      // Un nom collé perd ses blancs de début et de fin (retour à la ligne copié).
                      const text = e.clipboardData.getData("text");
                      if (text.trim() === text) return;
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? el.value.length;
                      const end = el.selectionEnd ?? start;
                      setName((el.value.slice(0, start) + text.trim() + el.value.slice(end)).replace(/\s/g, "-"));
                      setError(null);
                    }}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "publish-name-error" : undefined}
                  />
                </label>
              </div>
              {noOwner && (
                <p className="input-error" role="alert">
                  {t("publish.noOwner")}
                </p>
              )}
              {namespaces.status === "error" && (
                <p className="input-error" role="alert">
                  {errorMessage(t, namespaces.error)}{" "}
                  <button type="button" className="link" onClick={() => setReload((n) => n + 1)}>
                    {t("clone.retry")}
                  </button>
                </p>
              )}
              {nameError && (
                <p id="publish-name-error" className="input-error" role="alert">
                  {nameError}
                </p>
              )}

              <label className="input-field">
                <span>{t("publish.description")}</span>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} placeholder={t("publish.optional")} />
              </label>

              <div className="input-field">
                <span id="publish-visibility">{t("publish.visibility")}</span>
                <div className="segmented" role="radiogroup" aria-labelledby="publish-visibility" onKeyDown={onRadioGroupKeyDown}>
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      role="radio"
                      aria-checked={isPrivate === v}
                      tabIndex={isPrivate === v ? 0 : -1}
                      className={isPrivate === v ? "seg on" : "seg"}
                      disabled={busy}
                      onClick={() => setPrivate(v)}
                    >
                      <Icon name={v ? "lock" : "globe"} size={15} />
                      {t(v ? "publish.private" : "publish.public")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="publish-row">
                <label className="input-field publish-remote">
                  <span>{t("remotes.name")}</span>
                  <input
                    type="text"
                    value={remote}
                    onChange={(e) => {
                      setRemote(e.target.value.replace(/\s/g, "-"));
                      setRemoteTouched(true);
                    }}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!remoteError}
                    aria-describedby={remoteError ? "publish-remote-error" : undefined}
                  />
                </label>
                <div className="segmented clone-protocol publish-protocol" role="radiogroup" aria-label={t("clone.protocol")} onKeyDown={onRadioGroupKeyDown}>
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      role="radio"
                      aria-checked={ssh === v}
                      tabIndex={ssh === v ? 0 : -1}
                      className={ssh === v ? "seg on" : "seg"}
                      disabled={busy}
                      onClick={() => setSsh(v)}
                    >
                      {v ? "SSH" : "HTTPS"}
                    </button>
                  ))}
                </div>
              </div>
              {remoteError && (
                <p id="publish-remote-error" className="input-error" role="alert">
                  {remoteError}
                </p>
              )}

              <label className="menu-check">
                <input type="checkbox" checked={push} disabled={busy || !canPush} onChange={(e) => setNoPush(!e.target.checked)} />
                {branch ? t("publish.push", { branch, remote: remote || "origin" }) : t("publish.pushNone")}
              </label>
              {/* Case grisée : la raison lisible, pas seulement en infobulle. */}
              {!canPush && <p className="account-hint">{t(branch ? "publish.nothingToPush" : "errors.detached_head")}</p>}
              {/* Qui pousse, et comment : le profil du compte, sa clé SSH ou le jeton du compte. */}
              <p className="account-hint dialog-as">
                {t("publish.pushedBy")} <strong>{linked.profile.name}</strong>{" "}
                <span className="muted">
                  {ssh
                    ? linked.profile.sshKey
                      ? t("publish.viaSsh", { key: linked.profile.sshKey })
                      : t("publish.viaSshAgent")
                    : t("publish.viaHttps", { login: linked.account.login })}
                </span>
              </p>
              {owner && name && !nameError && (
                <p className="account-hint dest-line" title={`${owner.path}/${name}`}>
                  <span>{t("publish.destLabel", { provider })}</span>{" "}
                  <span className="mono path-tail">
                    <bdi>{`${owner.path}/${name}`}</bdi>
                  </span>
                </p>
              )}
            </>
          )
        )}

        {error && error !== "repo_exists" && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}
        {busy && (
          <p className="visually-hidden" role="status">
            {t("publish.publishing")}
          </p>
        )}
        <div className="dialog-actions">
          {why && (
            <span id="publish-why" className="dialog-why">
              {why}
            </span>
          )}
          <button type="button" className="btn" onClick={cancel} disabled={busy}>
            {t("confirm.cancel")}
          </button>
          {accounts.length > 0 && (
            <button type="submit" className="btn primary" disabled={!ready} aria-describedby={why ? "publish-why" : undefined}>
              {busy ? t("publish.publishing") : t("publish.submit")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
