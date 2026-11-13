import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { GitMissing } from "./components/GitMissing";
import { Icon } from "./components/Icon";
import { TitleBar } from "./components/TitleBar";
import { resolveLanguage } from "./i18n";
import { useApp } from "./store/app";
import { RepoView } from "./views/RepoView";
import { Welcome } from "./views/Welcome";

/** Applique le thème choisi (ou celui de l'OS) via `data-theme` sur <html>. */
function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = effective;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function useLanguage() {
  const language = useApp((s) => s.settings.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    const lng = resolveLanguage(language);
    if (i18n.language !== lng) i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
  }, [language, i18n]);
}

/** Raccourcis globaux : Ctrl+Tab, Ctrl+W, Ctrl+T, Ctrl+O, Ctrl+1..9, F5,
 *  Ctrl+Maj+PageUp / PageDown pour déplacer l'onglet actif. */
function useShortcuts() {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && (e.key === "PageUp" || e.key === "PageDown")) {
        if (s.active) s.moveTab(s.active, s.tabs.indexOf(s.active) + (e.key === "PageUp" ? -1 : 1));
      } else if (ctrl && e.key === "Tab") {
        s.cycleTab(e.shiftKey ? -1 : 1);
      } else if (ctrl && e.key.toLowerCase() === "w") {
        if (s.active) s.closeTab(s.active);
      } else if (ctrl && e.key.toLowerCase() === "t") {
        s.activate(null);
      } else if (ctrl && e.key.toLowerCase() === "o") {
        s.pickAndOpen(t("welcome.pickTitle"));
      } else if (ctrl && /^[1-9]$/.test(e.key)) {
        const path = s.tabs[Number(e.key) - 1];
        if (path) s.activate(path);
      } else if (e.key === "F5") {
        if (s.active) s.refreshSummary(s.active);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);
}

/** Rafraîchit le dépôt actif quand la fenêtre reprend le focus (modifs faites ailleurs). */
function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => {
      const { active, refreshSummary } = useApp.getState();
      if (active) refreshSummary(active);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}

export default function App() {
  const { t } = useTranslation();
  const ready = useApp((s) => s.ready);
  const git = useApp((s) => s.git);
  const active = useApp((s) => s.active);
  const error = useApp((s) => s.error);
  const dismissError = useApp((s) => s.dismissError);
  const init = useApp((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);
  useTheme();
  useLanguage();
  useShortcuts();
  useRefreshOnFocus();

  return (
    <div className="app">
      <TitleBar />
      <main className="content">{ready && (active ? <RepoView key={active} path={active} /> : <Welcome />)}</main>

      {error && (
        <div className="toast error" role="alert">
          <Icon name="alert" />
          <span>{t(`errors.${error}`, { defaultValue: error })}</span>
          <button className="link" onClick={dismissError}>
            {t("errors.dismiss")}
          </button>
        </div>
      )}

      {ready && git && !git.found && <GitMissing />}
    </div>
  );
}
