import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommitGraph } from "../components/graph/CommitGraph";
import { CommitPanel } from "../components/graph/CommitPanel";
import { DiffView } from "../components/graph/DiffView";
import { WorkDiffView } from "../components/graph/WorkDiffView";
import { RefsSidebar } from "../components/graph/RefsSidebar";
import { type MenuItem, openMenuBelow } from "../components/ContextMenu";
import { Icon, type IconName } from "../components/Icon";
import { ProfilePill } from "../components/ProfilePill";
import { Splitter } from "../components/Splitter";
import { errorMessage } from "../lib/errors";
import { remoteHost } from "../lib/format";
import { clamp, LAYOUT, LIMITS } from "../lib/layout";
import { useApp } from "../store/app";
import { useGraph, WIP } from "../store/graph";
import { useOps, type OpName } from "../store/ops";
import { changedCount, useWork } from "../store/worktree";
import type { PullStrategy } from "../lib/types";

const STRATEGIES: PullStrategy[] = ["ff-only", "merge", "rebase"];

/** Stash d'auto-stash « masqués pour l'instant », par SHA (le temps de la session). */
const laterAutostash = new Set<string>();

/** Des modifications mises de côté par l'auto-stash n'ont pas été réappliquées (conflits, ou
 *  app interrompue entre le stash et la réapplication) : on propose de le faire. */
function AutostashBanner({ path }: { path: string }) {
  const { t } = useTranslation();
  const autostash = useGraph((s) => s.graphs[path]?.refs?.autostash ?? null);
  const running = useOps((s) => !!s.running[path]);
  const [, rerender] = useState(0);
  if (!autostash || laterAutostash.has(autostash.sha)) return null;
  return (
    <div className="autostash-banner" role="status">
      <Icon name="stash" size={16} />
      <span>{t("autostash.pending", { message: autostash.message })}</span>
      <button
        className="mini"
        onClick={() => {
          laterAutostash.add(autostash.sha);
          rerender((n) => n + 1);
        }}
      >
        {t("autostash.later")}
      </button>
      <button className="mini primary" disabled={running} onClick={() => useOps.getState().pop(path)}>
        {t("autostash.apply")}
      </button>
    </div>
  );
}

/** Boutons pull / push / fetch / branche / stash / pop. */
function Tools({ path, changes }: { path: string; changes: number }) {
  const { t } = useTranslation();
  const data = useApp((s) => s.summaries[path]?.data);
  const strategy = useApp((s) => s.settings.pullStrategy) ?? "ff-only";
  const update = useApp((s) => s.updateSettings);
  const stashes = useGraph((s) => s.graphs[path]?.refs?.stashes ?? 0);
  const operation = useWork((s) => s.repos[path]?.status?.operation ?? null);
  const running = useOps((s) => s.running[path]);
  const ops = useOps.getState();
  const chevron = useRef<HTMLButtonElement>(null);
  const pushChevron = useRef<HTMLButtonElement>(null);
  const detached = !!data && !data.branch;
  // Plusieurs remotes : « Tirer depuis… », « Pousser vers… » et « Pousser vers tous ».
  const remotes = useGraph((s) => s.graphs[path]?.refs?.remotes) ?? [];
  const several = remotes.length > 1;
  const blocked = !!running || !!operation || detached;

  const tool = (
    key: OpName | "branch",
    icon: IconName,
    onClick: () => void,
    opts: { disabled?: boolean; title?: string; badge?: number; label?: string } = {},
  ) => (
    <button
      className={running === key ? "tbtn running" : "tbtn"}
      disabled={!!running || opts.disabled}
      title={running === key ? t("repo.running") : opts.title}
      aria-busy={running === key}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{opts.label ?? t(`repo.${key}`)}</span>
      {!!opts.badge && <span className="badge">{opts.badge}</span>}
    </button>
  );

  const strategyMenu = () => {
    if (!chevron.current) return;
    const items: MenuItem[] = STRATEGIES.map((s) => ({ label: t(`pull.${s}`), checked: s === strategy, onClick: () => update({ pullStrategy: s }) }));
    if (several) {
      items.push("sep");
      for (const r of remotes) items.push({ label: t("repo.pullFrom", { remote: r.name }), disabled: blocked, onClick: () => ops.pullFrom(path, r.name) });
    }
    openMenuBelow(chevron.current, items);
  };

  const pushMenu = () => {
    if (!pushChevron.current) return;
    openMenuBelow(pushChevron.current, [
      ...remotes.map((r): MenuItem => ({ label: t("repo.pushTo", { remote: r.name }), disabled: blocked, onClick: () => ops.push(path, false, r.name) })),
      "sep",
      { label: t("repo.pushAll"), disabled: blocked, onClick: () => ops.pushAll(path) },
    ]);
  };

  const pushButton = tool("push", "push", () => ops.push(path), {
    disabled: detached || !!operation,
    title: detached ? t("errors.detached_head") : data?.upstream ?? undefined,
    badge: data?.ahead,
  });

  return (
    <div className="tools">
      <span className="tool-wrap tool-split">
        {tool("pull", "pull", () => ops.pull(path), {
          disabled: !data?.upstream || !!operation,
          title: data?.upstream ? t("repo.pullHint", { mode: t(`pull.${strategy}`) }) : t("errors.no_upstream"),
          badge: data?.behind,
        })}
        <button
          ref={chevron}
          className="tbtn tool-chevron"
          aria-label={t("repo.pullStrategy")}
          title={t("repo.pullStrategy")}
          aria-haspopup="menu"
          onClick={strategyMenu}
        >
          <Icon name="chevron" size={12} />
        </button>
      </span>
      {several ? (
        <span className="tool-wrap tool-split">
          {pushButton}
          <button
            ref={pushChevron}
            className="tbtn tool-chevron"
            aria-label={t("repo.pushMenu")}
            title={t("repo.pushMenu")}
            aria-haspopup="menu"
            // Comme le bouton Push : pas pendant une commande (le menu ne proposerait rien).
            disabled={blocked}
            onClick={pushMenu}
          >
            <Icon name="chevron" size={12} />
          </button>
        </span>
      ) : (
        pushButton
      )}
      {tool("fetch", "fetch", () => ops.fetch(path))}
      <span className="tool-sep" />
      {tool("branch", "branch", () => ops.newBranch(path, null, data?.branch ?? "HEAD"), { title: t("repo.branchHint") })}
      {tool("stash", "stash", () => ops.stash(path), { disabled: changes === 0 || !!operation, title: t("repo.stashHint") })}
      {tool("pop", "pop", () => ops.pop(path), {
        disabled: stashes === 0,
        title: stashes ? t("repo.popHint", { count: stashes }) : t("repo.popEmpty"),
        badge: stashes,
      })}
    </div>
  );
}

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
  const setLayout = useApp((s) => s.setLayout);
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

        <Tools path={path} changes={changes} />

        <button className="tbtn" onClick={() => refresh(path)} title={`${t("repo.refresh")} (F5)`}>
          <Icon name="fetch" />
          <span>{t("repo.refresh")}</span>
        </button>
      </div>

      <AutostashBanner path={path} />
      <div className="repo-body">
        <RefsSidebar path={path} />
        <Splitter
          dir="x"
          label={t("layout.sidebar")}
          measure="prev"
          onChange={(v, final) => setLayout({ [LAYOUT.sidebar]: clamp(v, LIMITS.sidebar) }, final)}
          onReset={() => setLayout({ [LAYOUT.sidebar]: null })}
        />
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
        <Splitter
          dir="x"
          label={t("layout.panel")}
          measure="next"
          sign={-1}
          onChange={(v, final) => setLayout({ [LAYOUT.panel]: clamp(v, LIMITS.panel) }, final)}
          onReset={() => setLayout({ [LAYOUT.panel]: null })}
        />
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
        <ProfilePill path={path} className="status-profile" />
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
