import { useUndo } from "../store/undo";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommitGraph } from "../components/graph/CommitGraph";
import { CommitPanel } from "../components/graph/CommitPanel";
import { DiffView } from "../components/graph/DiffView";
import { WorkDiffView } from "../components/graph/WorkDiffView";
import { RefsSidebar } from "../components/graph/RefsSidebar";
import { type MenuItem, openMenuBelow, useContextMenu } from "../components/ContextMenu";
import { Icon, type IconName } from "../components/Icon";
import { ProfilePill } from "../components/ProfilePill";
import { Splitter } from "../components/Splitter";
import { errorMessage } from "../lib/errors";
import { api, errorCode } from "../lib/api";
import { relativeTime, remoteHost, remoteWebUrl } from "../lib/format";
import { clamp, LAYOUT, LIMITS } from "../lib/layout";
import { repoName, useApp } from "../store/app";
import { useGraph, WIP } from "../store/graph";
import { useOps, type OpName } from "../store/ops";
import { useBisect } from "../store/bisect";
import { changedCount, useWork } from "../store/worktree";
import type { PullStrategy, ReflogEntry } from "../lib/types";
import { recentBranches } from "../lib/refs";
import { remoteMarkOf } from "../components/RemoteMark";
import { useProfiles } from "../store/profiles";
import { usePublishDialog } from "../store/publish";
import { usePullOptions, type OptionsContext } from "../store/pullOptions";
import { usePullContexts, usePullList } from "../store/pullList";
import { PullView } from "../components/graph/PullView";
import { RangeView } from "../components/graph/RangeView";
import { closeCenterViews, useConflictView, useBlameView, useFileHistoryView, useRangeView, useReflogView, useSearchView, useStashView } from "../store/range";
import { StashView } from "../components/graph/StashView";
import { ReflogView } from "../components/graph/ReflogView";
import { SearchView } from "../components/graph/SearchView";
import { FileHistoryView } from "../components/graph/FileHistoryView";
import { BlameView } from "../components/graph/BlameView";
import { ConflictView } from "../components/graph/ConflictView";
import { PULLS_SECTION } from "../components/graph/PullsSection";

const STRATEGIES: PullStrategy[] = ["ff-only", "merge", "rebase"];

/** Bisect en cours : commit à tester, étapes restantes, et les verdicts ; trouvé : le premier
 *  mauvais commit, et « Terminer ». */
function BisectBanner({ path }: { path: string }) {
  const { t } = useTranslation();
  const state = useBisect((s) => s.states[path]);
  const running = useOps((s) => !!s.running[path]);
  if (!state) return null;
  const ops = useOps.getState();
  const busy = running ? t("repo.busy") : undefined;
  const short = (sha: string | null) => sha?.slice(0, 7) ?? "";
  // Fini : un premier mauvais commit, ou seulement des commits passés pour candidats.
  const done = !!state.firstBad || state.possible.length > 0;
  const text = state.firstBad
    ? t("bisect.foundBanner", { sha: short(state.firstBad) })
    : state.possible.length
      ? t("bisect.ambiguous", { list: state.possible.map(short).join(", ") })
      : state.remaining === null
        ? t(state.bad ? "bisect.needGood" : "bisect.needBad")
        : t("bisect.testing", { sha: short(state.current), count: Math.max(1, state.steps ?? 1) });
  return (
    <div className="autostash-banner bisect-banner" role="status">
      <Icon name="search" size={16} />
      <span>{text}</span>
      {state.firstBad ? (
        <button className="mini" onClick={() => void useGraph.getState().reveal(path, state.firstBad!)}>
          {t("bisect.show")}
        </button>
      ) : (
        state.remaining !== null &&
        !done && (
          <>
            <button className="mini" disabled={running} title={busy} onClick={() => void ops.bisect(path, "good", null)}>
              {t("bisect.good")}
            </button>
            <button className="mini" disabled={running} title={busy} onClick={() => void ops.bisect(path, "bad", null)}>
              {t("bisect.bad")}
            </button>
            <button className="mini" disabled={running} title={busy ?? t("bisect.skipHint")} onClick={() => void ops.bisect(path, "skip", null)}>
              {t("bisect.skip")}
            </button>
          </>
        )
      )}
      <button className={done ? "mini primary" : "mini"} disabled={running} title={busy ?? t("bisect.stopHint")} onClick={() => void ops.bisectReset(path)}>
        {t(done ? "bisect.finish" : "bisect.stop")}
      </button>
    </div>
  );
}

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
      <button className="mini primary" disabled={running} title={running ? t("repo.busy") : undefined} onClick={() => useOps.getState().pop(path)}>
        {t("autostash.apply")}
      </button>
    </div>
  );
}

/** Raccourcis des outils (Ctrl+Maj+lettre), annoncés dans leurs infobulles. */
const TOOL_KEYS: Record<string, string> = { pull: "L", push: "K", fetch: "F", branch: "B", stash: "S", pop: "P" };

interface ToolOpts {
  /** Raison pour laquelle l'action est impossible : bouton grisé, raison en infobulle et
   *  annoncée (le bouton reste focalisable, `aria-disabled`). */
  why?: string | null;
  title?: string;
  badge?: number;
  label?: string;
  /** Nom complet pour les lecteurs d'écran (avec le compteur : « Pop, 1 stash »). */
  name?: string;
  onBadge?: () => void;
  badgeTitle?: string;
}

/** Barre d'outils du dépôt : annuler / rétablir, pull / push / fetch, branche / stash / pop,
 *  reflog / recherche, actualiser. Une seule tabulation (`role="toolbar"`), ← / → / Début / Fin
 *  d'un bouton à l'autre ; une action impossible reste focalisable et dit pourquoi. */
function Tools({ path, changes }: { path: string; changes: number }) {
  const { t } = useTranslation();
  const data = useApp((s) => s.summaries[path]?.data);
  const strategy = useApp((s) => s.settings.pullStrategy) ?? "ff-only";
  const update = useApp((s) => s.updateSettings);
  const refresh = useApp((s) => s.refreshRepo);
  const stashes = useGraph((s) => s.graphs[path]?.refs?.stashes ?? 0);
  const operation = useWork((s) => s.repos[path]?.status?.operation ?? null);
  const running = useOps((s) => s.running[path]);
  const undoNext = useUndo((s) => s.stacks[path]?.undo.slice(-1)[0]);
  const redoNext = useUndo((s) => s.stacks[path]?.redo.slice(-1)[0]);
  const ops = useOps.getState();
  const showRange = (p: string, d: "push" | "pull") => {
    usePullList.getState().close(p);
    useGraph.getState().closeDiff(p);
    useRangeView.getState().show(p, d);
  };
  const chevron = useRef<HTMLButtonElement>(null);
  const pushChevron = useRef<HTMLButtonElement>(null);
  // Menu ouvert depuis un chevron : `aria-expanded` tant que ce menu-là est affiché (son id,
  // pas un autre menu ouvert ensuite).
  const [menuFrom, setMenuFrom] = useState<{ from: "pull" | "push"; id: number } | null>(null);
  const menuId = useContextMenu((s) => s.menu?.id);
  const expanded = (from: "pull" | "push") => menuFrom?.from === from && menuFrom.id === menuId;
  const openedFrom = (from: "pull" | "push") => {
    const id = useContextMenu.getState().menu?.id;
    if (id !== undefined) setMenuFrom({ from, id });
  };
  const detached = !!data && !data.branch;
  // Plusieurs remotes : « Tirer depuis… », « Pousser vers… » et « Pousser vers tous ».
  const remotes = useGraph((s) => s.graphs[path]?.refs?.remotes) ?? [];
  const several = remotes.length > 1;
  const blocked = !!running || !!operation || detached;
  const keyOf = (key: string) => (TOOL_KEYS[key] ? t("keys.ctrlShift", { key: TOOL_KEYS[key] }) : null);
  /** Raisons communes : une commande tourne, ou une opération (merge, rebase…) est en cours. */
  const busyWhy = running ? t("repo.busy") : null;
  const opWhy = operation ? t("repo.blockedBy", { op: t(`op.${operation}`) }) : null;

  const tool = (key: OpName | "branch", icon: IconName, onClick: () => void, opts: ToolOpts = {}) => {
    const why = busyWhy ?? opts.why ?? null;
    const keys = keyOf(key);
    const hint = running === key ? t("repo.running") : (why ?? [opts.title, keys && `(${keys})`].filter(Boolean).join(" "));
    const button = (
      <button
        className={running === key ? "tbtn running" : "tbtn"}
        aria-disabled={!!why || undefined}
        aria-label={opts.name}
        aria-description={why ?? undefined}
        aria-keyshortcuts={keys ? `Control+Shift+${TOOL_KEYS[key]}` : undefined}
        title={hint || undefined}
        aria-busy={running === key}
        data-tool={key}
        onClick={() => {
          if (!why) onClick();
        }}
      >
        <Icon name={icon} />
        <span className="tbtn-label">{opts.label ?? t(`repo.${key}`)}</span>
        {!!opts.badge && !opts.onBadge && (
          <span className="badge" aria-hidden="true">
            {opts.badge}
          </span>
        )}
      </button>
    );
    if (!opts.badge || !opts.onBadge) return button;
    // Badge cliquable à côté du bouton (pas dedans : un bouton dans un bouton).
    return (
      <span className={why ? "tool-badged off" : "tool-badged"}>
        {button}
        <button className="badge badge-btn" title={opts.badgeTitle} aria-label={opts.badgeTitle} onClick={opts.onBadge}>
          {opts.badge}
        </button>
      </span>
    );
  };

  const strategyMenu = () => {
    if (!chevron.current) return;
    const items: MenuItem[] = STRATEGIES.map((s) => ({
      label: t(`pull.${s}`),
      title: t(s === "ff-only" ? "pull.ffOnlyHint" : `pull.${s}Hint`),
      checked: s === strategy,
      onClick: () => update({ pullStrategy: s }),
    }));
    if (several) {
      items.push("sep");
      for (const r of remotes) items.push({ label: t("repo.pullFrom", { remote: r.name }), disabled: blocked, title: busyWhy ?? opWhy ?? undefined, onClick: () => ops.pullFrom(path, r.name) });
    }
    openMenuBelow(chevron.current, items);
    openedFrom("pull");
  };

  const pushMenu = () => {
    if (!pushChevron.current) return;
    openMenuBelow(pushChevron.current, [
      ...remotes.map((r): MenuItem => ({ label: t("repo.pushTo", { remote: r.name }), disabled: blocked, onClick: () => ops.push(path, false, r.name) })),
      "sep",
      { label: t("repo.pushAll"), disabled: blocked, onClick: () => ops.pushAll(path) },
    ]);
    openedFrom("push");
  };

  // Sans remote, rien où pousser : « Publier » crée le dépôt distant (et y pousse la branche).
  // Seulement une fois les remotes lus, pour ne pas faire clignoter le bouton à l'ouverture.
  const noRemote = useGraph((s) => s.graphs[path]?.refs?.remotes.length === 0);
  const pushWhy = detached ? t("errors.detached_head") : opWhy;
  const pullWhy = opWhy ?? (data && !data.upstream ? t("errors.no_upstream") : null);
  const stashWhy = opWhy ?? (changes === 0 ? t("repo.stashNothing") : null);
  const popWhy = opWhy ?? (stashes === 0 ? t("repo.popEmpty") : null);
  const branchWhy = opWhy;

  const actions: Record<string, { run: () => void; why: string | null }> = {
    pull: { run: () => ops.pull(path), why: pullWhy },
    push: { run: () => (noRemote ? usePublishDialog.getState().show(path) : ops.push(path)), why: noRemote ? null : pushWhy },
    fetch: { run: () => ops.fetch(path), why: null },
    branch: { run: () => ops.newBranch(path, null, data?.branch ?? "HEAD"), why: branchWhy },
    stash: { run: () => ops.stash(path), why: stashWhy },
    pop: { run: () => ops.pop(path), why: popWhy },
  };
  // Ctrl+Maj+lettre : la même action que le bouton, si elle est possible (pas sous une fenêtre).
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
    const key = Object.keys(TOOL_KEYS).find((k) => TOOL_KEYS[k] === e.key.toUpperCase());
    if (!key || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    const a = actions[key];
    if (running || a.why) {
      useApp.getState().notify(running ? t("repo.busy") : a.why!);
      return;
    }
    a.run();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pushButton = noRemote
    ? tool("push", "cloud", actions.push.run, { title: t("publish.buttonHint"), label: t("publish.button") })
    : tool("push", "push", actions.push.run, {
        why: pushWhy,
        title: data?.upstream ? t("repo.pushHint", { upstream: data.upstream }) : t("repo.pushHintNew"),
        name: data?.ahead ? t("repo.pushName", { count: data.ahead }) : undefined,
        badge: data?.ahead,
        onBadge: () => showRange(path, "push"),
        badgeTitle: t("range.pushBadge", { count: data?.ahead ?? 0 }),
      });

  const undoTool = (dir: "undo" | "redo") => {
    const entry = dir === "undo" ? undoNext : redoNext;
    const keys = dir === "undo" ? "Ctrl+Z" : "Ctrl+Y";
    const why = busyWhy ?? (entry ? null : t(`undo.${dir}None`));
    return (
      <button
        className="tbtn"
        aria-disabled={!!why || undefined}
        aria-description={why ?? undefined}
        aria-keyshortcuts={dir === "undo" ? "Control+Z" : "Control+Y"}
        title={why ?? (entry ? t(`undo.${dir}Hint`, { label: t(`undo.label.${entry.label}`), keys }) : undefined)}
        onClick={() => {
          if (!why) void ops.replay(path, dir);
        }}
      >
        <Icon name={dir} />
        <span className="tbtn-label">{t(`undo.${dir}`)}</span>
      </button>
    );
  };

  // Une seule tabulation pour toute la barre : la flèche déplace le focus d'un bouton à l'autre,
  // et le dernier bouton focalisé garde l'arrêt de tabulation.
  const bar = useRef<HTMLDivElement>(null);
  const stop = useRef(0);
  useLayoutEffect(() => {
    bar.current?.querySelectorAll<HTMLButtonElement>("button").forEach((b, i) => (b.tabIndex = i === stop.current ? 0 : -1));
  });
  const buttons = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const onBarFocus = (e: React.FocusEvent) => {
    const all = buttons();
    const i = all.indexOf(e.target as HTMLButtonElement);
    if (i < 0) return;
    stop.current = i;
    all.forEach((b, j) => (b.tabIndex = j === i ? 0 : -1));
  };
  const onBarKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, (i: number, n: number) => number> = {
      ArrowRight: (i, n) => (i + 1) % n,
      ArrowLeft: (i, n) => (i - 1 + n) % n,
      Home: () => 0,
      End: (_, n) => n - 1,
    };
    const move = moves[e.key];
    if (!move) return;
    const all = buttons();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    all[move(i, all.length)]?.focus();
  };

  return (
    <div className="tools" role="toolbar" aria-label={t("repo.toolbar")} ref={bar} onFocus={onBarFocus} onKeyDown={onBarKey}>
      {/* Commande en cours : annoncée (le titre du bouton ne l'est pas). */}
      <span className="visually-hidden" role="status">
        {running ? t("repo.runningOp", { op: t(`repo.${running}`, { defaultValue: running }) }) : ""}
      </span>
      {undoTool("undo")}
      {undoTool("redo")}
      <span className="tool-sep" />
      <span className="tool-wrap tool-split">
        {tool("pull", "pull", actions.pull.run, {
          why: pullWhy,
          title: t("repo.pullHint", { mode: t(`pull.${strategy}`) }),
          name: data?.behind ? t("repo.pullName", { count: data.behind }) : undefined,
          badge: data?.behind,
          onBadge: () => showRange(path, "pull"),
          badgeTitle: t("range.pullBadge", { count: data?.behind ?? 0 }),
        })}
        {/* Le mode du pull se change même pendant une opération (c'est un réglage). */}
        <button
          ref={chevron}
          className="tbtn tool-chevron"
          aria-label={t("repo.pullStrategy")}
          title={t("repo.pullStrategy")}
          aria-haspopup="menu"
          aria-expanded={expanded("pull")}
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
            title={blocked ? (busyWhy ?? pushWhy ?? t("repo.pushMenu")) : t("repo.pushMenu")}
            aria-haspopup="menu"
            aria-expanded={expanded("push")}
            // Comme le bouton Push : pas pendant une commande (le menu ne proposerait rien).
            aria-disabled={blocked || undefined}
            onClick={() => {
              if (!blocked) pushMenu();
            }}
          >
            <Icon name="chevron" size={12} />
          </button>
        </span>
      ) : (
        pushButton
      )}
      {tool("fetch", "cloudDown", actions.fetch.run, { title: t("repo.fetchHint") })}
      <span className="tool-sep" />
      {tool("branch", "branch", actions.branch.run, { why: branchWhy, title: t("repo.branchHint") })}
      {tool("stash", "stash", actions.stash.run, { why: stashWhy, title: t("repo.stashHint") })}
      {tool("pop", "pop", actions.pop.run, {
        why: popWhy,
        title: stashes ? t("repo.popHint", { count: stashes }) : undefined,
        name: stashes ? t("repo.popName", { count: stashes }) : undefined,
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
        <span className="tbtn-label">{t("reflog.toolbar")}</span>
      </button>
      <button
        className="tbtn"
        title={t("contentSearch.toolbarHint")}
        onClick={() => {
          usePullList.getState().close(path);
          useGraph.getState().closeDiff(path);
          useSearchView.getState().show(path);
        }}
      >
        <Icon name="search" />
        <span className="tbtn-label">{t("contentSearch.toolbar")}</span>
      </button>
      <span className="tool-sep" />
      <button className="tbtn" onClick={() => refresh(path)} title={t("repo.refreshHint")} aria-keyshortcuts="F5">
        <Icon name="fetch" />
        <span className="tbtn-label">{t("repo.refresh")}</span>
      </button>
    </div>
  );
}

/** Date du dernier fetch (barre d'état), remise à jour chaque minute. */
function LastFetch({ seconds }: { seconds: number | null }) {
  const { t, i18n } = useTranslation();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!seconds) return <span className="status-item muted">{t("repo.neverFetched")}</span>;
  const r = relativeTime(seconds * 1000);
  return (
    <span className="status-item" title={new Date(seconds * 1000).toLocaleString(i18n.language)}>
      {t("repo.lastFetch", { when: t(`time.${r.key}`, { count: r.count }) })}
    </span>
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
  const operation = useWork((s) => s.repos[path]?.status?.operation ?? null);
  const setLayout = useApp((s) => s.setLayout);
  // L'état détaillé de la copie de travail fait foi ; le résumé sert en attendant.
  const changes = work?.status ? changedCount(work.status) : (data?.changes ?? 0);
  const workDiff = selected === WIP ? work?.diff : undefined;

  useEffect(() => {
    loadGraph(path);
    loadWork(path);
  }, [loadGraph, loadWork, path]);

  // Bisect : relu quand les refs changent (marque faite dans un terminal, reset…).
  const bisectRefs = useGraph((s) => s.graphs[path]?.refs);
  useEffect(() => {
    void useBisect.getState().load(path);
  }, [path, bisectRefs]);

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
  const openSearch = useSearchView((s) => s.open[path]);
  const openFileHistory = useFileHistoryView((s) => s.open[path]);
  const openBlame = useBlameView((s) => s.open[path]);
  const openConflict = useConflictView((s) => s.open[path]);
  // Vue d'une PR / MR au centre : le panneau des détails, sans rapport, lui laisse la place ;
  // il revient dès qu'un commit est choisi depuis la PR (SHA cité, lien d'un commit).
  const pullShown = !!openPull && !openConflict && !diff && !workDiff && !openBlame && !openFileHistory && !openSearch && !openReflog && !openStash && !openRange;
  const pullKey = openPull ? `${openPull.ctx.remote}#${openPull.number}` : null;
  const [pullSel, setPullSel] = useState<{ key: string | null; sel: string | null }>({ key: pullKey, sel: selected });
  if (pullSel.key !== pullKey) setPullSel({ key: pullKey, sel: selected });
  // (La ligne « Modifications en cours » choisie d'office quand des fichiers changent ne compte pas.)
  // Plage ↑ / ↓ et contenu d'un stash : leurs commits et fichiers sont dans la vue, le
  // panneau des détails (un autre commit) n'a rien à y ajouter.
  // Recherche dans les modifications : chaque résultat a son diff dans la vue.
  const above = !!openConflict || !!diff || !!workDiff || !!openBlame || !!openFileHistory;
  const ownPanel = !above && (!!openSearch || (!openReflog && (!!openStash || !!openRange)));
  const hidePanel = ownPanel || (pullShown && pullSel.key === pullKey && (pullSel.sel === selected || selected === WIP));
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
  /** Revient au graphe (ou au panneau des modifications) depuis une vue du centre ; pas depuis
   *  une résolution de conflit, qui a sa propre confirmation (Retour / Échap). */
  const toGraph = () => {
    if (useConflictView.getState().open[path]) return false;
    if (diff) useGraph.getState().closeDiff(path);
    if (openPull) usePullList.getState().close(path);
    closeCenterViews(path);
    return true;
  };

  // Branches récentes (reflog de HEAD) : menu sous le chevron de la pastille, clic droit sur
  // elle, ou Ctrl+Maj+O ; un clic fait le checkout (auto-stash comme ailleurs).
  const recentRef = useRef<HTMLButtonElement>(null);
  const [recentId, setRecentId] = useState<number | null>(null);
  const menuShown = useContextMenu((s) => s.menu?.id);
  const recentOpen = recentId !== null && recentId === menuShown;
  const recentMenu = async () => {
    const el = recentRef.current;
    if (!el) return;
    let log: ReflogEntry[] = [];
    try {
      log = await api.reflog(path, "HEAD");
    } catch {
      // Pas de reflog lisible : le menu le dit (aucune branche récente).
    }
    // Onglet changé ou vue fermée pendant la lecture : plus de menu à ouvrir.
    if (!el.isConnected || useApp.getState().active !== path) return;
    const refs = useGraph.getState().graphs[path]?.refs;
    const locals = (refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short);
    const names = recentBranches(log, locals, refs?.headBranch ?? null);
    const why = useOps.getState().running[path] ? t("repo.busy") : operation ? t("repo.blockedBy", { op: t(`op.${operation}`) }) : undefined;
    const items: MenuItem[] = [{ header: t("repo.recentBranches") }];
    if (!names.length) items.push({ label: t("repo.noRecentBranches"), disabled: true, onClick: () => {} });
    for (const name of names)
      items.push({ label: name, disabled: !!why, title: why ?? t("repo.recentCheckout", { name }), onClick: () => void useOps.getState().checkout(path, name) });
    openMenuBelow(el, items);
    setRecentId(useContextMenu.getState().menu?.id ?? null);
  };
  const recentKey = useRef(recentMenu);
  recentKey.current = recentMenu;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toUpperCase() !== "O") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      void recentKey.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="repo-view">
      <div className="toolbar">
        {/* Dépôt et branche courante ; un clic (ou Entrée) amène le graphe sur le commit courant. */}
        <span className="branch-chip-group" onContextMenu={(e) => {
          e.preventDefault();
          void recentMenu();
        }}>
        <button
          type="button"
          className={data && !data.branch ? "branch-chip detached" : "branch-chip"}
          title={`${path}\n${tracking}\n${t("repo.chipHint")}`}
          aria-label={[repo && repoName(repo), branchLabel, tracking].filter(Boolean).join(" — ")}
          onClick={() => {
            const head = useGraph.getState().graphs[path]?.refs?.head;
            if (head && toGraph()) void useGraph.getState().reveal(path, head);
          }}
        >
          <span className="branch-chip-repo">{repo && repoName(repo)}</span>
          <span className="branch-chip-name">
            <Icon name={data && !data.branch ? "commit" : "branch"} size={13} />
            <span className="branch-chip-label">{branchLabel}</span>
            {!!data?.ahead && <span className="branch-chip-sync mono">↑{data.ahead}</span>}
            {!!data?.behind && <span className="branch-chip-sync mono">↓{data.behind}</span>}
          </span>
        </button>
        <button
          ref={recentRef}
          type="button"
          className="branch-chip-more"
          aria-label={t("repo.recentBranches")}
          title={`${t("repo.recentBranches")} (${t("keys.ctrlShift", { key: "O" })})`}
          aria-keyshortcuts="Control+Shift+O"
          aria-haspopup="menu"
          aria-expanded={recentOpen}
          onClick={() => void recentMenu()}
        >
          <Icon name="chevron" size={12} />
        </button>
        </span>
        {changes > 0 && (
          <button
            className={selected === WIP && !diff && !openPull ? "changes-pill on" : "changes-pill"}
            title={t("repo.changesHint")}
            onClick={() => {
              if (toGraph()) select(path, WIP);
            }}
          >
            <span className="changes-dot" />
            <span className="pill-label">{t("repo.changes", { count: changes })}</span>
            <span className="pill-count" aria-hidden="true">
              {changes}
            </span>
          </button>
        )}
        {/* Merge, rebase… en cours : dit pourquoi pull, push, branche et stash sont grisés, et
            mène au panneau des modifications (conflits, Continuer, Annuler l'opération). */}
        {operation && (
          <button
            className="op-pill"
            title={t("repo.opHint")}
            onClick={() => {
              if (toGraph()) select(path, WIP);
            }}
          >
            <Icon name="alert" size={13} />
            <span className="pill-label">{t(`op.${operation}`)}</span>
          </button>
        )}

        <Tools path={path} changes={changes} />
      </div>

      <AutostashBanner path={path} />
      <BisectBanner path={path} />
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
              <span>{errorMessage(t, error)}</span>
              <button type="button" className="link notice-action" onClick={() => refresh(path)}>
                {t("graph.retry")}
              </button>
            </div>
          ) : openConflict ? (
            <ConflictView key={openConflict} path={path} file={openConflict} />
          ) : diff ? (
            <DiffView path={path} diff={diff} />
          ) : workDiff ? (
            <WorkDiffView path={path} diff={workDiff} />
          ) : openBlame ? (
            <BlameView key={`${openBlame.file}@${openBlame.rev}`} path={path} target={openBlame} />
          ) : openFileHistory ? (
            <FileHistoryView key={openFileHistory} path={path} file={openFileHistory} />
          ) : openSearch ? (
            <SearchView path={path} />
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
        {!hidePanel && (
          <Splitter
            dir="x"
            label={t("layout.panel")}
            measure="next"
            sign={-1}
            onChange={(v, final) => setLayout({ [LAYOUT.panel]: clamp(v, LIMITS.panel) }, final)}
            onReset={() => setLayout({ [LAYOUT.panel]: null })}
          />
        )}
        {!hidePanel && <CommitPanel path={path} />}
      </div>

      <footer className="statusbar" role="region" aria-label={t("repo.statusbar")}>
        <button
          type="button"
          className="status-link status-path mono"
          title={`${path}
${t("repo.openFolder")}`}
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
        {data &&
          (data.upstream ? (
            // ↑ / ↓ : ce qui part au push, ce qui arrive au pull (comme les badges de la barre d'outils).
            <span className="status-item status-sync" title={tracking}>
              {(["push", "pull"] as const).map((d) => {
                const n = d === "push" ? data.ahead : data.behind;
                return (
                  <button
                    key={d}
                    type="button"
                    className="status-link mono"
                    aria-label={t(d === "push" ? "sidebar.ahead" : "sidebar.behind", { count: n })}
                    title={`${t(d === "push" ? "sidebar.ahead" : "sidebar.behind", { count: n })} — ${t(`repo.${d}Show`)}`}
                    onClick={() => {
                      usePullList.getState().close(path);
                      useGraph.getState().closeDiff(path);
                      useRangeView.getState().show(path, d);
                    }}
                  >
                    {d === "push" ? "↑" : "↓"}
                    {n}
                  </button>
                );
              })}
            </span>
          ) : (
            <span className="status-faint">{t("repo.noUpstreamShort")}</span>
          ))}
        {data && <LastFetch seconds={data.lastFetch} />}
      </footer>
    </div>
  );
}
