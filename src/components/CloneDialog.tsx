// Fenêtre « Cloner un dépôt » : par URL (https, ssh, chemin local), ou choisi dans la liste des
// dépôts d'un compte GitHub / GitLab connecté. Dossier de destination (le dernier utilisé est
// proposé), nom du dossier tiré de l'URL, profil choisi d'office d'après les règles (sa clé SSH
// sert au clone, son identité au dépôt). Le dépôt cloné s'ouvre dans un onglet.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { filterRepos, joinPath, overallPercent, repoNameFromUrl, repoUrl, validFolderName } from "../lib/clone";
import { errorMessage } from "../lib/errors";
import { relativeTime } from "../lib/format";
import { parseRemote, profileColor, suggestProfile } from "../lib/profiles";
import { instanceLabel, PROVIDER_NAMES } from "../lib/providers";
import type { Account, CloneProgress, Profile, ProviderRepo, RepoList } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { useProfiles } from "../store/profiles";
import { type MenuItem, openMenuBelow } from "./ContextMenu";
import { Icon } from "./Icon";
import { ProfileAvatar } from "./ProfileAvatar";

type Mode = "url" | "account";

/** Un compte connecté et le profil qui le porte (le premier, s'il est lié à plusieurs). */
interface LinkedAccount {
  account: Account;
  profile: Profile;
}

type RepoState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; list: RepoList };

function linkedAccounts(profiles: Profile[]): LinkedAccount[] {
  const out: LinkedAccount[] = [];
  for (const profile of profiles) {
    for (const account of profile.accounts ?? []) {
      if (!out.some((l) => l.account.id === account.id)) out.push({ account, profile });
    }
  }
  return out;
}

const accountLabel = (a: Account) => `${a.login} · ${instanceLabel(a.url)}`;

/** Avatar du profil (image, sinon initiales sur sa couleur) ; cercle vide pour « aucun ». */
function ProfileMark({ profile }: { profile: Profile | null }) {
  if (!profile) return <span className="menu-swatch none" aria-hidden="true" />;
  return <ProfileAvatar profile={profile} className="picker-avatar" />;
}

/** Bouton de choix qui ouvre un menu (avatars des profils, ce qu'un <select> ne sait pas montrer). */
function Picker({ label, disabled, items, children }: { label: string; disabled?: boolean; items: () => MenuItem[]; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="pf-input picker"
      aria-label={label}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={() => ref.current && openMenuBelow(ref.current, items())}
    >
      <span className="picker-value">{children}</span>
      <Icon name="chevron" size={14} />
    </button>
  );
}

export function CloneDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLFormElement>(null);
  const profiles = useProfiles((s) => s.profiles);
  const home = useProfiles((s) => s.home);
  const settings = useApp((s) => s.settings);
  const accounts = useMemo(() => linkedAccounts(profiles), [profiles]);

  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(settings.cloneDir ?? home ?? "");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  /** Profil choisi à la main (`null` : aucun) ; `undefined` : celui proposé. */
  const [chosenProfile, setChosenProfile] = useState<string | null | undefined>(undefined);

  const [accountId, setAccountId] = useState(accounts[0]?.account.id ?? "");
  const [repos, setRepos] = useState<RepoState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProviderRepo | null>(null);
  const linked = accounts.find((l) => l.account.id === accountId) ?? null;
  const [ssh, setSsh] = useState(!!linked?.profile.sshKey);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  useDismiss(ref, true, cancel);

  // Liste des dépôts du compte choisi, lue à l'ouverture de l'onglet « compte ».
  useEffect(() => {
    if (mode !== "account" || !accountId) return;
    let live = true;
    setRepos({ status: "loading" });
    api.listAccountRepos(accountId).then(
      (list) => live && setRepos({ status: "ready", list }),
      (e) => live && setRepos({ status: "error", error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [mode, accountId, reload]);

  const cloneUrl = mode === "url" ? url.trim() : picked ? repoUrl(picked, ssh) : "";
  const folder = nameTouched ? name : repoNameFromUrl(cloneUrl);
  const dest = parent.trim() && folder ? joinPath(parent.trim(), folder) : "";

  // Profil proposé : celui du compte, sinon celui que les règles désignent (remote, ou dossier
  // de destination).
  const suggested = useMemo(() => {
    if (mode === "account" && linked) return linked.profile;
    return suggestProfile(profiles, { path: dest, remote: parseRemote(cloneUrl || null), home });
  }, [mode, linked, profiles, dest, cloneUrl, home]);
  const profileId = chosenProfile === undefined ? (suggested?.id ?? null) : chosenProfile;
  const profile = profiles.find((p) => p.id === profileId) ?? null;

  const nameValid = validFolderName(folder);
  const ready = !!cloneUrl && !!parent.trim() && nameValid && !busy;

  const browse = async () => {
    try {
      const dir = await api.pickFolder(t("clone.pickTitle"));
      if (dir) setParent(dir);
    } catch (e) {
      setError(errorCode(e));
    }
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    const unsubscribe = await api.onCloneProgress(setProgress).catch(() => () => {});
    const target = parent.trim();
    try {
      const path = await api.cloneRepo(cloneUrl, target, folder, profileId);
      useApp.getState().updateSettings({ cloneDir: target });
      // Profil du dépôt : celui choisi ici (y compris « aucun »), avant l'ouverture qui
      // lancerait sinon la sélection automatique.
      if (profiles.length) await useProfiles.getState().setActive(path, profileId);
      await useApp.getState().openPath(path);
      onClose();
    } catch (e) {
      setError(errorCode(e));
      setBusy(false);
    } finally {
      unsubscribe();
    }
  };

  const pick = (r: ProviderRepo) => {
    setPicked(r);
    setNameTouched(false);
    setError(null);
  };

  const visible = repos.status === "ready" ? filterRepos(repos.list.repos, query) : [];

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog clone-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-title"
        ref={ref}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="clone-title">{t("clone.title")}</h2>

        <div className="segmented" role="radiogroup" aria-label={t("clone.source")}>
          {(["url", "account"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              className={m === mode ? "seg on" : "seg"}
              disabled={busy}
              onClick={() => {
                setMode(m);
                // Le profil proposé change avec la source (règles ou profil du compte).
                setChosenProfile(undefined);
                setError(null);
              }}
            >
              <Icon name={m === "url" ? "link" : "cloud"} size={15} />
              {t(`clone.mode_${m}`)}
            </button>
          ))}
        </div>

        {mode === "url" && (
          <label className="input-field">
            <span>{t("clone.url")}</span>
            <input
              autoFocus
              type="text"
              className="mono"
              value={url}
              placeholder="https://github.com/… · git@gitlab.com:…"
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        )}

        {mode === "account" && accounts.length === 0 && (
          <div className="clone-empty">
            <p>{t("clone.noAccount")}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onClose();
                useProfiles.getState().openPage();
              }}
            >
              {t("clone.manageAccounts")}
            </button>
          </div>
        )}

        {mode === "account" && linked && (
          <>
            <div className="clone-account-row">
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
                        setPicked(null);
                        setSsh(!!l.profile.sshKey);
                        setChosenProfile(undefined);
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
              <label className="search">
                <Icon name="search" size={15} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("clone.search")}
                  aria-label={t("clone.search")}
                  disabled={busy}
                />
              </label>
            </div>

            <div className="clone-repos" role="listbox" aria-label={t("clone.repos")} aria-busy={repos.status === "loading"}>
              {repos.status === "loading" && <p className="empty">{t("clone.loading")}</p>}
              {repos.status === "error" && (
                <div className="empty" role="alert">
                  <p>{errorMessage(t, repos.error)}</p>
                  <button type="button" className="link" onClick={() => setReload((n) => n + 1)}>
                    {t("clone.retry")}
                  </button>
                </div>
              )}
              {repos.status === "ready" && visible.length === 0 && (
                <p className="empty">{repos.list.repos.length ? t("clone.noMatch", { q: query }) : t("clone.noRepos")}</p>
              )}
              {visible.map((r) => (
                <button
                  key={r.fullName}
                  type="button"
                  role="option"
                  aria-selected={picked?.fullName === r.fullName}
                  className={picked?.fullName === r.fullName ? "clone-repo on" : "clone-repo"}
                  disabled={busy}
                  onClick={() => pick(r)}
                  title={r.description ?? r.fullName}
                >
                  <span className="clone-repo-name">
                    {r.fullName}
                    {r.private && <span className="clone-tag">{t("clone.private")}</span>}
                    {r.fork && <span className="clone-tag">{t("clone.fork")}</span>}
                    {r.archived && <span className="clone-tag">{t("clone.archived")}</span>}
                  </span>
                  {r.description && <span className="clone-repo-desc">{r.description}</span>}
                  {r.updatedAt && (
                    <span className="clone-repo-when">
                      {(() => {
                        const rel = relativeTime(Date.parse(r.updatedAt));
                        return t(`time.${rel.key}`, { count: rel.count });
                      })()}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {repos.status === "ready" && repos.list.truncated && <p className="account-hint">{t("clone.truncated", { count: repos.list.repos.length })}</p>}

            <div className="segmented clone-protocol" role="radiogroup" aria-label={t("clone.protocol")}>
              {[true, false].map((v) => (
                <button key={String(v)} type="button" role="radio" aria-checked={ssh === v} className={ssh === v ? "seg on" : "seg"} disabled={busy} onClick={() => setSsh(v)}>
                  {v ? "SSH" : "HTTPS"}
                </button>
              ))}
            </div>
            {picked && (
              <p className="account-hint mono clone-url" title={cloneUrl}>
                {cloneUrl}
              </p>
            )}
          </>
        )}

        <div className="input-field">
          <span id="clone-parent-label">{t("clone.parent")}</span>
          <div className="pf-row">
            <input
              type="text"
              className="mono"
              aria-labelledby="clone-parent-label"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="btn" onClick={browse} disabled={busy}>
              {t("clone.browse")}
            </button>
          </div>
        </div>

        <label className="input-field">
          <span>{t("clone.name")}</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
              setError(null);
            }}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!folder && !nameValid}
          />
        </label>
        {folder && !nameValid ? (
          <p className="input-error" role="alert">
            {t("errors.invalid_folder_name")}
          </p>
        ) : (
          dest && <p className="account-hint mono clone-dest">{t("clone.dest", { path: dest })}</p>
        )}

        {profiles.length > 0 && (
          <div className="input-field">
            <span>{t("clone.profile")}</span>
            <Picker
              label={t("clone.profile")}
              disabled={busy}
              items={() => [
                ...profiles.map((p) => ({
                  label: p.id === suggested?.id ? t("clone.suggested", { name: p.name }) : p.name,
                  checked: p.id === profileId,
                  swatch: profileColor(p),
                  image: p.image,
                  onClick: () => setChosenProfile(p.id),
                })),
                { label: t("clone.noProfile"), checked: !profileId, swatch: null, onClick: () => setChosenProfile(null) },
              ]}
            >
              <ProfileMark profile={profile} />
              <span className="picker-text">
                {profile ? (profile.id === suggested?.id ? t("clone.suggested", { name: profile.name }) : profile.name) : t("clone.noProfile")}
              </span>
            </Picker>
          </div>
        )}

        {busy && (
          <div className="clone-progress" role="status">
            <span>{progress ? t(`clone.phase_${progress.phase}`) : t("clone.starting")}</span>
            <progress max={100} value={progress ? overallPercent(progress) : undefined} aria-label={t("clone.progress")} />
          </div>
        )}
        {error && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        <div className="dialog-actions">
          {busy ? (
            <button type="button" className="btn" onClick={() => api.cancelClone().catch(() => {})}>
              {t("clone.stop")}
            </button>
          ) : (
            <button type="button" className="btn" onClick={cancel}>
              {t("confirm.cancel")}
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy ? t("clone.cloning") : t("clone.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
