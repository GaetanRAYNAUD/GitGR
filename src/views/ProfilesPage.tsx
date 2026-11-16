// Page de gestion des profils : liste à gauche, profil choisi à droite (identité Git, clé SSH,
// règles de sélection automatique, dépôts associés). Les modifications sont faites sur un
// brouillon, enregistré d'un bloc.

import { useEffect, useRef, useState } from "react";
import { AccountDialog } from "../components/AccountDialog";
import { ColorChoice } from "../components/ColorChoice";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { squareImage } from "../lib/image";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import {
  defaultKeyPath,
  newProfileId,
  nextColor,
  profileComplete,
  ruleKind,
  signingKeyMissing,
  uidEmail,
  sshDir,
  validEmail,
} from "../lib/profiles";
import { instanceLabel, PROVIDER_NAMES } from "../lib/providers";
import type { Account, AccountKey, AccountKeyKind, GpgKey, Profile, SigningMode, SshKeyInfo } from "../lib/types";
import { useApp } from "../store/app";
import { useDialogs } from "../store/dialogs";
import { useProfiles } from "../store/profiles";

/** Profil tel qu'il sera enregistré : textes sans blancs autour, règles sans doublon. */
function cleaned(p: Profile): Profile {
  const key = p.sshKey?.trim();
  return {
    ...p,
    name: p.name.trim(),
    userName: p.userName.trim(),
    userEmail: p.userEmail.trim(),
    sshKey: key ? key : null,
    image: p.image ?? null,
    signing: p.signing ?? "",
    signingKey: p.signingKey?.trim() || null,
    accounts: p.accounts ?? [],
    rules: [...new Set(p.rules.map((r) => r.trim()).filter(Boolean))],
  };
}

const same = (a: Profile, b: Profile) => JSON.stringify(cleaned(a)) === JSON.stringify(cleaned(b));

type KeyState = { status: "none" } | { status: "loading" } | { status: "ok"; info: SshKeyInfo } | { status: "error"; error: string };

/** Lit la clé indiquée (après une courte pause pendant la frappe) ; `reload` : relire même si le
 *  chemin n'a pas changé (clé tout juste générée à ce chemin). */
function useKeyInfo(path: string | null, reload: number): KeyState {
  const [state, setState] = useState<KeyState>({ status: "none" });
  useEffect(() => {
    const key = path?.trim();
    if (!key) {
      setState({ status: "none" });
      return;
    }
    let gone = false;
    setState({ status: "loading" });
    const id = setTimeout(() => {
      api.sshKeyInfo(key).then(
        (info) => !gone && setState({ status: "ok", info }),
        (e) => !gone && setState({ status: "error", error: errorCode(e) }),
      );
    }, 250);
    return () => {
      gone = true;
      clearTimeout(id);
    };
  }, [path, reload]);
  return state;
}

function Avatar({ profile, size }: { profile: Profile; size?: "lg" }) {
  return <ProfileAvatar profile={profile} className={size ? `pf-avatar ${size}` : "pf-avatar"} />;
}

export function ProfilesPage() {
  const { t } = useTranslation();
  const profiles = useProfiles((s) => s.profiles);
  const repoProfiles = useProfiles((s) => s.repoProfiles);
  const home = useProfiles((s) => s.home);
  const repos = useApp((s) => s.repos);
  const store = useProfiles.getState();

  const blank = (): Profile => ({
    id: newProfileId(),
    name: t("profiles.newName"),
    userName: "",
    userEmail: "",
    sshKey: null,
    image: null,
    signing: "",
    signingKey: null,
    accounts: [],
    rules: [],
    color: nextColor(profiles),
  });

  const [draft, setDraft] = useState<Profile | null>(() => {
    const select = useProfiles.getState().pageSelect;
    if (select === "new") return blank();
    const p = profiles.find((x) => x.id === select) ?? profiles[0];
    return p ? { ...p } : null;
  });
  const [touched, setTouched] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [keyReload, setKeyReload] = useState(0);
  /** Fenêtre « Connecter un compte » ouverte ; `initial` : compte à reconnecter. */
  const [accountDialog, setAccountDialog] = useState<{ initial: Account | null } | null>(null);
  /** Comptes à revérifier (après une reconnexion). */
  const [accountReload, setAccountReload] = useState(0);
  const keyState = useKeyInfo(draft?.sshKey ?? null, keyReload);

  const saved = draft ? profiles.find((p) => p.id === draft.id) : undefined;
  const isNew = !!draft && !saved;
  const dirty = !!draft && (isNew || (saved ? !same(draft, saved) : false));
  const patch = (p: Partial<Profile>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const reposOf = (id: string) => repos.filter((r) => repoProfiles[r.path]?.allowed.includes(id));

  /** Exécute `next` après confirmation si le brouillon a des modifications non enregistrées. */
  const leave = async (next: () => void) => {
    if (dirty && draft) {
      const pick = await useDialogs.getState().choose({
        title: t("profiles.discardTitle"),
        body: t("profiles.discardBody", { name: draft.name || t("profiles.newName") }),
        choices: [{ id: "discard", label: t("profiles.discard"), danger: true }],
      });
      if (pick !== "discard") return;
    }
    setTouched(false);
    setNewRule("");
    next();
  };

  const show = (p: Profile | undefined) => setDraft(p ? { ...p } : null);

  const save = async () => {
    if (!draft) return;
    setTouched(true);
    if (!profileComplete(draft)) return;
    const p = cleaned(draft);
    const list = isNew ? [...profiles, p] : profiles.map((x) => (x.id === p.id ? p : x));
    if (await store.save(list)) {
      setDraft(p);
      setTouched(false);
      useApp.getState().notify(t("profiles.saved", { name: p.name }));
    }
  };

  const remove = async () => {
    if (!draft) return;
    if (isNew) {
      setTouched(false);
      show(profiles[0]);
      return;
    }
    const count = repos.filter((r) => repoProfiles[r.path]?.active === draft.id).length;
    const pick = await useDialogs.getState().choose({
      title: t("profiles.deleteTitle", { name: saved?.name ?? draft.name }),
      body: t("profiles.deleteBody", { count }),
      choices: [{ id: "delete", label: t("profiles.delete"), danger: true }],
    });
    if (pick !== "delete") return;
    const rest = profiles.filter((p) => p.id !== draft.id);
    if (await store.save(rest)) {
      setTouched(false);
      show(rest[0]);
    }
  };

  const generate = async () => {
    if (!draft) return;
    const comment = draft.userEmail.trim() || draft.name.trim();
    const answer = await useDialogs.getState().input({
      title: t("profiles.generateTitle"),
      subtitle: t("profiles.generateSubtitle", { comment }),
      label: t("profiles.generateLabel"),
      initial: defaultKeyPath(home, draft.name),
      submit: t("profiles.generateSubmit"),
      checkbox: { label: t("profiles.generateProtect"), checked: false },
    });
    if (!answer) return;
    let passphrase: string | null = null;
    if (answer.checked) {
      passphrase = await askPassphrase(answer.value);
      if (passphrase === null) return;
    }
    try {
      await api.generateSshKey(answer.value, comment, passphrase);
      patch({ sshKey: answer.value });
      setKeyReload((n) => n + 1);
      useApp.getState().notify(t("profiles.generated", { path: answer.value }), true);
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  /** Demande une phrase de passe (masquée) ; `null` si annulé. */
  const askPassphrase = async (key: string) => {
    const answer = await useDialogs.getState().input({
      title: t("profiles.passphraseTitle"),
      subtitle: key,
      label: t("profiles.passphraseLabel"),
      initial: "",
      submit: t("profiles.passphraseSubmit"),
      secret: true,
    });
    return answer ? answer.value : null;
  };

  /** Enregistre (`true`) ou oublie (`false`) la phrase de passe de la clé indiquée. */
  const storePassphrase = async (key: string | null | undefined, store: boolean) => {
    key = key?.trim();
    if (!key) return;
    const passphrase = store ? await askPassphrase(key) : null;
    if (store && passphrase === null) return;
    try {
      await api.setKeyPassphrase(key, passphrase);
      setKeyReload((n) => n + 1);
      useApp.getState().notify(t(store ? "profiles.passphraseSaved" : "profiles.passphraseForgotten"));
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  const browse = async () => {
    try {
      const file = await api.pickFile(t("profiles.browseTitle"), sshDir(home));
      if (file) patch({ sshKey: file.replace(/\.pub$/, "") });
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  const copyPublic = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      useApp.getState().notify(t("profiles.copied"));
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  const pickImage = async (file: File) => {
    try {
      const image = await squareImage(file);
      patch({ image });
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  /** Les comptes sont enregistrés tout de suite (comme les dépôts associés) : le brouillon suit,
   *  sans toucher à ses autres modifications — s'il est toujours celui de ce profil. */
  const syncAccounts = (id: string) => {
    const accounts = useProfiles.getState().profiles.find((p) => p.id === id)?.accounts ?? [];
    setDraft((d) => (d && d.id === id ? { ...d, accounts } : d));
  };

  const accountClosed = (account: Account | null) => {
    setAccountDialog(null);
    if (!account || !draft) return;
    syncAccounts(draft.id);
    setAccountReload((n) => n + 1);
    useApp.getState().notify(t("profiles.accountConnected", { login: account.login, instance: instanceLabel(account.url) }));
  };

  const disconnect = async (account: Account) => {
    if (!draft) return;
    const pick = await useDialogs.getState().choose({
      title: t("profiles.accountDisconnectTitle", { login: account.login }),
      body: t("profiles.accountDisconnectBody", {
        login: account.login,
        instance: instanceLabel(account.url),
        profile: saved?.name ?? draft.name,
        provider: PROVIDER_NAMES[account.kind],
      }),
      choices: [{ id: "disconnect", label: t("profiles.accountDisconnect"), danger: true }],
    });
    if (pick !== "disconnect" || !(await store.disconnectAccount(draft.id, account.id))) return;
    syncAccounts(draft.id);
    useApp.getState().notify(t("profiles.accountDisconnected", { login: account.login }));
  };

  const addRule = () => {
    const rule = newRule.trim();
    if (!draft || !rule) return;
    if (!draft.rules.includes(rule)) patch({ rules: [...draft.rules, rule] });
    setNewRule("");
  };

  const close = () => leave(() => store.closePage());

  const nameError = touched && draft && !draft.name.trim() ? t("profiles.required") : null;
  const userError = touched && draft && !draft.userName.trim() ? t("profiles.required") : null;
  const emailError =
    touched && draft ? (!draft.userEmail.trim() ? t("profiles.required") : !validEmail(draft.userEmail) ? t("profiles.invalidEmail") : null) : null;

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, error: string | null, opts: { mono?: boolean; type?: string } = {}) => (
    <div className="pf-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={opts.mono ? "pf-input mono" : "pf-input"}
        type={opts.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <span id={`${id}-error`} className="input-error">
          {error}
        </span>
      )}
    </div>
  );

  const linked = draft && !isNew ? reposOf(draft.id) : [];

  return (
    <div
      className="profiles-page"
      onKeyDown={(e) => {
        const el = e.target as HTMLElement;
        if (e.key === "Escape" && !useDialogs.getState().current && !accountDialog && !el.closest("input, textarea")) close();
      }}
    >
      <aside className="pf-list" aria-label={t("profiles.title")}>
        <div className="pf-list-head">
          <h1>{t("profiles.title")}</h1>
          <button className="icon-btn" aria-label={t("profiles.close")} title={t("profiles.close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {profiles.map((p) => {
          const on = draft?.id === p.id;
          return (
            <button key={p.id} className={on ? "pf-item on" : "pf-item"} aria-current={on || undefined} onClick={() => !on && leave(() => show(p))}>
              <Avatar profile={p} />
              <span className="pf-item-text">
                <strong>{p.name}</strong>
                <span>{t("profiles.repoCount", { count: reposOf(p.id).length })}</span>
              </span>
            </button>
          );
        })}
        {isNew && draft && (
          <div className="pf-item on" aria-current>
            <Avatar profile={draft} />
            <span className="pf-item-text">
              <strong>{draft.name || t("profiles.newName")}</strong>
              <span>{t("profiles.unsaved")}</span>
            </span>
          </div>
        )}
        <button className="btn pf-new" onClick={() => leave(() => setDraft(blank()))}>
          <Icon name="plus" size={15} />
          {t("profiles.new")}
        </button>
        {draft && <p className="pf-hint">{t("profiles.hint")}</p>}
      </aside>

      <section className="pf-editor">
        {!draft ? (
          <div className="pf-empty">
            <Icon name="user" size={28} />
            <p>{t("profiles.empty")}</p>
            <p className="muted">{t("profiles.hint")}</p>
            <button className="btn primary" onClick={() => setDraft(blank())}>
              <Icon name="plus" size={15} />
              {t("profiles.new")}
            </button>
          </div>
        ) : (
          <form
            className="pf-form"
            // Nos propres messages, pas la bulle du navigateur (qui bloquerait l'envoi en silence).
            noValidate
            aria-label={draft.name || t("profiles.newName")}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <header className="pf-head">
              <label className="pf-image" title={`${t("profiles.imagePick")}\n${t("profiles.imageHint")}`}>
                <Avatar profile={draft} size="lg" />
                <span className="pf-image-edit" aria-hidden="true">
                  <Icon name="image" size={13} />
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="visually-hidden"
                  aria-label={t("profiles.imagePick")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) pickImage(file);
                  }}
                />
              </label>
              <div className="pf-head-text">
                <h2>{draft.name || t("profiles.newName")}</h2>
                <span className="muted">{draft.userEmail || " "}</span>
                {draft.image && (
                  <button type="button" className="link pf-image-remove" onClick={() => patch({ image: null })}>
                    {t("profiles.imageRemove")}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn"
                disabled={isNew}
                onClick={() =>
                  // Copie du profil enregistré : les modifications en cours sont abandonnées (confirmé).
                  leave(() =>
                    saved &&
                    setDraft({ ...saved, id: newProfileId(), name: t("profiles.copyName", { name: saved.name }), color: nextColor(profiles) }),
                  )
                }
              >
                <Icon name="copy" size={15} />
                {t("profiles.duplicate")}
              </button>
            </header>

            <section className="pf-sec" aria-labelledby="pf-identity">
              <h3 id="pf-identity" className="eyebrow">
                {t("profiles.identity")}
              </h3>
              <div className="pf-grid">
                {field("pf-name", t("profiles.name"), draft.name, (name) => patch({ name }), nameError)}
                {field("pf-user", t("profiles.userName"), draft.userName, (userName) => patch({ userName }), userError)}
                {field("pf-email", t("profiles.userEmail"), draft.userEmail, (userEmail) => patch({ userEmail }), emailError, { type: "email" })}
              </div>
              <p className="pf-note">{t("profiles.identityHint")}</p>
              <div className="pf-field">
                <span className="pf-label">{t("profiles.color")}</span>
                <ColorChoice value={draft.color} label={t("profiles.color")} onChange={(color) => color !== undefined && patch({ color })} />
              </div>
            </section>

            <section className="pf-sec" aria-labelledby="pf-ssh">
              <h3 id="pf-ssh" className="eyebrow">
                {t("profiles.ssh")}
              </h3>
              <div className="pf-field">
                <label htmlFor="pf-key">{t("profiles.sshKey")}</label>
                <div className="pf-row">
                  <input
                    id="pf-key"
                    className="pf-input mono"
                    value={draft.sshKey ?? ""}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => patch({ sshKey: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button type="button" className="btn" onClick={browse}>
                    {t("profiles.browse")}
                  </button>
                </div>
              </div>
              <KeyStatus state={keyState} onPassphrase={(store) => storePassphrase(draft.sshKey, store)} />
              <div className="pf-actions">
                <button type="button" className="btn" onClick={generate}>
                  <Icon name="key" size={15} />
                  {t("profiles.generate")}
                </button>
                {keyState.status === "ok" && keyState.info.publicKey && (
                  <button type="button" className="btn" onClick={() => copyPublic(keyState.info.publicKey!)}>
                    <Icon name="copy" size={15} />
                    {t("profiles.copyPublic")}
                  </button>
                )}
                {draft.sshKey && (
                  <button type="button" className="btn" onClick={() => patch({ sshKey: null })}>
                    {t("profiles.clearKey")}
                  </button>
                )}
              </div>
            </section>

            <SigningSection draft={draft} patch={patch} touched={touched} home={home} keyReload={keyReload} onPassphrase={storePassphrase} />

            <section className="pf-sec" aria-labelledby="pf-accounts">
              <h3 id="pf-accounts" className="eyebrow">
                {t("profiles.accounts")}
              </h3>
              <p className="pf-note">{t("profiles.accountsHint")}</p>
              {isNew ? (
                <p className="pf-note">{t("profiles.accountsNew")}</p>
              ) : (
                <>
                  <AccountList
                    profileId={draft.id}
                    keysChanged={
                      // Comparées comme elles seront enregistrées : vide = aucune.
                      !!saved &&
                      ((saved.sshKey?.trim() || null) !== (draft.sshKey?.trim() || null) ||
                        (saved.signing ?? "") !== (draft.signing ?? "") ||
                        (saved.signingKey?.trim() || null) !== (draft.signingKey?.trim() || null))
                    }
                    accounts={draft.accounts ?? []}
                    reload={accountReload}
                    onReconnect={(initial) => setAccountDialog({ initial })}
                    onDisconnect={disconnect}
                  />
                  <div className="pf-actions">
                    <button type="button" className="btn" onClick={() => setAccountDialog({ initial: null })}>
                      <Icon name="link" size={15} />
                      {t("profiles.accountConnect")}
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="pf-sec" aria-labelledby="pf-rules">
              <h3 id="pf-rules" className="eyebrow">
                {t("profiles.rules")}
              </h3>
              <p className="pf-note">{t("profiles.rulesHint")}</p>
              {draft.rules.length > 0 && (
                <ul className="pf-chips">
                  {draft.rules.map((rule) => (
                    <li key={rule} className="pf-chip" title={ruleKind(rule) === "folder" ? t("profiles.ruleFolder") : t("profiles.ruleHost")}>
                      <Icon name={ruleKind(rule) === "folder" ? "folder" : "cloud"} size={13} />
                      <span className="mono">{rule}</span>
                      <button
                        type="button"
                        className="pf-chip-x"
                        aria-label={t("profiles.removeRule", { rule })}
                        onClick={() => patch({ rules: draft.rules.filter((r) => r !== rule) })}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="pf-row">
                <input
                  className="pf-input mono"
                  aria-label={t("profiles.ruleLabel")}
                  placeholder={t("profiles.rulePlaceholder")}
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRule();
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" className="btn" disabled={!newRule.trim()} onClick={addRule}>
                  {t("profiles.addRule")}
                </button>
              </div>
            </section>

            {!isNew && (
              <section className="pf-sec" aria-labelledby="pf-repos">
                <h3 id="pf-repos" className="eyebrow">
                  {t("profiles.repos")}
                </h3>
                {linked.length === 0 ? (
                  <p className="pf-note">{t("profiles.reposEmpty")}</p>
                ) : (
                  <ul className="pf-repos">
                    {linked.map((r) => {
                      const activeId = repoProfiles[r.path]?.active ?? null;
                      const other = profiles.find((p) => p.id === activeId);
                      const status =
                        activeId === draft.id ? t("profiles.repoActive") : other ? t("profiles.repoOther", { name: other.name }) : t("profiles.repoNone");
                      return (
                        <li key={r.path}>
                          <strong>{r.name}</strong>
                          <span className="mono muted pf-repo-path" title={r.path}>
                            {r.path}
                          </span>
                          <span className="pf-repo-status">{status}</span>
                          <button
                            type="button"
                            className="mini"
                            title={t("profiles.dissociateHint", { repo: r.name })}
                            onClick={() => store.dissociate(r.path, draft.id)}
                          >
                            {t("profiles.dissociate")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            <footer className="pf-foot">
              <button type="button" className="btn danger-text" onClick={remove}>
                <Icon name="trash" size={15} />
                {t("profiles.delete")}
              </button>
              <span className="pf-spacer" />
              <button type="button" className="btn" disabled={!dirty} onClick={() => (isNew ? remove() : saved && show(saved))}>
                {t("profiles.cancel")}
              </button>
              <button type="submit" className="btn primary" disabled={!dirty}>
                {t("profiles.save")}
              </button>
            </footer>
          </form>
        )}
      </section>
      {accountDialog && saved && <AccountDialog profile={saved} initial={accountDialog.initial} onClose={accountClosed} />}
    </div>
  );
}

type AccountState = "checking" | "ok" | { error: string };

/** Comptes du profil, avec l'état de leur token (vérifié auprès du provider à l'affichage). */
function AccountList({
  profileId,
  keysChanged,
  accounts,
  reload,
  onReconnect,
  onDisconnect,
}: {
  profileId: string;
  /** Clés du brouillon différentes de celles du profil enregistré. */
  keysChanged: boolean;
  accounts: Account[];
  reload: number;
  onReconnect: (account: Account) => void;
  onDisconnect: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const [states, setStates] = useState<Record<string, AccountState>>({});
  const ids = accounts.map((a) => a.id).join("\n");
  /** Comptes déjà vérifiés (ou en cours) pour cette valeur de `reload` : seuls les nouveaux le
   *  sont quand la liste change ; `reload` les revérifie tous. */
  const checked = useRef({ reload, ids: new Set<string>() });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (checked.current.reload !== reload) checked.current = { reload, ids: new Set() };
    const round = checked.current;
    for (const id of ids ? ids.split("\n") : []) {
      if (round.ids.has(id)) continue;
      round.ids.add(id);
      // Une réponse d'une vérification précédente (avant reconnexion) n'écrase pas la nouvelle.
      const settle = (state: AccountState) => alive.current && checked.current === round && setStates((s) => ({ ...s, [id]: state }));
      setStates((s) => ({ ...s, [id]: "checking" }));
      api.checkAccount(id).then(
        () => settle("ok"),
        (e) => settle({ error: errorCode(e) }),
      );
    }
  }, [ids, reload]);

  if (accounts.length === 0) return <p className="pf-note">{t("profiles.accountsEmpty")}</p>;
  return (
    <ul className="pf-accounts">
      {accounts.map((a) => {
        const state = states[a.id] ?? "checking";
        const failed = typeof state === "object";
        return (
          <li key={a.id} className={failed ? "bad" : undefined}>
            <div className="pf-account-row">
              <Icon name={a.kind} size={16} />
              <strong>{a.login}</strong>
              <span className="muted pf-account-instance" title={a.url}>
                {a.name ? `${a.name} · ` : ""}
                {instanceLabel(a.url)}
              </span>
              <span className="pf-account-status" role={failed ? "alert" : "status"}>
                {failed ? errorMessage(t, state.error) : state === "ok" ? t("profiles.accountOk") : t("profiles.accountChecking")}
              </span>
              {failed && (
                <button type="button" className="mini" onClick={() => onReconnect(a)}>
                  {t("profiles.accountReconnect")}
                </button>
              )}
              <button type="button" className="mini" aria-label={`${t("profiles.accountDisconnect")} ${a.login}`} onClick={() => onDisconnect(a)}>
                {t("profiles.accountDisconnect")}
              </button>
            </div>
            {state === "ok" && <AccountKeys profileId={profileId} account={a} keysChanged={keysChanged} reload={reload} />}
          </li>
        );
      })}
    </ul>
  );
}

type KeysState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; keys: AccountKey[] };

/** Clés du profil (SSH, signature) et leur présence sur le compte, avec de quoi les ajouter. */
function AccountKeys({ profileId, account, keysChanged, reload }: { profileId: string; account: Account; keysChanged: boolean; reload: number }) {
  const { t } = useTranslation();
  const [state, setState] = useState<KeysState>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  /** Clé en cours d'ajout, et erreur d'ajout par type de clé. */
  const [adding, setAdding] = useState<AccountKeyKind | null>(null);
  const [addError, setAddError] = useState<Partial<Record<AccountKeyKind, string>>>({});

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api.accountKeys(profileId, account.id).then(
      (keys) => live && setState({ status: "ready", keys }),
      (e) => live && setState({ status: "error", error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [profileId, account.id, reload, refresh]);

  const add = async (kind: AccountKeyKind) => {
    setAdding(kind);
    setAddError((e) => ({ ...e, [kind]: undefined }));
    try {
      await api.addAccountKey(profileId, account.id, kind);
      setRefresh((n) => n + 1);
    } catch (e) {
      setAddError((prev) => ({ ...prev, [kind]: errorCode(e) }));
    } finally {
      setAdding(null);
    }
  };

  if (state.status === "loading") return <p className="pf-account-keys muted">{t("profiles.keysChecking")}</p>;
  if (state.status === "error")
    return (
      <p className="pf-account-keys bad" role="alert">
        {errorMessage(t, state.error)}
      </p>
    );
  if (state.keys.length === 0 && !keysChanged) return null;
  return (
    <ul className="pf-account-keys" aria-label={t("profiles.keysOn", { login: account.login })}>
      {state.keys.map((k) => {
        const error = k.error ?? addError[k.kind];
        return (
          <li key={k.kind} className={error ? "bad" : k.present ? "ok" : undefined}>
            <Icon name={k.present ? "check" : error ? "alert" : "key"} size={13} />
            <span className="pf-key-kind">{t(`profiles.keyKind_${k.kind}`)}</span>
            {k.label && <span className="mono pf-key-label">{k.label}</span>}
            <span className="pf-key-state" role={error ? "alert" : undefined}>
              {error ? errorMessage(t, error) : k.present ? t("profiles.keyPresent") : t("profiles.keyAbsent")}
            </span>
            {!k.present && !k.error && (
              <button type="button" className="mini" disabled={adding !== null || keysChanged} onClick={() => add(k.kind)}>
                {adding === k.kind ? t("profiles.keyAdding") : t("profiles.keyAdd")}
              </button>
            )}
          </li>
        );
      })}
      {keysChanged && <li className="pf-note">{t("profiles.keysUnsaved")}</li>}
    </ul>
  );
}

function KeyStatus({ state, onPassphrase }: { state: KeyState; onPassphrase: (store: boolean) => void }) {
  const { t } = useTranslation();
  if (state.status === "none") return <p className="pf-note">{t("profiles.sshNone")}</p>;
  if (state.status === "loading") return <p className="pf-note">{t("profiles.keyLoading")}</p>;
  if (state.status === "error")
    return (
      <p className="pf-key bad" role="alert">
        <Icon name="alert" size={15} />
        {errorMessage(t, state.error)}
      </p>
    );
  const { info } = state;
  // Protégée sans phrase de passe connue : inutilisable par GitGR tant qu'elle n'est pas enregistrée.
  const missing = info.encrypted && !info.passphraseStored;
  return (
    <div className={missing ? "pf-key warn" : "pf-key"}>
      <Icon name={missing ? "alert" : "check"} size={15} />
      <span className="mono pf-key-fp">
        {info.kind} · {info.fingerprint}
        {info.comment ? ` · ${info.comment}` : ""}
      </span>
      {missing ? (
        <span>{t("profiles.keyEncrypted")}</span>
      ) : info.encrypted ? (
        <span>{t("profiles.passphraseStored")}</span>
      ) : (
        !info.publicKey && <span>{t("profiles.keyNoPublic")}</span>
      )}
      {info.encrypted && (
        <button type="button" className="mini pf-key-action" onClick={() => onPassphrase(missing)}>
          {missing ? t("profiles.passphraseSet") : t("profiles.passphraseForget")}
        </button>
      )}
    </div>
  );
}

type GpgState = { status: "loading" } | { status: "ok"; keys: GpgKey[] } | { status: "error"; error: string };

/** Clés GPG, lues une fois à l'ouverture de la section en mode GPG. */
function useGpgKeys(enabled: boolean): GpgState {
  const [state, setState] = useState<GpgState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    setState({ status: "loading" });
    api.gpgKeys().then(
      (keys) => !gone && setState({ status: "ok", keys }),
      (e) => !gone && setState({ status: "error", error: errorCode(e) }),
    );
    return () => {
      gone = true;
    };
  }, [enabled]);
  return state;
}

/** Signature des commits : selon la config Git, jamais, GPG (clé à choisir) ou SSH (clé du
 *  profil par défaut). */
function SigningSection({
  draft,
  patch,
  touched,
  home,
  keyReload,
  onPassphrase,
}: {
  draft: Profile;
  patch: (p: Partial<Profile>) => void;
  touched: boolean;
  home: string | null;
  keyReload: number;
  onPassphrase: (key: string, store: boolean) => void;
}) {
  const { t } = useTranslation();
  const mode: SigningMode = draft.signing ?? "";
  const gpg = useGpgKeys(mode === "gpg");
  const key = draft.signingKey ?? "";
  // Clé de signature SSH distincte de celle du profil : son état (et sa phrase de passe) ici.
  const ownSshKey = mode === "ssh" && !!key.trim() && key.trim() !== draft.sshKey?.trim();
  const sshKeyState = useKeyInfo(ownSshKey ? key.replace(/\.pub$/, "") : null, keyReload);
  const modes: SigningMode[] = ["", "off", "gpg", "ssh"];
  const label = (m: SigningMode) => t(`profiles.signing_${m || "config"}`);

  // GPG : la clé choisie (ou celle que gpg prendra) correspond-elle à l'e-mail du profil ?
  const email = draft.userEmail.trim().toLowerCase();
  const usable = gpg.status === "ok" ? gpg.keys.filter((k) => !k.unusable) : [];
  const chosen = usable.find((k) => key && (k.id === key || k.fingerprint === key || k.fingerprint.endsWith(key.toUpperCase())));
  const emailMismatch =
    mode === "gpg" && gpg.status === "ok" && !!email && (chosen ? !chosen.uids.some((u) => uidEmail(u) === email) : !key && !usable.some((k) => k.uids.some((u) => uidEmail(u) === email)));

  const browse = async () => {
    try {
      const file = await api.pickFile(t("profiles.browseTitle"), sshDir(home));
      if (file) patch({ signingKey: file });
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };

  return (
    <section className="pf-sec" aria-labelledby="pf-signing">
      <h3 id="pf-signing" className="eyebrow">
        {t("profiles.signing")}
      </h3>
      <div className="segmented pf-segmented" role="radiogroup" aria-label={t("profiles.signing")}>
        {modes.map((m) => (
          <button
            key={m || "config"}
            type="button"
            role="radio"
            aria-checked={m === mode}
            className={m === mode ? "seg on" : "seg"}
            onClick={() => patch({ signing: m, signingKey: m === mode ? draft.signingKey : null })}
          >
            {label(m)}
          </button>
        ))}
      </div>
      <p className="pf-note">{t(`profiles.signingHint_${mode || "config"}`)}</p>

      {mode === "gpg" && (
        <div className="pf-field">
          <label htmlFor="pf-gpg">{t("profiles.gpgKey")}</label>
          {gpg.status === "error" ? (
            <p className="pf-key bad" role="alert">
              <Icon name="alert" size={15} />
              {errorMessage(t, gpg.error)}
            </p>
          ) : (
            <select id="pf-gpg" className="pf-input" value={chosen?.id ?? key} disabled={gpg.status === "loading"} onChange={(e) => patch({ signingKey: e.target.value || null })}>
              <option value="">{t("profiles.gpgAuto")}</option>
              {usable.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.uids[0] ?? k.id} — {k.id}
                </option>
              ))}
              {key && !chosen && gpg.status === "ok" && <option value={key}>{key}</option>}
            </select>
          )}
          {gpg.status === "ok" && usable.length === 0 && <p className="pf-note">{t("profiles.gpgNone")}</p>}
          {emailMismatch && (
            <p className="pf-key warn">
              <Icon name="alert" size={15} />
              {t("profiles.gpgEmailMismatch", { email: draft.userEmail.trim() })}
            </p>
          )}
        </div>
      )}

      {mode === "ssh" && (
        <div className="pf-field">
          <label htmlFor="pf-sign-key">{t("profiles.sshSigningKey")}</label>
          <div className="pf-row">
            <input
              id="pf-sign-key"
              className="pf-input mono"
              value={key}
              placeholder={draft.sshKey?.trim() || "~/.ssh/id_ed25519"}
              onChange={(e) => patch({ signingKey: e.target.value })}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={touched && signingKeyMissing(draft)}
              aria-describedby={touched && signingKeyMissing(draft) ? "pf-sign-key-error" : undefined}
            />
            <button type="button" className="btn" onClick={browse}>
              {t("profiles.browse")}
            </button>
          </div>
          {touched && signingKeyMissing(draft) ? (
            <span id="pf-sign-key-error" className="input-error">
              {t("profiles.sshSigningMissing")}
            </span>
          ) : ownSshKey ? (
            <KeyStatus state={sshKeyState} onPassphrase={(store) => onPassphrase(key.replace(/\.pub$/, ""), store)} />
          ) : (
            !key.trim() && draft.sshKey?.trim() && <p className="pf-note">{t("profiles.sshSigningDefault")}</p>
          )}
        </div>
      )}
    </section>
  );
}
