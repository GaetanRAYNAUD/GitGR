// Fenêtre « Publier sur GitHub / GitLab » : crée le dépôt distant (vide) sur un compte connecté
// — le compte lui-même, une organisation ou un groupe —, ajoute le remote, puis pousse la
// branche courante en configurant son suivi (`push -u` : ahead / behind tout de suite).
//
// Le dépôt distant est créé d'abord : si l'ajout du remote ou le push échoue ensuite, la fenêtre
// est déjà fermée (recommencer buterait sur « nom déjà pris ») et l'erreur s'affiche comme pour
// un push ordinaire.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { validRemoteName } from "../lib/branchName";
import { repoUrl } from "../lib/clone";
import { errorMessage } from "../lib/errors";
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

  const nameError = name && !validRepoName(name) ? t("publish.invalidName") : null;
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

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog clone-dialog publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        ref={ref}
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
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value.trim());
                      setError(null);
                    }}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!nameError}
                  />
                </label>
              </div>
              {namespaces.status === "error" && (
                <p className="input-error" role="alert">
                  {errorMessage(t, namespaces.error)}{" "}
                  <button type="button" className="link" onClick={() => setReload((n) => n + 1)}>
                    {t("clone.retry")}
                  </button>
                </p>
              )}
              {nameError && (
                <p className="input-error" role="alert">
                  {nameError}
                </p>
              )}

              <label className="input-field">
                <span>{t("publish.description")}</span>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} placeholder={t("publish.optional")} />
              </label>

              <div className="segmented" role="radiogroup" aria-label={t("publish.visibility")}>
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={isPrivate === v} className={isPrivate === v ? "seg on" : "seg"} disabled={busy} onClick={() => setPrivate(v)}>
                    <Icon name={v ? "lock" : "globe"} size={15} />
                    {t(v ? "publish.private" : "publish.public")}
                  </button>
                ))}
              </div>

              <div className="publish-row">
                <label className="input-field publish-remote">
                  <span>{t("remotes.name")}</span>
                  <input
                    type="text"
                    value={remote}
                    onChange={(e) => {
                      setRemote(e.target.value.trim());
                      setRemoteTouched(true);
                    }}
                    disabled={busy}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!!remoteError}
                  />
                </label>
                <div className="segmented clone-protocol publish-protocol" role="radiogroup" aria-label={t("clone.protocol")}>
                  {[true, false].map((v) => (
                    <button key={String(v)} type="button" role="radio" aria-checked={ssh === v} className={ssh === v ? "seg on" : "seg"} disabled={busy} onClick={() => setSsh(v)}>
                      {v ? "SSH" : "HTTPS"}
                    </button>
                  ))}
                </div>
              </div>
              {remoteError && (
                <p className="input-error" role="alert">
                  {remoteError}
                </p>
              )}

              <label className="menu-check" title={canPush ? undefined : t(branch ? "publish.nothingToPush" : "errors.detached_head")}>
                <input type="checkbox" checked={push} disabled={busy || !canPush} onChange={(e) => setNoPush(!e.target.checked)} />
                {branch ? t("publish.push", { branch, remote: remote || "origin" }) : t("publish.pushNone")}
              </label>
              {owner && name && !nameError && (
                <p className="account-hint mono clone-dest">{t("publish.dest", { provider, repo: `${owner.path}/${name}` })}</p>
              )}
            </>
          )
        )}

        {error && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel} disabled={busy}>
            {t("confirm.cancel")}
          </button>
          {accounts.length > 0 && (
            <button type="submit" className="btn primary" disabled={!ready}>
              {busy ? t("publish.publishing") : t("publish.submit")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
