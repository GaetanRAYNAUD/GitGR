// Page des paramètres de l'app (bouton ⚙ de la barre de titre). Chaque changement est
// enregistré tout de suite.

import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BranchColorsEditor } from "../components/BranchColorsEditor";
import { Flag } from "../components/Flag";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import type { LanguageSetting, PullStrategy, ThemeSetting } from "../lib/types";
import { RELEASES_URL, releaseUrl, updateMode } from "../lib/updates";
import { useApp } from "../store/app";
import { useUpdates } from "../store/updates";

/** Bas de la page : version installée, recherche et installation des mises à jour. */
function UpdatesFooter() {
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
  else if (status === "ready" && update)
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
  else if (update && (status === "available" || status === "error"))
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
  const failed = status === "error" && error ? <span className="settings-update-error">{update ? t("updates.installFailed", { error }) : t("updates.checkFailed", { error })}</span> : null;

  return (
    <footer className="settings-version">
      <div className="settings-version-row">
        <span>{t("settings.version", { version: __APP_VERSION__ })}</span>
        <button type="button" className="link" onClick={() => open(RELEASES_URL)}>
          {t("settings.releaseNotes")}
        </button>
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
      </div>
      {mode === "auto" && (
        <label className="menu-check">
          <input type="checkbox" checked={!autoOff} onChange={(e) => updateSettings({ autoUpdateOff: !e.target.checked })} />
          {t("updates.autoInstall")}
        </label>
      )}
      {(line || failed) && (
        <div className="settings-version-row" role="status">
          {line}
          {failed}
        </div>
      )}
    </footer>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            title={o.title}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "seg on" : "seg"}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Intervalles proposés pour le fetch automatique (0 : désactivé). */
const FETCH_MINUTES = ["0", "5", "10", "30"] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const close = useApp((s) => s.closeSettings);

  // Échap ferme la page, où que soit le focus (sauf dans un champ de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest?.("input, textarea")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="settings-page" role="region" aria-labelledby="st-title">
      <div className="settings-inner">
        <div className="settings-head">
          <h1 id="st-title">{t("settings.title")}</h1>
          <button className="icon-btn" aria-label={t("settings.close")} title={t("settings.close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <section className="settings-sec" aria-labelledby="st-look">
          <h2 id="st-look" className="eyebrow">{t("settings.sectionLook")}</h2>
          <Segmented<ThemeSetting>
            label={t("settings.theme")}
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: "system", label: t("settings.themeSystem") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
          />
          <Segmented<LanguageSetting>
            label={t("settings.language")}
            value={settings.language}
            onChange={(language) => update({ language })}
            options={[
              { value: "system", label: t("settings.languageSystem"), icon: <Icon name="globe" size={14} /> },
              { value: "fr", label: "Français", icon: <Flag lang="fr" /> },
              { value: "en", label: "English", icon: <Flag lang="en" /> },
            ]}
          />
        </section>

        <section className="settings-sec" aria-labelledby="st-git">
          <h2 id="st-git" className="eyebrow">{t("settings.sectionGit")}</h2>
          <Segmented<PullStrategy>
            label={t("settings.pullStrategy")}
            value={settings.pullStrategy ?? "ff-only"}
            onChange={(pullStrategy) => update({ pullStrategy })}
            // Libellés courts (trois boutons sur une ligne) ; le détail en infobulle.
            options={(["ff-only", "merge", "rebase"] as const).map((s) => ({
              value: s,
              label: t(`pull.${s}Short`),
              title: t(`pull.${s === "ff-only" ? "ffOnly" : s}Hint`),
            }))}
          />
          <Segmented<(typeof FETCH_MINUTES)[number]>
            label={t("settings.autoFetch")}
            value={String(settings.autoFetchMinutes ?? 10) as (typeof FETCH_MINUTES)[number]}
            onChange={(m) => update({ autoFetchMinutes: Number(m) })}
            options={FETCH_MINUTES.map((m) => ({ value: m, label: m === "0" ? t("settings.autoFetchOff") : t("settings.minutes", { count: Number(m) }) }))}
          />
          <label className="menu-check">
            <input type="checkbox" checked={settings.autoStash ?? true} onChange={(e) => update({ autoStash: e.target.checked })} />
            {t("settings.autoStash")}
          </label>
        </section>

        <section className="settings-sec" aria-labelledby="st-notif">
          <h2 id="st-notif" className="eyebrow">{t("settings.sectionNotifications")}</h2>
          <label className="menu-check">
            <input type="checkbox" checked={!settings.notificationsOff} onChange={(e) => update({ notificationsOff: !e.target.checked })} />
            {t("settings.notifications")}
          </label>
          <Segmented<"standard" | "fast">
            label={t("settings.notificationSpeed")}
            value={settings.notificationSpeed ?? "standard"}
            onChange={(notificationSpeed) => update({ notificationSpeed })}
            options={(["standard", "fast"] as const).map((s) => ({ value: s, label: t(`settings.speed.${s}`), title: t(`settings.speedHint.${s}`) }))}
          />
          <label className="menu-check">
            <input type="checkbox" checked={!settings.systemNotificationsOff} disabled={!!settings.notificationsOff} onChange={(e) => update({ systemNotificationsOff: !e.target.checked })} />
            {t("settings.systemNotifications")}
          </label>
          <p className="menu-hint">{t("settings.notificationsHint")}</p>
        </section>

        <section className="settings-sec" aria-labelledby="st-graph">          <h2 id="st-graph" className="eyebrow">{t("settings.sectionGraph")}</h2>
          <label className="menu-check">
            <input type="checkbox" checked={!settings.graphAvatarsOff} onChange={(e) => update({ graphAvatarsOff: !e.target.checked })} />
            {t("settings.graphAvatars")}
          </label>
          <p className="settings-help">{t("settings.graphAvatarsHint")}</p>
          <label className="menu-check">
            <input type="checkbox" checked={!settings.branchColorsOff} onChange={(e) => update({ branchColorsOff: !e.target.checked })} />
            {t("settings.branchColors")}
          </label>
          <BranchColorsEditor disabled={settings.branchColorsOff} />
        </section>

        <UpdatesFooter />
      </div>
    </div>
  );
}
