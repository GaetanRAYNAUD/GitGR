// Exécutions de CI du dépôt (GitHub Actions, pipelines GitLab), ouvertes à la place du graphe :
// toutes, pas seulement celles des PR / MR. Filtres : branche, état. Relues toutes les 20 s
// tant qu'une exécution tourne.
//
// Clavier : une seule tabulation pour la liste (↑ / ↓, Début / Fin), Entrée = ouvrir sur la
// forge, Maj+Entrée = le commit dans le graphe, Maj+F10 / touche Menu = actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { CiRun } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { type PullContext, usePullContexts } from "../../store/pullList";
import { useCiView } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon, type IconName } from "../Icon";
import { Picker } from "../Picker";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { listKeys, RetryNotice, scrollRow, useCommitWhen } from "./viewKit";

type StateFilter = "all" | "failure" | "running";
const REFRESH_MS = 20_000;

const ICONS: Record<string, IconName> = { success: "check", failure: "alert", running: "clock", pending: "clock", canceled: "close", skipped: "close", manual: "user", neutral: "commit" };

export function CiView({ path, branch: initialBranch }: { path: string; branch: string | null }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useCiView((s) => s.close);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const contexts = usePullContexts(path);
  const [remote, setRemote] = useState<string | null>(null);
  const ctx: PullContext | undefined = contexts.find((c) => c.remote === remote) ?? contexts.find((c) => c.remote === "origin") ?? contexts[0];
  const allRefs = useGraph((s) => s.graphs[path]?.refs?.refs);
  const locals = useMemo(() => (allRefs ?? []).filter((r) => r.kind === "local").map((r) => r.short), [allRefs]);
  const head = useGraph((s) => s.graphs[path]?.refs?.headBranch ?? null);
  const [branch, setBranch] = useState<string | null>(initialBranch);
  const [filter, setFilter] = useState<StateFilter>("all");
  // Workflow (GitHub) : filtre sur les exécutions lues, proposé dès qu'il y en a deux.
  const [workflow, setWorkflow] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ key: string; list: CiRun[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [row, setRow] = useState(0);
  const { when, full } = useCommitWhen();
  const key = `${ctx?.remote}|${branch}`;

  useEffect(() => {
    if (!ctx?.account) return;
    let live = true;
    api.ciRuns(ctx.kind, ctx.url, ctx.account, ctx.repo, branch).then(
      (list) => {
        if (!live) return;
        setRuns({ key, list });
        setError(null);
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
    // `key` résume le contexte et la branche.
  }, [key, reload, ctx?.account]);

  // Une exécution tourne : relue régulièrement.
  const active = runs?.list.some((r) => r.state === "running" || r.state === "pending");
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setReload((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, [active]);

  const workflows = useMemo(() => [...new Set((runs?.key === key ? runs.list : []).map((r) => r.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [runs, key]);
  const list = useMemo(() => {
    const all = (runs?.key === key ? runs.list : []).filter((r) => workflow === null || r.name === workflow);
    return filter === "all" ? all : all.filter((r) => (filter === "failure" ? r.state === "failure" : r.state === "running" || r.state === "pending"));
  }, [runs, key, filter, workflow]);
  const at = Math.min(row, Math.max(0, list.length - 1));

  // Focus sur la liste dès qu'elle a des lignes (une fois).
  const focused = useRef(false);
  useEffect(() => {
    if (list.length && !focused.current) {
      focused.current = true;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [list.length]);

  const name = (r: CiRun) => r.name || t("ci.pipeline", { id: r.id });
  const open = (r: CiRun) => r.url && void api.openUrl(r.url);
  const reveal = (r: CiRun) => void useGraph.getState().reveal(path, r.sha).then((ok) => (ok ? close(path) : useApp.getState().notify(t("ci.notInGraph"))));
  const retry = async (r: CiRun) => {
    if (!ctx) return;
    try {
      await api.ciRetry(ctx.kind, ctx.url, ctx.account, ctx.repo, r.id);
      useApp.getState().notify(t("ci.retried", { name: name(r) }));
      setReload((n) => n + 1);
    } catch (e) {
      useApp.setState({ error: errorCode(e) });
    }
  };
  const items = (r: CiRun): MenuItem[] => [
    { header: name(r) },
    { label: t("ci.open"), disabled: !r.url, onClick: () => open(r) },
    { label: t("ci.showCommit"), onClick: () => reveal(r) },
    {
      label: t("ci.retry"),
      disabled: r.state !== "failure" && r.state !== "canceled",
      title: r.state === "failure" || r.state === "canceled" ? undefined : t("ci.retryWhy"),
      onClick: () => void retry(r),
    },
  ];
  const onKeyDown = listKeys(list.length, at, {
    go: (i) => {
      setRow(i);
      scrollRow(`ci-${i}`);
    },
    enter: (shift) => (shift ? reveal(list[at]) : open(list[at])),
    menu: () => {
      const box = document.getElementById(`ci-${at}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(list[at]));
    },
  });

  const branchLabel = branch ?? t("ci.allBranches");
  return (
    <section ref={sectionRef} className="pull-view ci-view" aria-label={t("ci.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title">{t("ci.title")}</span>
        {contexts.length > 1 && ctx && (
          <Picker label={t("ci.forge")} items={() => contexts.map((c) => ({ label: `${c.remote} · ${c.repo}`, checked: c.remote === ctx.remote, onClick: () => setRemote(c.remote) }))}>
            <Icon name={ctx.kind} size={14} />
            <span className="picker-text">{ctx.remote}</span>
          </Picker>
        )}
        <Picker
          label={t("ci.branch")}
          items={() => [
            { label: t("ci.allBranches"), checked: branch === null, onClick: () => setBranch(null) },
            "sep",
            ...[...new Set([head, ...locals].filter((b): b is string => !!b))].map((b) => ({ label: b, checked: b === branch, onClick: () => setBranch(b) })),
          ]}
        >
          <Icon name="branch" size={14} />
          <span className="picker-text">{branchLabel}</span>
        </Picker>
        {(workflows.length > 1 || workflow !== null) && (
          <Picker
            label={t("ci.workflow")}
            items={() => [
              { label: t("ci.allWorkflows"), checked: workflow === null, onClick: () => setWorkflow(null) },
              "sep",
              ...[...new Set([...workflows, ...(workflow ? [workflow] : [])])].map((w) => ({ label: w, checked: w === workflow, onClick: () => setWorkflow(w) })),
            ]}
          >
            <Icon name="list" size={14} />
            <span className="picker-text">{workflow ?? t("ci.allWorkflows")}</span>
          </Picker>
        )}
        <div className="view-toggle ci-filter" role="group" aria-label={t("ci.stateFilter")}>
          {(["all", "failure", "running"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : undefined} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`ci.filter.${f}`)}
            </button>
          ))}
        </div>
        <button className="icon-btn" aria-label={t("ci.refresh")} title={t("ci.refresh")} onClick={() => setReload((n) => n + 1)}>
          <Icon name="fetch" size={14} />
        </button>
      </header>
      <p className="muted reflog-hint" title={t("ci.keys")}>
        {t("ci.keys")}
      </p>
      {!ctx ? (
        <p className="muted pull-pad">{t("ci.noForge")}</p>
      ) : !ctx.account ? (
        <p className="muted pull-pad">{t("ci.noAccount", { remote: ctx.remote })}</p>
      ) : (
        <>
          {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
          {runs?.key !== key ? (
            !error && <p className="muted pull-pad">{t("details.loading")}</p>
          ) : list.length === 0 ? (
            <p className="muted pull-pad">{t(filter === "all" && workflow === null ? "ci.empty" : "ci.emptyFilter")}</p>
          ) : (
            <ul ref={listRef} className="reflog-list ci-list" role="listbox" tabIndex={0} aria-label={t("ci.list")} aria-activedescendant={`ci-${at}`} onKeyDown={onKeyDown}>
              {list.map((r, i) => (
                <li
                  key={r.id}
                  id={`ci-${i}`}
                  role="option"
                  aria-selected={i === at}
                  aria-label={`${name(r)}, ${t(`ci.state.${r.state}`)}`}
                  aria-description={[r.title, r.branch, r.sha.slice(0, 7), when(r.created)].filter(Boolean).join(", ")}
                  className={["reflog-row ci-row", i === at && "on active"].filter(Boolean).join(" ")}
                  onClick={() => setRow(i)}
                  onDoubleClick={() => open(r)}
                  onContextMenu={(ev) => {
                    setRow(i);
                    openContextMenu(ev, items(r));
                  }}
                >
                  <span className={`pull-state ci-state ci-${r.state}`}>
                    <Icon name={ICONS[r.state] ?? "commit"} size={12} />
                    {t(`ci.state.${r.state}`)}
                  </span>
                  <span className="ci-name">{name(r)}</span>
                  <span className="reflog-message" title={r.title ?? ""}>
                    {r.title}
                  </span>
                  {r.branch && <span className="mono muted ci-branch">{r.branch}</span>}
                  <span className="mono muted reflog-sha">{r.sha.slice(0, 7)}</span>
                  {r.event && <span className="muted ci-event">{t(`ci.events.${r.event}`, { defaultValue: r.event })}</span>}
                  <span className="muted reflog-time" title={full(r.created)}>
                    {when(r.created)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
