import { type ReactNode, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageSetting, PullStrategy, ThemeSetting } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { useProfiles } from "../store/profiles";
import { BranchColorsDialog } from "./BranchColorsDialog";
import { Flag } from "./Flag";
import { Icon } from "./Icon";

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

/** Menu rapide de réglages (thème, langue, git) dans la barre de titre. */
export function SettingsMenu() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div className="settings" ref={ref}>
      <button
        className="wc"
        aria-label={t("settings.title")}
        aria-expanded={open}
        title={t("settings.title")}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="settings" size={16} />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={t("settings.title")}>
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
          <div className="menu-check-row">
            <label className="menu-check">
              <input
                type="checkbox"
                checked={!settings.branchColorsOff}
                onChange={(e) => update({ branchColorsOff: !e.target.checked })}
              />
              {t("settings.branchColors")}
            </label>
            <button
              className="btn sm"
              onClick={() => {
                setOpen(false);
                setRulesOpen(true);
              }}
            >
              {t("settings.branchColorsEdit")}
            </button>
          </div>
          <div className="field">
            <span className="field-label">{t("settings.profiles")}</span>
            <button
              className="btn"
              onClick={() => {
                setOpen(false);
                useProfiles.getState().openPage();
              }}
            >
              <Icon name="user" size={15} />
              {t("settings.manageProfiles")}
            </button>
          </div>
        </div>
      )}
      {rulesOpen && <BranchColorsDialog onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
