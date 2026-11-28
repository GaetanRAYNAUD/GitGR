// Fenêtre « Cloner un dépôt » : par URL (https, ssh, chemin local), ou choisi dans la liste des
// dépôts d'un compte GitHub / GitLab connecté. Dossier de destination (le dernier utilisé est
// proposé), nom du dossier tiré de l'URL, profil choisi d'office d'après les règles (sa clé SSH
// sert au clone, son identité au dépôt). Le dépôt cloné s'ouvre dans un onglet.
//
// Clavier : Tab reste dans la fenêtre ; Source et Protocole se choisissent aux flèches. Les
// dépôts du compte forment un arbre à une tabulation (propriétaires, puis leurs dépôts) :
// ↑ / ↓ (le dépôt suit), ← / → replient ou déplient un propriétaire, Début / Fin. Depuis la
// recherche, ↓ va à l'arbre et Entrée choisit le premier dépôt trouvé.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { filterRepos, groupByOwner, joinPath, overallPercent, repoNameFromUrl, repoShortName, repoUrl, validFolderName } from "../lib/clone";
import { errorMessage } from "../lib/errors";
import { trapTab } from "../lib/focusTrap";
import { onRadioGroupKeyDown } from "../lib/radioKeys";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { relativeTime } from "../lib/format";
import { parseRemote, profileColor, suggestProfile } from "../lib/profiles";
import { accountLabel, linkedAccounts, PROVIDER_NAMES } from "../lib/providers";
import type { Account, CloneProgress, ProviderRepo, RepoList } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { useOwnerAvatar } from "../store/avatars";
import { useProfiles } from "../store/profiles";
import { Icon } from "./Icon";
import { Picker, ProfileMark } from "./Picker";

type Mode = "url" | "account";

type RepoState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; list: RepoList };

/** Ligne de l'arbre des dépôts : un propriétaire ou l'un de ses dépôts. */
type Row = { kind: "owner"; key: string; owner: string } | { kind: "repo"; key: string; owner: string; repo: ProviderRepo };

/** Avatar du propriétaire (compte, organisation, groupe) en tête de sa section. */
function OwnerAvatar({ account, owner }: { account: Account | null; owner: string }) {
  const avatar = useOwnerAvatar(account?.kind ?? null, account?.url ?? null, owner, account?.id ?? null);
  return avatar ? <img className="owner-avatar" src={avatar} alt="" draggable={false} /> : null;
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
  useRestoreFocus();
  const treeRef = useRef<HTMLDivElement>(null);
  /** Ligne active de l'arbre des dépôts (clé de `Row`). */
  const [activeRow, setActiveRow] = useState<string | null>(null);

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
  const groups = groupByOwner(visible, linked?.account.login ?? "");
  /** Propriétaires repliés (casse ignorée). Pendant une recherche, tout est déplié : les
   *  dépôts trouvés restent visibles. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = (owner: string) => !query.trim() && collapsed.has(owner.toLowerCase());
  const toggleOwner = (owner: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const key = owner.toLowerCase();
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Arbre à plat, dans l'ordre affiché : chaque propriétaire puis ses dépôts dépliés.
  const rows: Row[] = groups.flatMap((g): Row[] => [
    { kind: "owner", key: `o:${g.owner}`, owner: g.owner },
    ...(isCollapsed(g.owner) ? [] : g.repos.map((repo): Row => ({ kind: "repo", key: `r:${repo.fullName}`, owner: g.owner, repo }))),
  ]);
  const wanted = activeRow ?? (picked ? `r:${picked.fullName}` : null);
  const at = Math.max(
    0,
    rows.findIndex((r) => r.key === wanted),
  );
  const rowIndex = (key: string) => rows.findIndex((r) => r.key === key);
  const goRow = (i: number) => {
    const r = rows[i];
    if (!r) return;
    setActiveRow(r.key);
    if (r.kind === "repo") pick(r.repo);
    requestAnimationFrame(() => document.getElementById(`clone-row-${i}`)?.scrollIntoView({ block: "nearest" }));
  };
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (busy || !rows.length) return;
    const r = rows[at];
    const page = 8;
    const go: Record<string, () => void> = {
      ArrowDown: () => goRow(Math.min(rows.length - 1, at + 1)),
      ArrowUp: () => goRow(Math.max(0, at - 1)),
      PageDown: () => goRow(Math.min(rows.length - 1, at + page)),
      PageUp: () => goRow(Math.max(0, at - page)),
      Home: () => goRow(0),
      End: () => goRow(rows.length - 1),
      ArrowRight: () => {
        if (r.kind === "owner") {
          if (isCollapsed(r.owner)) toggleOwner(r.owner);
          else goRow(at + 1);
        }
      },
      ArrowLeft: () => {
        if (r.kind === "repo") goRow(rowIndex(`o:${r.owner}`));
        else if (!isCollapsed(r.owner)) toggleOwner(r.owner);
      },
      Enter: () => (r.kind === "owner" ? toggleOwner(r.owner) : pick(r.repo)),
      " ": () => (r.kind === "owner" ? toggleOwner(r.owner) : pick(r.repo)),
    };
    const action = go[e.key];
    if (!action || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    action();
  };
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && query) {
      // Échap vide d'abord la recherche, sans fermer la fenêtre.
      e.nativeEvent.stopPropagation();
      setQuery("");
      setActiveRow(null);
    } else if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      treeRef.current?.focus();
    } else if (e.key === "Enter") {
      // Entrée dans la recherche choisit le premier dépôt trouvé (sans lancer le clone).
      e.preventDefault();
      const first = rows.findIndex((r) => r.kind === "repo");
      if (first >= 0) goRow(first);
    }
  };

  // Ce qui manque encore pour cloner, dit à côté du bouton grisé.
  const why = busy
    ? null
    : !cloneUrl
      ? mode === "url"
        ? t("clone.whyUrl")
        : linked
          ? t("clone.whyRepo")
          : null
      : !parent.trim()
        ? t("clone.whyParent")
        : !folder
          ? t("clone.whyName")
          : null;

  /** Où cloner (dossier, nom) et avec quel profil : à droite des dépôts, ou sous l'URL. */
  const destFields = (
    <>
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
          aria-describedby={folder && !nameValid ? "clone-name-error" : dest ? "clone-dest" : undefined}
        />
      </label>
      {folder && !nameValid ? (
        <p id="clone-name-error" className="input-error" role="alert">
          {t("errors.invalid_folder_name")}
        </p>
      ) : (
        dest && (
          <p id="clone-dest" className="account-hint dest-line" title={dest}>
            <span>{t("clone.destLabel")}</span>{" "}
            <span className="mono path-tail">
              <bdi>{dest}</bdi>
            </span>
          </p>
        )
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
    </>
  );

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog clone-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-title"
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="clone-title">{t("clone.title")}</h2>

        <div className="segmented" role="radiogroup" aria-label={t("clone.source")} onKeyDown={onRadioGroupKeyDown}>
          {(["url", "account"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              tabIndex={m === mode ? 0 : -1}
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
              placeholder={t("clone.urlPlaceholder")}
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

        {/* Depuis un compte : deux colonnes, la liste des dépôts à gauche (toute la hauteur),
            où et comment le cloner à droite. */}
        {mode === "account" && linked ? (
          <div className="dialog-cols">
            <div className="dialog-col clone-pick">
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
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveRow(null);
                      }}
                      onKeyDown={onSearchKey}
                      placeholder={t("clone.search")}
                      aria-label={t("clone.search")}
                      disabled={busy}
                    />
                  </label>
                </div>

                {/* États (chargement, erreur, rien) hors de l'arbre : il ne contient que des lignes. */}
                {repos.status !== "ready" || visible.length === 0 ? (
                  <div className="clone-repos" aria-busy={repos.status === "loading"}>
                    {repos.status === "loading" && (
                      <p className="empty" role="status">
                        {t("clone.loading")}
                      </p>
                    )}
                    {repos.status === "error" && (
                      <div className="empty" role="alert">
                        <p>{errorMessage(t, repos.error)}</p>
                        <button type="button" className="link" onClick={() => setReload((n) => n + 1)}>
                          {t("clone.retry")}
                        </button>
                      </div>
                    )}
                    {repos.status === "ready" && (
                      <p className="empty" role="status">
                        {repos.list.repos.length ? t("clone.noMatch", { q: query }) : t("clone.noRepos")}
                      </p>
                    )}
                  </div>
                ) : (
                <div
                  ref={treeRef}
                  className="clone-repos"
                  role="tree"
                  tabIndex={busy ? -1 : 0}
                  aria-label={t("clone.repos")}
                  aria-description={t("clone.treeKeys")}
                  aria-activedescendant={rows.length ? `clone-row-${at}` : undefined}
                  onKeyDown={onTreeKey}
                >
                  {groups.map((g) => {
                    const oi = rowIndex(`o:${g.owner}`);
                    const open = !isCollapsed(g.owner);
                    return (
                    <div
                      key={g.owner}
                      id={`clone-row-${oi}`}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={open}
                      aria-label={`${g.owner}, ${t("clone.repoCount", { count: g.repos.length })}`}
                      className={oi === at ? "clone-group active" : "clone-group"}
                    >
                      <div
                        className="clone-owner"
                        onClick={() => {
                          setActiveRow(`o:${g.owner}`);
                          toggleOwner(g.owner);
                        }}
                      >
                        <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
                        <OwnerAvatar account={linked?.account ?? null} owner={g.owner} />
                        <span className="clone-owner-name">{g.owner}</span>
                        <span className="clone-owner-count" aria-hidden="true">
                          {g.repos.length}
                        </span>
                      </div>
                      {open && (
                      <div role="group">
                      {g.repos.map((r) => {
                        const ri = rowIndex(`r:${r.fullName}`);
                        return (
                        <div
                          key={r.fullName}
                          id={`clone-row-${ri}`}
                          role="treeitem"
                          aria-level={2}
                          aria-selected={picked?.fullName === r.fullName}
                          className={["clone-repo", picked?.fullName === r.fullName && "on", ri === at && "active"].filter(Boolean).join(" ")}
                          onClick={() => {
                            if (busy) return;
                            setActiveRow(`r:${r.fullName}`);
                            pick(r);
                          }}
                          title={r.description ? `${r.fullName}\n${r.description}` : r.fullName}
                        >
                          <span className="clone-repo-name">
                            {repoShortName(r)}
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
                        </div>
                        );
                      })}
                      </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                )}
                {repos.status === "ready" && repos.list.truncated && <p className="account-hint">{t("clone.truncated", { count: repos.list.repos.length })}</p>}
                {/* Organisations dont GitHub cache les dépôts au token : dire pourquoi, et quoi faire. */}
                {repos.status === "ready" &&
                  ["oauth", "saml"].map((reason) => {
                    const orgs = (repos.list.restricted ?? []).filter((o) => o.reason === reason).map((o) => o.org);
                    return orgs.length ? (
                      <p key={reason} className="account-hint clone-restricted" role="note">
                        {t(`clone.restricted.${reason}`, { count: orgs.length, orgs: orgs.join(", ") })}
                      </p>
                    ) : null;
                  })}
            </div>
            <div className="dialog-col">
                <div className="segmented clone-protocol" role="radiogroup" aria-label={t("clone.protocol")} onKeyDown={onRadioGroupKeyDown}>
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
                {picked && (
                  <p className="account-hint mono clone-url" title={cloneUrl}>
                    {cloneUrl}
                  </p>
                )}
              {destFields}
            </div>
          </div>
        ) : (
          <>
            {destFields}
          </>
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
          {why && (
            <span id="clone-why" className="dialog-why">
              {why}
            </span>
          )}
          {busy ? (
            <button type="button" className="btn" onClick={() => api.cancelClone().catch(() => {})}>
              {t("clone.stop")}
            </button>
          ) : (
            <button type="button" className="btn" onClick={cancel}>
              {t("confirm.cancel")}
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!ready} aria-describedby={why ? "clone-why" : undefined}>
            {busy ? t("clone.cloning") : t("clone.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
