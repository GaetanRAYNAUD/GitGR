import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LanguageSetting, ThemeSetting } from "../lib/types";
import { useApp } from "../store/app";
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
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
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

/** Menu rapide de réglages (thème, langue) dans la barre de titre. */
export function SettingsMenu() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        </div>
      )}
    </div>
  );
}
