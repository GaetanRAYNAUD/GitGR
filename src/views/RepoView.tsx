import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CommitGraph } from "../components/graph/CommitGraph";
import { CommitPanel } from "../components/graph/CommitPanel";
import { DiffView } from "../components/graph/DiffView";
import { WorkDiffView } from "../components/graph/WorkDiffView";
import { RefsSidebar } from "../components/graph/RefsSidebar";
import { Icon, type IconName } from "../components/Icon";
import { errorMessage } from "../lib/errors";
import { remoteHost } from "../lib/format";
import { useApp } from "../store/app";
import { useGraph, WIP } from "../store/graph";
import { changedCount, useWork } from "../store/worktree";

const TOOLS: { key: string; icon: IconName; sep?: boolean }[] = [
  { key: "pull", icon: "pull" },
  { key: "push", icon: "push" },
  { key: "fetch", icon: "fetch" },
  { key: "branch", icon: "branch", sep: true },
  { key: "stash", icon: "stash" },
  { key: "pop", icon: "pop" },
];

/** Vue d'un dépôt ouvert : barre d'outils, branches, graphe (ou diff) et détails du commit. */
export function RepoView({ path }: { path: string }) {
  const { t } = useTranslation();
  const repo = useApp((s) => s.repos.find((r) => r.path === path));
  const summary = useApp((s) => s.summaries[path]);
  const refresh = useApp((s) => s.refreshRepo);
  const graphError = useGraph((s) => s.graphs[path]?.error);
  const count = useGraph((s) => s.graphs[path]?.commits.length ?? 0);
  const done = useGraph((s) => s.graphs[path]?.done ?? false);
  const diff = useGraph((s) => s.diffs[path]);
  const loadGraph = useGraph((s) => s.refresh);
  const data = summary?.data;
  const work = useWork((s) => s.repos[path]);
  const loadWork = useWork((s) => s.refresh);
  const closeWorkDiff = useWork((s) => s.closeDiff);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const head = useGraph((s) => s.graphs[path]?.refs?.head ?? null);
  const select = useGraph((s) => s.select);
  // L'état détaillé de la copie de travail fait foi ; le résumé sert en attendant.
  const changes = work?.status ? changedCount(work.status) : (data?.changes ?? 0);
  const workDiff = selected === WIP ? work?.diff : undefined;

  useEffect(() => {
    loadGraph(path);
    loadWork(path);
  }, [loadGraph, loadWork, path]);

  // Copie de travail sale et rien de sélectionné : on montre les modifications en cours.
  // Plus rien à commiter (après un commit, un abandon…) : on passe au commit courant.
  useEffect(() => {
    if (changes > 0 && selected === null) select(path, WIP);
    else if (changes === 0 && selected === WIP && work?.status) select(path, head);
  }, [changes, selected, head, work?.status, select, path]);

  // Le diff de travail n'a de sens que tant que la ligne « en cours » est sélectionnée.
  useEffect(() => {
    if (selected !== WIP && work?.diff) closeWorkDiff(path);
  }, [selected, work?.diff, closeWorkDiff, path]);

  const branchLabel = data ? (data.branch ?? t("repo.detached")) : "…";
  const tracking = data?.upstream
    ? [
        data.upstream,
        data.ahead === 0 && data.behind === 0
          ? t("repo.upToDate")
          : [data.ahead ? t("repo.ahead", { count: data.ahead }) : null, data.behind ? t("repo.behind", { count: data.behind }) : null]
              .filter(Boolean)
              .join(" · "),
      ].join(" — ")
    : t("repo.noUpstream");
  const error = summary?.error ?? graphError;

  return (
    <div className="repo-view">
      <div className="toolbar">
        <div className="branch-chip" title={`${path}\n${tracking}`}>
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
        <RefsSidebar path={path} />
        <div className="repo-center">
          {error ? (
            <div className="notice error repo-error" role="alert">
              <Icon name="alert" />
              {errorMessage(t, error)}
            </div>
          ) : diff ? (
            <DiffView path={path} diff={diff} />
          ) : workDiff ? (
            <WorkDiffView path={path} diff={workDiff} />
          ) : (
            <CommitGraph path={path} changes={changes} />
          )}
        </div>
        <CommitPanel path={path} />
      </div>

      <footer className="statusbar">
        <span className="mono">{path}</span>
        {data?.remoteUrl && (
          <span className="status-item" title={data.remoteUrl}>
            <Icon name="cloud" size={14} />
            origin · {remoteHost(data.remoteUrl)}
          </span>
        )}
        <span className="status-spacer" />
        {count > 0 && <span>{done ? t("graph.count", { count }) : t("graph.countMore", { count })}</span>}
        {data && (
          <span className="mono" title={tracking}>
            ↑{data.ahead} ↓{data.behind}
          </span>
        )}
      </footer>
    </div>
  );
}
