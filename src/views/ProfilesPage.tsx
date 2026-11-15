// Page de gestion des profils : liste à gauche, profil choisi à droite (identité Git, clé SSH,
// règles de sélection automatique, dépôts associés). Les modifications sont faites sur un
// brouillon, enregistré d'un bloc.

import { useEffect, useState } from "react";
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
  sshDir,
  validEmail,
} from "../lib/profiles";
import type { Profile, SshKeyInfo } from "../lib/types";
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
  const storePassphrase = async (store: boolean) => {
    const key = draft?.sshKey?.trim();
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
        if (e.key === "Escape" && !useDialogs.getState().current && !el.closest("input, textarea")) close();
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
              <KeyStatus state={keyState} onPassphrase={storePassphrase} />
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
    </div>
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
