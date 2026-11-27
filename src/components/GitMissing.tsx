import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { trapTab } from "../lib/focusTrap";
import { useApp } from "../store/app";
import { Icon } from "./Icon";

const isLinux = navigator.userAgent.toLowerCase().includes("linux");

/** Fenêtre bloquante affichée quand `git` est introuvable au démarrage : pas d'Échap, Tab y
 *  reste. « Réessayer » dit ce qu'il fait et ce qu'il trouve. */
export function GitMissing() {
  const { t } = useTranslation();
  const recheck = useApp((s) => s.recheckGit);
  const ref = useRef<HTMLDivElement>(null);
  /** `null` : pas encore réessayé ; sinon le résultat du dernier essai. */
  const [status, setStatus] = useState<"checking" | "missing" | "failed" | null>(null);

  const retry = async () => {
    setStatus("checking");
    try {
      await recheck();
      // Toujours là (sinon la fenêtre a disparu) : Git n'est toujours pas trouvé.
      setStatus("missing");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="overlay">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="git-missing-title"
        aria-describedby="git-missing-body"
        ref={ref}
        onKeyDown={(e) => trapTab(e, ref.current)}
      >
        <div className="dialog-icon">
          <Icon name="alert" />
        </div>
        <h2 id="git-missing-title">{t("gitMissing.title")}</h2>
        <p id="git-missing-body">{t("gitMissing.body")}</p>
        {isLinux && (
          <p className="muted small">
            {t("gitMissing.linuxHint")} <code className="mono">sudo apt install git</code>
          </p>
        )}
        <p className="muted small" role="status">
          {status === "checking" ? t("gitMissing.checking") : status === "missing" ? t("gitMissing.stillMissing") : status === "failed" ? t("gitMissing.checkFailed") : ""}
        </p>
        <div className="dialog-actions">
          <button className={isLinux ? "btn primary" : "btn"} autoFocus={isLinux} disabled={status === "checking"} onClick={() => void retry()}>
            {t("gitMissing.retry")}
          </button>
          {/* Sous Linux, Git s'installe par le gestionnaire de paquets : pas de téléchargement. */}
          {!isLinux && (
            <button className="btn primary" autoFocus onClick={() => void api.openUrl("https://git-scm.com/downloads").catch(() => {})}>
              {t("gitMissing.download")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
