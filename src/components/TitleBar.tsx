import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { repoColor, useApp } from "../store/app";
import { Icon } from "./Icon";
import { SettingsMenu } from "./SettingsMenu";

/** Barre de titre personnalisée : logo, onglets de dépôts, réglages, contrôles de fenêtre.
 *  `data-tauri-drag-region` rend les zones vides déplaçables (double-clic = agrandir). */
export function TitleBar() {
  const { t } = useTranslation();
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const repos = useApp((s) => s.repos);
  const activate = useApp((s) => s.activate);
  const closeTab = useApp((s) => s.closeTab);

  const nameOf = (path: string) => repos.find((r) => r.path === path)?.name ?? path;

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        className={active === null ? "brand on" : "brand"}
        onClick={() => activate(null)}
        title={`${t("tabs.home")} (Ctrl T)`}
        aria-label={t("tabs.home")}
      >
        <span className="brand-mark">
          <Icon name="logo" size={14} />
        </span>
        <span>{t("app.name")}</span>
      </button>

      <div className="tabs" role="tablist" data-tauri-drag-region>
        {tabs.map((path) => {
          const name = nameOf(path);
          const on = path === active;
          return (
            <div
              key={path}
              className={on ? "tab on" : "tab"}
              title={path}
              onAuxClick={(e) => e.button === 1 && closeTab(path)}
            >
              <button role="tab" aria-selected={on} className="tab-main" onClick={() => activate(path)}>
                <span className="dot" style={{ background: repoColor(path) }} />
                <span className="tab-name">{name}</span>
              </button>
              <button className="tab-close" aria-label={t("tabs.close", { name })} onClick={() => closeTab(path)}>
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}
        <button
          className={active === null ? "tab-new on" : "tab-new"}
          aria-label={t("tabs.new")}
          title={`${t("tabs.new")} (Ctrl T)`}
          onClick={() => activate(null)}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      <div className="titlebar-spacer" data-tauri-drag-region />

      <SettingsMenu />

      <div className="window-controls">
        <button className="wc" aria-label={t("window.minimize")} onClick={() => api.window.minimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="wc" aria-label={t("window.maximize")} onClick={() => api.window.toggleMaximize()}>
          <Icon name="maximize" size={13} />
        </button>
        <button className="wc wc-close" aria-label={t("window.close")} onClick={() => api.window.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  );
}
