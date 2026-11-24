// Page de gestion des profils : liste à gauche, profil choisi à droite (identité Git, clé SSH,
// signature, règles de sélection automatique, comptes, dépôts associés), en lignes de réglage
// comme la page des réglages. Chaque modification est enregistrée tout de suite (après une
// courte pause pendant la frappe) dès que le profil est complet ; un profil incomplet attend,
// avec ses champs à compléter signalés.

import { type Ref, useEffect, useRef, useState } from "react";
import { AccountDialog } from "../components/AccountDialog";
import { ColorChoice } from "../components/ColorChoice";
import { useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { ProfileAvatar } from "../components/ProfileAvatar";
import { Row, Segmented } from "../components/SettingRows";
import { squareImage } from "../lib/image";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import {
  defaultKeyPath,
  newProfileId,
  nextColor,
  parseRemote,
  profileComplete,
  ruleKind,
  ruleScore,
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

/** Champs vérifiés : leur erreur s'affiche une fois le champ quitté (ou tous, à la demande). */
type FieldId = "name" | "user" | "email" | "signKey";

/** Pause après la dernière frappe avant l'enregistrement automatique. */
const SAVE_DELAY = 500;

export function ProfilesPage() {
  const { t } = useTranslation();
  const profiles = useProfiles((s) => s.profiles);
  const repoProfiles = useProfiles((s) => s.repoProfiles);
  const home = useProfiles((s) => s.home);
  const repos = useApp((s) => s.repos);
  const summaries = useApp((s) => s.summaries);
  const store = useProfiles.getState();

  const blank = (): Profile => ({
    id: newProfileId(),
    name: "",
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
  const [touched, setTouched] = useState<ReadonlySet<FieldId>>(new Set());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [newRule, setNewRule] = useState("");
  const [keyReload, setKeyReload] = useState(0);
  /** Fenêtre « Connecter un compte » ouverte ; `initial` : compte à reconnecter. */
  const [accountDialog, setAccountDialog] = useState<{ initial: Account | null } | null>(null);
  /** Comptes à revérifier (après une reconnexion). */
  const [accountReload, setAccountReload] = useState(0);
  const keyState = useKeyInfo(draft?.sshKey ?? null, keyReload);
  const nameInput = useRef<HTMLInputElement>(null);

  const saved = draft ? profiles.find((p) => p.id === draft.id) : undefined;
  const isNew = !!draft && !saved;
  const dirty = !!draft && (isNew || (saved ? !same(draft, saved) : false));
  const complete = !!draft && profileComplete(draft);
  const patch = (p: Partial<Profile>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const touch = (f: FieldId) => setTouched((s) => (s.has(f) ? s : new Set(s).add(f)));

  const reposOf = (id: string) => repos.filter((r) => repoProfiles[r.path]?.allowed.includes(id));

  /** Enregistrements en cours, l'un après l'autre : le dernier état écrit est toujours le plus
   *  récent (deux pauses de frappe rapprochées ne s'écrasent pas dans le désordre). */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /** Enregistre le profil tel qu'il est (complet) dans la liste : ajouté s'il est nouveau. */
  const persist = (d: Profile): Promise<boolean> => {
    setSaveState("saving");
    const run = queue.current.then(async () => {
      const p = cleaned(d);
      const current = useProfiles.getState().profiles;
      const list = current.some((x) => x.id === p.id) ? current.map((x) => (x.id === p.id ? p : x)) : [...current, p];
      const ok = await useProfiles.getState().save(list);
      setSaveState(ok ? "idle" : "error");
      return ok;
    });
    queue.current = run;
    return run;
  };

  /** Bouton de la souris enfoncé : l'erreur d'un champ quitté attend qu'il soit relâché, pour que
   *  le message (qui décale la page) n'escamote pas le clic en cours. */
  const pointerDown = useRef(false);
  useEffect(() => {
    const down = () => (pointerDown.current = true);
    const up = () => (pointerDown.current = false);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
    };
  }, []);
  const touchOnBlur = (f: FieldId) => {
    if (!pointerDown.current) return touch(f);
    // Après le clic (envoyé juste après le relâchement).
    document.addEventListener("pointerup", () => setTimeout(() => touch(f)), { once: true });
  };

  // Enregistrement automatique : chaque modification d'un profil complet, après une courte pause
  // pendant la frappe. Un profil incomplet attend (ses champs à compléter sont signalés).
  useEffect(() => {
    if (!draft || !dirty || !complete) return;
    const id = setTimeout(() => void persist(draft), SAVE_DELAY);
    return () => clearTimeout(id);
  }, [draft, dirty, complete]);

  // Nouveau profil : le focus va au nom.
  const draftId = draft?.id;
  useEffect(() => {
    if (isNew) nameInput.current?.focus();
  }, [draftId]);

  /** Signale tous les champs à compléter et amène le focus au premier. */
  const reveal = () => {
    setTouched(new Set<FieldId>(["name", "user", "email", "signKey"]));
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.pf-form [aria-invalid="true"]')?.focus());
  };

  /** Exécute `next` : les modifications d'un profil complet sont enregistrées d'abord ; celles
   *  d'un profil incomplet sont abandonnées après confirmation. */
  const leave = async (next: () => void) => {
    if (dirty && draft) {
      // Profil complet : enregistré d'abord ; s'il ne peut pas l'être, même question qu'incomplet.
      const failed = complete && !(await persist(draft));
      if (!complete || failed) {
        const name = draft.name.trim() || t("profiles.newName");
        const pick = await useDialogs.getState().choose({
          title: t("profiles.discardTitle"),
          body: t(failed ? "profiles.discardFailedBody" : isNew ? "profiles.discardNewBody" : "profiles.discardBody", { name }),
          choices: [
            { id: "complete", label: t("profiles.discardComplete") },
            { id: "discard", label: t("profiles.discard"), danger: true },
          ],
        });
        if (pick === "complete") reveal();
        if (pick !== "discard") return;
      }
    }
    setTouched(new Set());
    setNewRule("");
    setSaveState("idle");
    next();
  };

  const show = (p: Profile | undefined) => setDraft(p ? { ...p } : null);

  const remove = async () => {
    if (!draft) return;
    if (isNew) {
      setTouched(new Set());
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
      setTouched(new Set());
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

  /** Les comptes sont enregistrés à part (le store les écrit lui-même) : le brouillon suit, sans
   *  toucher à ses autres modifications — s'il est toujours celui de ce profil. */
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

  /** Dépôts récents que la règle désigne (remote d'après le dernier résumé lu, ou dossier). */
  const ruleRepos = (rule: string) =>
    repos.filter((r) => ruleScore(rule, { path: r.path, remote: parseRemote(summaries[r.path]?.data?.remoteUrl ?? null), home }) > 0);

  const close = () => leave(() => store.closePage());

  const shown = (f: FieldId) => touched.has(f);
  const nameError = draft && shown("name") && !draft.name.trim() ? t("profiles.required") : null;
  const userError = draft && shown("user") && !draft.userName.trim() ? t("profiles.required") : null;
  const emailError =
    draft && shown("email") ? (!draft.userEmail.trim() ? t("profiles.required") : !validEmail(draft.userEmail) ? t("profiles.invalidEmail") : null) : null;
  /** Champs qui empêchent l'enregistrement (signalés ou non). */
  const missing = draft ? [!draft.name.trim(), !draft.userName.trim(), !validEmail(draft.userEmail), signingKeyMissing(draft)].filter(Boolean).length : 0;

  const field = (
    id: string,
    f: FieldId,
    label: string,
    value: string,
    onChange: (v: string) => void,
    error: string | null,
    opts: { type?: string; placeholder?: string; ref?: Ref<HTMLInputElement> } = {},
  ) => (
    <Row id={`${id}-label`} htmlFor={id} title={label}>
      <input
        id={id}
        ref={opts.ref}
        className="pf-input pf-input-md"
        type={opts.type ?? "text"}
        value={value}
        placeholder={opts.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => touchOnBlur(f)}
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
    </Row>
  );

  const linked = draft && !isNew ? reposOf(draft.id) : [];

  // Échap ferme la page, où que soit le focus (après un clic sur la barre de titre, il n'est pas
  // dans la page) — sauf dans un champ, une fenêtre ouverte ou un menu qui l'a consommé.
  const escape = useRef<() => void>(() => {});
  escape.current = () => {
    if (!useDialogs.getState().current && !accountDialog) close();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      escape.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** État de l'enregistrement, sous le nom du profil. */
  const status =
    saveState === "error" ? (
      <span className="pf-status bad">{t("profiles.statusError")}</span>
    ) : !complete ? (
      <span className="pf-status warn">
        {t(isNew ? "profiles.statusNew" : "profiles.statusIncomplete", { count: missing })}
        <button type="button" className="link" onClick={reveal}>
          {t("profiles.statusShow")}
        </button>
      </span>
    ) : saveState === "saving" || dirty ? (
      <span className="pf-status">{t("profiles.statusSaving")}</span>
    ) : (
      <span className="pf-status ok">
        <Icon name="check" size={13} />
        {t("profiles.statusSaved")}
      </span>
    );

  return (
    <div className="profiles-page">
      <aside className="pf-list" aria-label={t("profiles.title")}>
        <div className="pf-list-head">
          <h1>{t("profiles.title")}</h1>
          <button className="icon-btn" aria-label={t("profiles.close")} title={t("profiles.close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {profiles.map((p) => {
          const on = draft?.id === p.id;
          const name = on && draft ? draft.name.trim() || p.name : p.name;
          return (
            <button
              key={p.id}
              type="button"
              className={on ? "pf-item on" : "pf-item"}
              aria-current={on || undefined}
              title={name}
              onClick={() => !on && leave(() => show(p))}
            >
              <Avatar profile={on && draft ? draft : p} />
              <span className="pf-item-text">
                <strong>{name}</strong>
                <span>{on && !complete ? t("profiles.incomplete") : t("profiles.repoCount", { count: reposOf(p.id).length })}</span>
              </span>
            </button>
          );
        })}
        {isNew && draft && (
          <button type="button" className="pf-item on" aria-current>
            <Avatar profile={draft} />
            <span className="pf-item-text">
              <strong>{draft.name.trim() || t("profiles.newName")}</strong>
              <span>{complete ? t("profiles.statusSaving") : t("profiles.incomplete")}</span>
            </span>
          </button>
        )}
        <button type="button" className="btn pf-new" onClick={() => leave(() => setDraft(blank()))}>
          <Icon name="plus" size={15} />
          {t("profiles.new")}
        </button>
        {draft && profiles.length <= 1 && <p className="pf-hint">{t("profiles.hint")}</p>}
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
          <>
            <div className="pf-sheet">
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
                    <h2>{draft.name.trim() || t("profiles.newName")}</h2>
                    <div className="pf-head-sub">
                      <span role="status">{status}</span>
                      {draft.image && (
                        <button type="button" className="link pf-image-remove" onClick={() => patch({ image: null })}>
                          {t("profiles.imageRemove")}
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={isNew || !complete}
                    onClick={() =>
                      leave(() =>
                        setDraft({ ...cleaned(draft), id: newProfileId(), name: t("profiles.copyName", { name: draft.name.trim() }), color: nextColor(profiles) }),
                      )
                    }
                  >
                    <Icon name="copy" size={15} />
                    {t("profiles.duplicate")}
                  </button>
                  <button type="button" className="btn danger-text" onClick={remove}>
                    <Icon name="trash" size={15} />
                    {t("profiles.delete")}
                  </button>
                </header>

              {/* Deux colonnes quand la place le permet : l'identité, la clé et la signature à
                  gauche ; la sélection automatique, les comptes et les dépôts à droite. */}
              <div className="pf-cols">
                <form
                  className="pf-form pf-col"
                  // Nos propres messages, pas la bulle du navigateur.
                  noValidate
                  aria-label={draft.name.trim() || t("profiles.newName")}
                  onSubmit={(e) => {
                    // Entrée dans un champ : enregistre tout de suite (ou signale ce qui manque).
                    e.preventDefault();
                    if (complete) void persist(draft);
                    else reveal();
                  }}
                >

                  <section className="st-sec" aria-labelledby="pf-identity">
                    <h3 id="pf-identity" className="eyebrow">
                      {t("profiles.identity")}
                    </h3>
                    <p className="pf-note">{t("profiles.identityHint")}</p>
                    {field("pf-name", "name", t("profiles.name"), draft.name, (name) => patch({ name }), nameError, {
                      placeholder: t("profiles.namePlaceholder"),
                      ref: nameInput,
                    })}
                    {field("pf-user", "user", t("profiles.userName"), draft.userName, (userName) => patch({ userName }), userError)}
                    {field("pf-email", "email", t("profiles.userEmail"), draft.userEmail, (userEmail) => patch({ userEmail }), emailError, { type: "email" })}
                    <Row id="pf-color" title={t("profiles.color")}>
                      <ColorChoice value={draft.color} label={t("profiles.color")} onChange={(color) => color !== undefined && patch({ color })} />
                    </Row>
                  </section>

                  <section className="st-sec" aria-labelledby="pf-ssh">
                    <h3 id="pf-ssh" className="eyebrow">
                      {t("profiles.ssh")}
                    </h3>
                    <Row id="pf-key-label" htmlFor="pf-key" title={t("profiles.sshKey")}>
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
                    </Row>
                  </section>

                  <SigningSection
                    draft={draft}
                    patch={patch}
                    showError={shown("signKey")}
                    onBlurKey={() => touchOnBlur("signKey")}
                    home={home}
                    keyReload={keyReload}
                    onPassphrase={storePassphrase}
                  />
                </form>

                {/* Règles, comptes et dépôts : écrits par leurs propres actions, hors du formulaire. */}
                <div className="pf-col">
                  <section className="st-sec" aria-labelledby="pf-rules">
                    <h3 id="pf-rules" className="eyebrow">
                      {t("profiles.rules")}
                    </h3>
                    <p className="pf-note">{t("profiles.rulesHint")}</p>
                    {draft.rules.length > 0 && (
                      <ul className="pf-rules">
                        {draft.rules.map((rule) => {
                          const hits = ruleRepos(rule);
                          const kind = ruleKind(rule);
                          return (
                            <li key={rule}>
                              <Icon name={kind === "folder" ? "folder" : "cloud"} size={13} />
                              <span className="mono pf-rule-text" title={kind === "folder" ? t("profiles.ruleFolder") : t("profiles.ruleHost")}>
                                {rule}
                              </span>
                              <span className="pf-rule-hits" title={hits.map((r) => r.alias ?? r.name).join("\n") || undefined}>
                                {t("profiles.ruleHits", { count: hits.length })}
                              </span>
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label={t("profiles.removeRule", { rule })}
                                title={t("profiles.removeRule", { rule })}
                                onClick={() => patch({ rules: draft.rules.filter((r) => r !== rule) })}
                              >
                                <Icon name="close" size={13} />
                              </button>
                            </li>
                          );
                        })}
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
                    <p className="pf-rule-examples">
                      <span>{t("profiles.ruleExamples")}</span>
                      {/* Exemples (séparés par « | ») : un clic les copie dans le champ. */}
                      {t("profiles.ruleExampleList").split("|").map((ex) => (
                        <button key={ex} type="button" className="pf-example mono" onClick={() => setNewRule(ex)}>
                          {ex}
                        </button>
                      ))}
                    </p>
                    {newRule.trim() && <p className="pf-note">{t("profiles.ruleHitsNew", { count: ruleRepos(newRule.trim()).length })}</p>}
                  </section>
                  <section className="st-sec" aria-labelledby="pf-accounts">
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

                  {!isNew && (
                    <section className="st-sec" aria-labelledby="pf-repos">
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
                </div>
              </div>
            </div>
          </>
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
  showError,
  onBlurKey,
  home,
  keyReload,
  onPassphrase,
}: {
  draft: Profile;
  patch: (p: Partial<Profile>) => void;
  /** Le champ de la clé SSH de signature a été quitté (ou les erreurs sont demandées). */
  showError: boolean;
  onBlurKey: () => void;
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
  const missing = showError && signingKeyMissing(draft);

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
    <section className="st-sec" aria-labelledby="pf-signing">
      <h3 id="pf-signing" className="eyebrow">
        {t("profiles.signing")}
      </h3>
      <Row id="pf-signing-mode" title={t("profiles.signingMode")}>
        <Segmented<SigningMode>
          labelledBy="pf-signing"
          value={mode}
          onChange={(m) => patch({ signing: m, signingKey: m === mode ? draft.signingKey : null })}
          options={modes.map((m) => ({ value: m, label: t(`profiles.signing_${m || "config"}`), hint: t(`profiles.signingHint_${m || "config"}`) }))}
        />
      </Row>

      {mode === "gpg" && (
        <Row id="pf-gpg-label" htmlFor="pf-gpg" title={t("profiles.gpgKey")}>
          {gpg.status === "error" ? (
            <p className="pf-key bad" role="alert">
              <Icon name="alert" size={15} />
              {errorMessage(t, gpg.error)}
            </p>
          ) : (
            <select id="pf-gpg" className="pf-input pf-input-md" value={chosen?.id ?? key} disabled={gpg.status === "loading"} onChange={(e) => patch({ signingKey: e.target.value || null })}>
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
        </Row>
      )}

      {mode === "ssh" && (
        <Row id="pf-sign-key-label" htmlFor="pf-sign-key" title={t("profiles.sshSigningKey")}>
          <div className="pf-row">
            <input
              id="pf-sign-key"
              className="pf-input mono"
              value={key}
              placeholder={draft.sshKey?.trim() || "~/.ssh/id_ed25519"}
              onChange={(e) => patch({ signingKey: e.target.value })}
              onBlur={onBlurKey}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={missing}
              aria-describedby={missing ? "pf-sign-key-error" : undefined}
            />
            <button type="button" className="btn" onClick={browse}>
              {t("profiles.browse")}
            </button>
          </div>
          {missing ? (
            <span id="pf-sign-key-error" className="input-error">
              {t("profiles.sshSigningMissing")}
            </span>
          ) : ownSshKey ? (
            <KeyStatus state={sshKeyState} onPassphrase={(store) => onPassphrase(key.replace(/\.pub$/, ""), store)} />
          ) : (
            !key.trim() && draft.sshKey?.trim() && <p className="pf-note">{t("profiles.sshSigningDefault")}</p>
          )}
        </Row>
      )}
    </section>
  );
}
