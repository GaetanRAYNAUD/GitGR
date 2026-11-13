import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useApp } from "../store/app";
import { Icon } from "./Icon";

const isLinux = navigator.userAgent.toLowerCase().includes("linux");

/** Fenêtre bloquante affichée quand `git` est introuvable au démarrage. */
export function GitMissing() {
  const { t } = useTranslation();
  const recheck = useApp((s) => s.recheckGit);

  return (
    <div className="overlay">
      <div className="dialog" role="alertdialog" aria-labelledby="git-missing-title">
        <div className="dialog-icon">
          <Icon name="alert" size={22} />
        </div>
        <h2 id="git-missing-title">{t("gitMissing.title")}</h2>
        <p>{t("gitMissing.body")}</p>
        {isLinux && <p className="muted small">{t("gitMissing.linuxHint")}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={() => recheck()}>
            {t("gitMissing.retry")}
          </button>
          {/* Git embarqué (MinGit portable sous Windows) : prévu dans une étape suivante. */}
          <button className="btn" disabled title={t("repo.comingSoon")}>
            {t("gitMissing.embedded")}
          </button>
          <button className="btn primary" onClick={() => api.openUrl("https://git-scm.com/downloads")}>
            {t("gitMissing.download")}
          </button>
        </div>
      </div>
    </div>
  );
}
