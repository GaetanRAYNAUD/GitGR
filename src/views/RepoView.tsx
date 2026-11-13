import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../components/Icon";
import { errorMessage } from "../lib/errors";
import { remoteHost } from "../lib/format";
import { useApp } from "../store/app";

const TOOLS: { key: string; icon: IconName; sep?: boolean }[] = [
  { key: "pull", icon: "pull" },
  { key: "push", icon: "push" },
  { key: "fetch", icon: "fetch" },
  { key: "branch", icon: "branch", sep: true },
  { key: "stash", icon: "stash" },
  { key: "pop", icon: "pop" },
];

/** Vue d'un dépôt ouvert. Étape 1 : barre d'outils + résumé ; le graphe arrive à l'étape 2. */
export function RepoView({ path }: { path: string }) {
  const { t } = useTranslation();
  const repo = useApp((s) => s.repos.find((r) => r.path === path));
  const summary = useApp((s) => s.summaries[path]);
  const refresh = useApp((s) => s.refreshSummary);
  const data = summary?.data;

  const branchLabel = data ? (data.branch ?? t("repo.detached")) : "…";

  return (
    <div className="repo-view">
      <div className="toolbar">
        <div className="branch-chip" title={path}>
          <span className="branch-chip-repo">{repo?.name}</span>
          <span className="branch-chip-name">{branchLabel}</span>
        </div>

        <div className="tools">
          {TOOLS.map((tool) => (
            <span key={tool.key} className="tool-wrap">
              {tool.sep && <span className="tool-sep" />}
              <button className="tbtn" disabled title={t("repo.comingSoon")}>
                <Icon name={tool.icon} />
                <span>{t(`repo.${tool.key}`)}</span>
                {tool.key === "push" && !!data?.ahead && <span className="badge">{data.ahead}</span>}
                {tool.key === "pull" && !!data?.behind && <span className="badge">{data.behind}</span>}
              </button>
            </span>
          ))}
        </div>

        <button className="tbtn" onClick={() => refresh(path)} title={`${t("repo.refresh")} (F5)`}>
          <Icon name="fetch" />
          <span>{t("repo.refresh")}</span>
        </button>
      </div>

      <div className="repo-body">
        {summary?.error ? (
          <div className="notice error" role="alert">
            <Icon name="alert" />
            {errorMessage(t, summary.error)}
          </div>
        ) : !data ? (
          <p className="muted">{t("repo.loading")}</p>
        ) : (
          <div className="summary card">
            <dl>
              <dt>{t("repo.branchLabel")}</dt>
              <dd>
                <strong>{branchLabel}</strong>
              </dd>
              <dt>{t("repo.upstream")}</dt>
              <dd>
                {data.upstream ? (
                  <>
                    <span className="mono">{data.upstream}</span>
                    <span className="muted">
                      {" · "}
                      {data.ahead === 0 && data.behind === 0
                        ? t("repo.upToDate")
                        : [
                            data.ahead ? t("repo.ahead", { count: data.ahead }) : null,
                            data.behind ? t("repo.behind", { count: data.behind }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                  </>
                ) : (
                  <span className="muted">{t("repo.noUpstream")}</span>
                )}
              </dd>
              <dt>{t("repo.head")}</dt>
              <dd className="mono">{data.head ? data.head.slice(0, 7) : t("repo.noCommit")}</dd>
              <dt>{t("repo.workingTree")}</dt>
              <dd>{data.changes ? t("repo.changes", { count: data.changes }) : t("repo.clean")}</dd>
              <dt>{t("repo.remote")}</dt>
              <dd className="mono">{data.remoteUrl ?? <span className="muted">{t("repo.noRemote")}</span>}</dd>
              <dt>{t("repo.path")}</dt>
              <dd className="mono">{path}</dd>
            </dl>
            <p className="graph-soon">
              <Icon name="commit" />
              {t("repo.graphSoon")}
            </p>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span className="mono">{path}</span>
        {data?.remoteUrl && (
          <span className="status-item">
            <Icon name="cloud" size={14} />
            origin · {remoteHost(data.remoteUrl)}
          </span>
        )}
        <span className="status-spacer" />
        {data && (
          <span className="mono">
            ↑{data.ahead} ↓{data.behind}
          </span>
        )}
      </footer>
    </div>
  );
}
