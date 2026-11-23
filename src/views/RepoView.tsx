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
import { api, errorCode } from "../lib/api";
import { remoteHost, remoteWebUrl } from "../lib/format";
import { clamp, LAYOUT, LIMITS } from "../lib/layout";
import { repoName, useApp } from "../store/app";
import { useGraph, WIP } from "../store/graph";
import { useOps, type OpName } from "../store/ops";
import { changedCount, useWork } from "../store/worktree";
import type { PullStrategy } from "../lib/types";
import { remoteMarkOf } from "../components/RemoteMark";
import { useProfiles } from "../store/profiles";
import { usePublishDialog } from "../store/publish";
import { usePullOptions, type OptionsContext } from "../store/pullOptions";
import { usePullContexts, usePullList } from "../store/pullList";
import { PullView } from "../components/graph/PullView";
import { RangeView } from "../components/graph/RangeView";
import { useRangeView, useReflogView, useStashView } from "../store/range";
import { StashView } from "../components/graph/StashView";
import { ReflogView } from "../components/graph/ReflogView";
import { PULLS_SECTION } from "../components/graph/PullsSection";

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
  const showRange = (p: string, d: "push" | "pull") => {
    usePullList.getState().close(p);
    useGraph.getState().closeDiff(p);
    useRangeView.getState().show(p, d);
  };
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
    opts: { disabled?: boolean; title?: string; badge?: number; label?: string; onBadge?: () => void; badgeTitle?: string } = {},
  ) => {
    const button = (
    <button
      className={running === key ? "tbtn running" : "tbtn"}
      disabled={!!running || opts.disabled}
      title={running === key ? t("repo.running") : opts.title}
      aria-busy={running === key}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{opts.label ?? t(`repo.${key}`)}</span>
      {!!opts.badge && !opts.onBadge && <span className="badge">{opts.badge}</span>}
    </button>
    );
    if (!opts.badge || !opts.onBadge) return button;
    // Badge cliquable à côté du bouton (pas dedans : un bouton dans un bouton).
    return (
      <span className="tool-badged">
        {button}
        <button className="badge badge-btn" title={opts.badgeTitle} aria-label={opts.badgeTitle} onClick={opts.onBadge}>
          {opts.badge}
        </button>
      </span>
    );
  };

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

  // Sans remote, rien où pousser : « Publier » crée le dépôt distant (et y pousse la branche).
  // Seulement une fois les remotes lus, pour ne pas faire clignoter le bouton à l'ouverture.
  const noRemote = useGraph((s) => s.graphs[path]?.refs?.remotes.length === 0);
  const pushButton = noRemote
    ? tool("push", "cloud", () => usePublishDialog.getState().show(path), { title: t("publish.buttonHint"), label: t("publish.button") })
    : tool("push", "push", () => ops.push(path), {
        disabled: detached || !!operation,
        title: detached ? t("errors.detached_head") : data?.upstream ?? undefined,
        badge: data?.ahead,
        onBadge: () => showRange(path, "push"),
        badgeTitle: t("range.pushBadge", { count: data?.ahead ?? 0 }),
      });

  return (
    <div className="tools">
      <span className="tool-wrap tool-split">
        {tool("pull", "pull", () => ops.pull(path), {
          disabled: !data?.upstream || !!operation,
          title: data?.upstream ? t("repo.pullHint", { mode: t(`pull.${strategy}`) }) : t("errors.no_upstream"),
          badge: data?.behind,
          onBadge: () => showRange(path, "pull"),
          badgeTitle: t("range.pullBadge", { count: data?.behind ?? 0 }),
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
      <span className="tool-sep" />
      <button
        className="tbtn"
        title={t("reflog.toolbarHint")}
        onClick={() => {
          usePullList.getState().close(path);
          useGraph.getState().closeDiff(path);
          useReflogView.getState().show(path, "HEAD");
        }}
      >
        <Icon name="clock" />
        <span>{t("reflog.toolbar")}</span>
      </button>
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
  // Page web de origin (barre du bas) ; aucune pour un remote local.
  const webUrl = data?.remoteUrl ? remoteWebUrl(data.remoteUrl) : null;
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

  // Section PR / MR décochée dans la barre latérale : l'utilisateur ne s'en sert pas, rien n'est
  // lu d'office (ni la liste, ni le préchargement). Ce qui est déjà là reste utilisé (étiquettes
  // des branches) ; la fenêtre de création et la vue d'une PR / MR lisent ce qu'il leur faut.
  const pullsShown = useApp((s) => !s.repoUi[path]?.hidden.includes(PULLS_SECTION));

  // Personnes et étiquettes des remotes (pour les PR / MR) préchargées dès l'ouverture du dépôt,
  // en arrière-plan : la fenêtre de création n'aura rien à attendre. Relu au plus toutes les
  // six heures (cf. store/pullOptions).
  const remotes = useGraph((s) => s.graphs[path]?.refs?.remotes);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  const ensureOptions = usePullOptions((s) => s.ensure);
  // Clé texte : un rafraîchissement des refs (même contenu) ne relance rien.
  const prefetchKey = JSON.stringify(
    (remotes ?? [])
      .map((r) => remoteMarkOf(profiles, binding, r))
      .flatMap((m): OptionsContext[] => (m?.url && m.account ? [{ kind: m.provider, url: m.url, repo: m.repo, account: m.account }] : [])),
  );
  useEffect(() => {
    if (!pullsShown) return;
    for (const ctx of JSON.parse(prefetchKey) as OptionsContext[]) void ensureOptions(ctx);
  }, [prefetchKey, ensureOptions, pullsShown]);

  // PR / MR ouvertes : lues à l'ouverture, relues quand les refs changent (fetch, fetch
  // automatique) au plus toutes les deux minutes (cf. store/pullList).
  const pullContexts = usePullContexts(path);
  const ensurePulls = usePullList((s) => s.ensure);
  const refsVersion = useGraph((s) => s.graphs[path]?.refs);
  const openPull = usePullList((s) => s.open[path]);
  const openRange = useRangeView((s) => s.open[path]);
  const openStash = useStashView((s) => s.open[path]);
  const openReflog = useReflogView((s) => s.open[path]);
  useEffect(() => {
    if (!pullsShown) return;
    for (const ctx of pullContexts) void ensurePulls(ctx);
  }, [pullContexts, ensurePulls, refsVersion, pullsShown]);

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
        <div className={data && !data.branch ? "branch-chip detached" : "branch-chip"} title={`${path}\n${tracking}`}>
          <span className="branch-chip-repo">{repo && repoName(repo)}</span>
          <span className="branch-chip-name">
            <Icon name={data && !data.branch ? "commit" : "branch"} size={13} />
            <span className="branch-chip-label">{branchLabel}</span>
            {!!data?.ahead && <span className="branch-chip-sync mono">↑{data.ahead}</span>}
            {!!data?.behind && <span className="branch-chip-sync mono">↓{data.behind}</span>}
          </span>
        </div>
        {changes > 0 && (
          <button
            className={selected === WIP && !diff && !openPull ? "changes-pill on" : "changes-pill"}
            title={t("repo.changesHint")}
            onClick={() => {
              if (diff) useGraph.getState().closeDiff(path);
              if (openPull) usePullList.getState().close(path);
              useRangeView.getState().close(path);
              useStashView.getState().close(path);
              select(path, WIP);
            }}
          >
            <span className="changes-dot" />
            {t("repo.changes", { count: changes })}
          </button>
        )}

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
          ) : openReflog ? (
            <ReflogView key={openReflog} path={path} refname={openReflog} />
          ) : openStash ? (
            <StashView key={openStash.sha} path={path} entry={openStash} />
          ) : openRange ? (
            <RangeView key={openRange} path={path} direction={openRange} />
          ) : openPull ? (
            <PullView key={`${openPull.ctx.remote}#${openPull.number}`} path={path} ctx={openPull.ctx} number={openPull.number} />
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
        <button
          type="button"
          className="status-link mono"
          title={t("repo.openFolder")}
          onClick={() => void api.openRepoFile(path, "", "open").catch((e) => useApp.setState({ error: errorCode(e) }))}
        >
          {path}
        </button>
        {data?.remoteUrl &&
          (webUrl ? (
            <button
              type="button"
              className="status-link status-item"
              title={t("repo.openRemote", { url: webUrl })}
              onClick={() => void api.openUrl(webUrl).catch((e) => useApp.setState({ error: errorCode(e) }))}
            >
              <Icon name="cloud" size={14} />
              origin · {remoteHost(data.remoteUrl)}
            </button>
          ) : (
            <span className="status-item" title={data.remoteUrl}>
              <Icon name="cloud" size={14} />
              origin · {remoteHost(data.remoteUrl)}
            </span>
          ))}
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
