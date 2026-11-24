// Page des paramètres de l'app (bouton ⚙ de la barre de titre). Chaque changement est
// enregistré tout de suite. Même structure que la page des profils : les sections à gauche,
// le contenu aligné à gauche ; une ligne par réglage (libellé, contrôle, aide dessous).

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BranchColorsEditor } from "../components/BranchColorsEditor";
import { Flag } from "../components/Flag";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { onRadioGroupKeyDown, radioTabIndex } from "../lib/radioKeys";
import type { LanguageSetting, PullStrategy, ThemeSetting } from "../lib/types";
import { RELEASES_URL, releaseUrl, updateMode } from "../lib/updates";
import { useApp } from "../store/app";
import { useDialogs } from "../store/dialogs";
import { useUpdates } from "../store/updates";

type IconName = Parameters<typeof Icon>[0]["name"];

/** Sections de la page, dans l'ordre (barre latérale et contenu). */
const SECTIONS = [
  { id: "look", label: "settings.sectionLook", icon: "eye" },
  { id: "git", label: "settings.sectionGit", icon: "branch" },
  { id: "notif", label: "settings.sectionNotifications", icon: "bell" },
  { id: "graph", label: "settings.sectionGraph", icon: "commit" },
  { id: "about", label: "settings.sectionAbout", icon: "cloud" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

type SectionId = (typeof SECTIONS)[number]["id"];

/** Une ligne de réglage : libellé à gauche, contrôle à droite, aide dessous sur toute la
 *  largeur. */
function Row({ id, title, help, disabled, children }: { id: string; title: ReactNode; help?: ReactNode; disabled?: boolean; children: ReactNode }) {
  return (
    <div className={disabled ? "st-row off" : "st-row"}>
      <span id={id} className="st-row-title">
        {title}
      </span>
      <div className="st-row-control">{children}</div>
      {help && (
        <p id={`${id}-help`} className="st-row-help">
          {help}
        </p>
      )}
    </div>
  );
}

/** Réglage oui / non : la case devant son libellé, l'aide dessous ; toute la ligne coche la
 *  case. */
function Check({ id, title, help, checked, disabled, onChange }: { id: string; title: string; help?: ReactNode; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={disabled ? "st-check off" : "st-check"}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={id}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span id={id} className="st-row-title">
        {title}
      </span>
      {help && (
        <span id={`${id}-help`} className="st-row-help">
          {help}
        </span>
      )}
    </label>
  );
}

/** Choix exclusif : un seul arrêt de tabulation, les flèches changent l'option. L'aide de
 *  l'option choisie s'affiche dessous. */
function Segmented<T extends string>({
  labelledBy,
  rowHelp,
  value,
  options,
  disabled,
  onChange,
}: {
  labelledBy: string;
  /** La ligne a une aide (`<labelledBy>-help`) : le groupe la cite aussi. */
  rowHelp?: boolean;
  value: T;
  options: { value: T; label: string; icon?: ReactNode; hint?: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  const hint = options.find((o) => o.value === value)?.hint;
  // Aide de la ligne (`rowHelp`) et aide de l'option choisie.
  const describedBy = [rowHelp ? `${labelledBy}-help` : "", hint ? `${labelledBy}-option` : ""].filter(Boolean).join(" ") || undefined;
  const anyChecked = options.some((o) => o.value === value);
  return (
    <>
      <div
        className="segmented"
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onRadioGroupKeyDown}
      >
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={radioTabIndex(o.value === value, i === 0, anyChecked)}
            disabled={disabled}
            className={o.value === value ? "seg on" : "seg"}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      {hint && (
        <p id={`${labelledBy}-option`} className="st-option-help">
          {hint}
        </p>
      )}
    </>
  );
}

/** Section « À propos » : version installée, recherche et installation des mises à jour. */
function AboutSection() {
  const { t } = useTranslation();
  const { kind, status, update, percent, error, check, install } = useUpdates();
  const autoOff = useApp((s) => s.settings.autoUpdateOff);
  const updateSettings = useApp((s) => s.updateSettings);
  useEffect(() => {
    // Paquet installé : dit ce qui est possible (rien en développement).
    if (!kind) void api.installKind().then((k) => useUpdates.setState({ kind: k }), () => useUpdates.setState({ kind: "none" }));
  }, [kind]);
  const mode = kind ? updateMode(kind) : null;
  const open = (url: string) => void api.openUrl(url).catch(() => {});

  let line: ReactNode = null;
  if (mode === "none") line = <span>{t("updates.unavailable")}</span>;
  else if (status === "checking") line = <span>{t("updates.checking")}</span>;
  else if (status === "upToDate") line = <span>{t("updates.upToDate")}</span>;
  else if (status === "downloading" && update)
    line = <span>{t("updates.downloadingBackground", { version: update.version, percent: percent ?? 0 })}</span>;
  else if (status === "ready" && update && !autoOff)
    line = (
      <>
        <span>{t("updates.ready", { version: update.version })}</span>
        <button type="button" className="btn primary sm" onClick={() => void install()}>
          {t("updates.restartNow")}
        </button>
        <button type="button" className="link" onClick={() => open(releaseUrl(update.version))}>
          {t("updates.notes")}
        </button>
      </>
    );
  else if (status === "installing") line = <span>{percent === null ? t("updates.installing") : t("updates.downloading", { percent })}</span>;
  else if (update && (status === "available" || status === "ready" || status === "error"))
    line = (
      <>
        <span>{mode === "auto" ? t("updates.available", { version: update.version }) : t("updates.availableManual", { version: update.version })}</span>
        {mode === "auto" && (
          <button type="button" className="btn primary sm" onClick={() => void install()}>
            {t("updates.install")}
          </button>
        )}
        <button type="button" className="link" onClick={() => open(releaseUrl(update.version))}>
          {t("updates.notes")}
        </button>
      </>
    );
  const failed = status === "error" && error ? <span className="st-error">{update ? t("updates.installFailed", { error }) : t("updates.checkFailed", { error })}</span> : null;

  return (
    <>
      <Row id="st-version" title={t("settings.version", { version: __APP_VERSION__ })}>
        <div className="st-inline">
          {mode && mode !== "none" && (
            <button
              type="button"
              className="btn sm"
              disabled={status === "checking" || status === "downloading" || status === "ready" || status === "installing"}
              onClick={() => void check()}
            >
              {t("updates.check")}
            </button>
          )}
          <button type="button" className="link" onClick={() => open(RELEASES_URL)}>
            {t("settings.releaseNotes")}
          </button>
        </div>
        {(line || failed) && (
          <div className="st-inline st-status" role="status">
            {line}
            {failed}
          </div>
        )}
      </Row>
      {mode === "auto" && <Check id="st-auto-install" title={t("updates.autoInstall")} checked={!autoOff} onChange={(v) => updateSettings({ autoUpdateOff: !v })} />}
    </>
  );
}

/** Intervalles proposés pour le fetch automatique (0 : désactivé). */
const FETCH_MINUTES = ["0", "5", "10", "30"] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const close = useApp((s) => s.closeSettings);
  const main = useRef<HTMLDivElement>(null);
  const firstNav = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<SectionId>("look");

  // Échap ferme la page, où que soit le focus (sauf dans un champ de saisie ou sous une
  // fenêtre de confirmation, qui se ferme seule).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || useDialogs.getState().current) return;
      if (!(e.target as HTMLElement | null)?.closest?.("input, textarea")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // À l'ouverture, le focus entre dans la page (première section de la barre latérale).
  useEffect(() => firstNav.current?.focus({ preventScroll: true }), []);

  // Section en cours : la dernière dont le titre est passé en haut du contenu (la dernière
  // section tout court quand on est en bas).
  const onScroll = () => {
    const el = main.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return setActive(SECTIONS[SECTIONS.length - 1].id);
    const top = el.getBoundingClientRect().top;
    let cur: SectionId = SECTIONS[0].id;
    for (const s of SECTIONS) {
      const sec = document.getElementById(`st-sec-${s.id}`);
      if (sec && sec.getBoundingClientRect().top - top <= 24) cur = s.id;
    }
    setActive(cur);
  };

  const goTo = (id: SectionId) => {
    const sec = document.getElementById(`st-sec-${id}`);
    const el = main.current;
    if (!sec || !el) return;
    // Le focus suit (avant le défilement, qu'il interromprait), pour que Tab continue dans la
    // section choisie.
    document.getElementById(`st-h-${id}`)?.focus({ preventScroll: true });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const top = el.scrollTop + sec.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    el.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    setActive(id);
  };

  const notifOff = !!settings.notificationsOff;

  return (
    <div className="settings-page" role="region" aria-labelledby="st-title">
      <nav className="pf-list st-nav" aria-label={t("settings.sections")}>
        <div className="pf-list-head">
          <h1 id="st-title">{t("settings.title")}</h1>
          <button className="icon-btn" aria-label={t("settings.close")} title={t("settings.close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            ref={i === 0 ? firstNav : undefined}
            type="button"
            className={active === s.id ? "st-nav-item on" : "st-nav-item"}
            aria-current={active === s.id || undefined}
            onClick={() => goTo(s.id)}
          >
            <Icon name={s.icon} size={15} />
            {t(s.label)}
          </button>
        ))}
      </nav>

      <div className="st-main" ref={main} onScroll={onScroll}>
        <div className="st-form">
          <section id="st-sec-look" className="st-sec" aria-labelledby="st-h-look">
            <h2 id="st-h-look" className="eyebrow" tabIndex={-1}>
              {t("settings.sectionLook")}
            </h2>
            <Row id="st-theme" title={t("settings.theme")}>
              <Segmented<ThemeSetting>
                labelledBy="st-theme"
                value={settings.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: "system", label: t("settings.themeSystem") },
                  { value: "light", label: t("settings.themeLight") },
                  { value: "dark", label: t("settings.themeDark") },
                ]}
              />
            </Row>
            <Row id="st-language" title={t("settings.language")}>
              <Segmented<LanguageSetting>
                labelledBy="st-language"
                value={settings.language}
                onChange={(language) => update({ language })}
                options={[
                  { value: "system", label: t("settings.languageSystem"), icon: <Icon name="globe" size={14} /> },
                  { value: "fr", label: "Français", icon: <Flag lang="fr" /> },
                  { value: "en", label: "English", icon: <Flag lang="en" /> },
                ]}
              />
            </Row>
          </section>

          <section id="st-sec-git" className="st-sec" aria-labelledby="st-h-git">
            <h2 id="st-h-git" className="eyebrow" tabIndex={-1}>
              {t("settings.sectionGit")}
            </h2>
            <Row id="st-pull" title={t("settings.pullStrategy")}>
              <Segmented<PullStrategy>
                labelledBy="st-pull"
                value={settings.pullStrategy ?? "ff-only"}
                onChange={(pullStrategy) => update({ pullStrategy })}
                options={(["ff-only", "merge", "rebase"] as const).map((s) => ({
                  value: s,
                  label: t(`pull.${s}Short`),
                  hint: t(`pull.${s === "ff-only" ? "ffOnly" : s}Hint`),
                }))}
              />
            </Row>
            <Row id="st-fetch" title={t("settings.autoFetch")} help={t("settings.autoFetchHint")}>
              <Segmented<(typeof FETCH_MINUTES)[number]>
                labelledBy="st-fetch"
                rowHelp
                value={String(settings.autoFetchMinutes ?? 10) as (typeof FETCH_MINUTES)[number]}
                onChange={(m) => update({ autoFetchMinutes: Number(m) })}
                options={FETCH_MINUTES.map((m) => ({ value: m, label: m === "0" ? t("settings.autoFetchOff") : t("settings.minutes", { count: Number(m) }) }))}
              />
            </Row>
            <Check
              id="st-autostash"
              title={t("settings.autoStash")}
              help={t("settings.autoStashHint")}
              checked={settings.autoStash ?? true}
              onChange={(autoStash) => update({ autoStash })}
            />
          </section>

          <section id="st-sec-notif" className="st-sec" aria-labelledby="st-h-notif">
            <h2 id="st-h-notif" className="eyebrow" tabIndex={-1}>
              {t("settings.sectionNotifications")}
            </h2>
            <Check
              id="st-notif"
              title={t("settings.notifications")}
              help={t("settings.notificationsHint")}
              checked={!notifOff}
              onChange={(v) => update({ notificationsOff: !v })}
            />
            <Row id="st-speed" title={t("settings.notificationSpeed")} disabled={notifOff}>
              <Segmented<"standard" | "fast">
                labelledBy="st-speed"
                value={settings.notificationSpeed ?? "standard"}
                disabled={notifOff}
                onChange={(notificationSpeed) => update({ notificationSpeed })}
                options={(["standard", "fast"] as const).map((s) => ({ value: s, label: t(`settings.speed.${s}`), hint: t(`settings.speedHint.${s}`) }))}
              />
            </Row>
            <Check
              id="st-sysnotif"
              title={t("settings.systemNotifications")}
              checked={!settings.systemNotificationsOff}
              disabled={notifOff}
              onChange={(v) => update({ systemNotificationsOff: !v })}
            />
          </section>

          <section id="st-sec-graph" className="st-sec" aria-labelledby="st-h-graph">
            <h2 id="st-h-graph" className="eyebrow" tabIndex={-1}>
              {t("settings.sectionGraph")}
            </h2>
            <Check
              id="st-avatars"
              title={t("settings.graphAvatars")}
              help={t("settings.graphAvatarsHint")}
              checked={!settings.graphAvatarsOff}
              onChange={(v) => update({ graphAvatarsOff: !v })}
            />
            <Check
              id="st-bcolors"
              title={t("settings.branchColors")}
              help={t("branchColors.help")}
              checked={!settings.branchColorsOff}
              onChange={(v) => update({ branchColorsOff: !v })}
            />
            <BranchColorsEditor disabled={settings.branchColorsOff} />
          </section>

          <section id="st-sec-about" className="st-sec" aria-labelledby="st-h-about">
            <h2 id="st-h-about" className="eyebrow" tabIndex={-1}>
              {t("settings.sectionAbout")}
            </h2>
            <AboutSection />
          </section>
        </div>
      </div>
    </div>
  );
}
