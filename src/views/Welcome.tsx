import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloneDialog } from "../components/CloneDialog";
import { Icon, type IconName } from "../components/Icon";
import { relativeTime } from "../lib/format";
import { repoColor, repoName, useApp } from "../store/app";

function useRelativeTime() {
  const { t } = useTranslation();
  return (ms: number) => {
    const r = relativeTime(ms);
    return t(`time.${r.key}`, { count: r.count });
  };
}

function Action({
  icon,
  title,
  hint,
  onClick,
  soon,
}: {
  icon: IconName;
  title: string;
  hint: string;
  onClick?: () => void;
  soon?: string;
}) {
  return (
    <button className="action" onClick={onClick} disabled={!onClick}>
      <span className="action-icon">
        <Icon name={icon} size={20} />
      </span>
      <span>
        <span className="action-title">
          {title}
          {soon && <span className="soon">{soon}</span>}
        </span>
        <span className="action-hint">{hint}</span>
      </span>
    </button>
  );
}

/** Écran d'accueil : actions d'ouverture et dépôts récents. */
export function Welcome() {
  const { t } = useTranslation();
  const repos = useApp((s) => s.repos);
  const git = useApp((s) => s.git);
  const openPath = useApp((s) => s.openPath);
  const pickAndOpen = useApp((s) => s.pickAndOpen);
  const forget = useApp((s) => s.forget);
  const [q, setQ] = useState("");
  const [cloning, setCloning] = useState(false);
  const ago = useRelativeTime();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((r) => repoName(r).toLowerCase().includes(needle) || r.path.toLowerCase().includes(needle));
  }, [repos, q]);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div>
          <h1>{t("welcome.title")}</h1>
          <p className="muted">{t("welcome.subtitle")}</p>
        </div>

        <div className="actions">
          <Action
            icon="folder"
            title={t("welcome.open")}
            hint={t("welcome.openHint")}
            onClick={() => pickAndOpen(t("welcome.pickTitle"))}
          />
          <Action icon="pull" title={t("welcome.clone")} hint={t("welcome.cloneHint")} onClick={() => setCloning(true)} />
          <Action icon="plus" title={t("welcome.init")} hint={t("welcome.initHint")} soon={t("welcome.soon")} />
        </div>

        <section>
          <div className="section-head">
            <h2 className="eyebrow">{t("welcome.recent")}</h2>
            {repos.length > 0 && (
              <label className="search">
                <Icon name="search" size={15} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("welcome.search")}
                  aria-label={t("welcome.search")}
                />
              </label>
            )}
          </div>

          <div className="card repo-list">
            {repos.length === 0 && <p className="empty">{t("welcome.empty")}</p>}
            {repos.length > 0 && filtered.length === 0 && <p className="empty">{t("welcome.noMatch", { q })}</p>}
            {filtered.map((r) => (
              <div key={r.path} className="repo-row">
                <button className="repo-open" onClick={() => openPath(r.path)} title={r.path}>
                  <span className="dot lg" style={{ background: repoColor(r.path, r.color) }} />
                  <span className="repo-text">
                    <span className="repo-name">{repoName(r)}</span>
                    <span className="repo-path mono">{r.path}</span>
                  </span>
                  <span className="repo-when">{t("welcome.openedAt", { when: ago(r.lastOpened) })}</span>
                </button>
                <button
                  className="icon-btn"
                  aria-label={t("welcome.forget", { name: repoName(r) })}
                  title={t("welcome.forget", { name: repoName(r) })}
                  onClick={() => forget(r.path)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {git?.found && (
          <p className="git-ok">
            <Icon name="check" size={15} />
            {t("welcome.gitDetected", { version: git.version })}
          </p>
        )}
      </div>
      {cloning && <CloneDialog onClose={() => setCloning(false)} />}
    </div>
  );
}
