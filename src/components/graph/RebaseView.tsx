// Rebase interactif, ouvert à la place du graphe : les commits de la branche courante depuis
// une base, du plus ancien au plus récent. On les réordonne (glisser-déposer, Alt+↑ / Alt+↓),
// on choisit leur sort (garder, renommer, réunir au précédent, réunir sans son message,
// retirer : touches P, R, S, F, D comme dans `git rebase -i`), puis on lance le rebase.
//
// Clavier : une seule tabulation pour la liste (↑ / ↓, Début / Fin), Entrée sur un commit à
// renommer amène dans son message, Échap revient à la liste puis ferme la vue.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { ACTION_KEYS, ACTIONS, moveRow, planProblem, type PlanRow, type RebaseAction, rewritesPushed, summary } from "../../lib/rebasePlan";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useRebaseView } from "../../store/range";
import { useDialogs } from "../../store/dialogs";
import { type MenuItem, openMenuBelow } from "../ContextMenu";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { RetryNotice, scrollRow, useCommitWhen } from "./viewKit";

export function RebaseView({ path, base, label, onto = false }: { path: string; base: string | null; label: string; onto?: boolean }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useRebaseView((s) => s.close);
  const leave = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  // Plan modifié : on demande avant de le jeter (Échap, Retour, Annuler).
  const dirty = useRef(false);
  const back = useCallback(async () => {
    if (dirty.current) {
      const ok = await useDialogs.getState().choose({
        title: t("rebase.leaveTitle"),
        body: t("rebase.leaveBody"),
        choices: [{ id: "leave", label: t("rebase.leave"), danger: true }],
      });
      if (ok !== "leave") return;
    }
    leave();
  }, [leave, t]);
  useEscape(() => void back());
  const branch = useGraph((s) => s.graphs[path]?.refs?.headBranch ?? "HEAD");
  const running = useOps((s) => !!s.running[path]);
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [original, setOriginal] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [at, setAt] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const { when } = useCommitWhen();

  useEffect(() => {
    let live = true;
    api.rebasePlan(path, base, onto).then(
      (p) => {
        if (!live) return;
        setRows(p.commits.map((c) => ({ sha: c.sha, subject: c.subject, original: c.message, action: "pick", message: c.message, pushed: c.pushed, time: c.time })));
        setOriginal(p.commits.map((c) => c.sha));
        setError(null);
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, base, onto, reload]);

  // Focus sur la liste dès qu'elle est là (une fois). Le menu contextuel qui a ouvert la vue,
  // en se refermant, ou le graphe qui s'en va peuvent le reprendre juste après : on le remet
  // tant qu'il n'est pas allé ailleurs dans la vue.
  const focused = useRef(false);
  useEffect(() => {
    if (!rows?.length || focused.current) return;
    focused.current = true;
    const put = () => {
      const now = document.activeElement;
      if (!now || now === document.body || !sectionRef.current?.contains(now)) listRef.current?.focus({ preventScroll: true });
    };
    put();
    const timers = [requestAnimationFrame(put), window.setTimeout(put, 50), window.setTimeout(put, 200)];
    return () => {
      cancelAnimationFrame(timers[0]);
      window.clearTimeout(timers[1]);
      window.clearTimeout(timers[2]);
    };
  }, [rows]);

  const list = rows ?? [];
  const cur = Math.min(at, Math.max(0, list.length - 1));
  const problem = rows ? planProblem(rows, original, onto) : null;
  dirty.current = !!rows && rows.some((r, i) => r.sha !== original[i] || r.action !== "pick");
  const sum = useMemo(() => summary(list, original), [list, original]);
  const pushed = rows ? rewritesPushed(rows, original, onto) : false;

  const setAction = (i: number, action: RebaseAction) => setRows((rs) => rs && rs.map((r, k) => (k === i ? { ...r, action } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    setRows((rs) => rs && moveRow(rs, from, to));
    setAt(to);
    scrollRow(`rb-${to}`);
  };
  const actionMenu = (i: number, el: HTMLElement) =>
    openMenuBelow(
      el,
      ACTIONS.map(
        (a): MenuItem => ({
          label: t(`rebase.actions.${a}`),
          checked: list[i]?.action === a,
          keys: { label: Object.keys(ACTION_KEYS).find((k) => ACTION_KEYS[k] === a)!.toUpperCase(), aria: Object.keys(ACTION_KEYS).find((k) => ACTION_KEYS[k] === a)!.toUpperCase() },
          onClick: () => setAction(i, a),
        }),
      ),
    );

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (!list.length || e.target !== e.currentTarget) return;
    const go = (i: number) => {
      const k = Math.max(0, Math.min(list.length - 1, i));
      setAt(k);
      scrollRow(`rb-${k}`);
    };
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) move(cur, cur + (e.key === "ArrowUp" ? -1 : 1));
    else if (e.key === "ArrowDown" && !e.altKey) go(cur + 1);
    else if (e.key === "ArrowUp" && !e.altKey) go(cur - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (!e.ctrlKey && !e.altKey && !e.metaKey && ACTION_KEYS[e.key.toLowerCase()]) setAction(cur, ACTION_KEYS[e.key.toLowerCase()]);
    else if (e.key === "Delete") setAction(cur, list[cur].action === "drop" ? "pick" : "drop");
    else if (e.key === "Enter" && list[cur].action === "reword") document.getElementById(`rb-msg-${cur}`)?.focus();
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const el = document.getElementById(`rb-act-${cur}`);
      if (el) actionMenu(cur, el);
    } else return;
    e.preventDefault();
  };

  const start = async () => {
    if (!rows || problem || running) return;
    const steps = rows.map((r) => ({ sha: r.sha, action: r.action, message: r.action === "reword" ? r.message : null }));
    const ok = await useOps.getState().interactiveRebase(path, base, onto, steps, pushed);
    if (ok) close(path);
  };

  return (
    <section ref={sectionRef} className="pull-view rebase-view" aria-label={t("rebase.label")}>
      <header className="diff-head">
        <BackButton onClick={() => void back()} />
        <span className="pull-view-title">{t("rebase.title", { branch, base: label })}</span>
      </header>
      <p className="muted reflog-hint" title={t("rebase.keys")}>
        {t("rebase.keys")}
      </p>
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!rows ? (
        !error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : (
        <>
          <ul
            ref={listRef}
            className="rebase-list"
            role="listbox"
            tabIndex={0}
            aria-label={t("rebase.list")}
            aria-activedescendant={`rb-${cur}`}
            onKeyDown={onKeyDown}
          >
            {rows.map((r, i) => (
              <li
                key={r.sha}
                id={`rb-${i}`}
                role="option"
                aria-selected={i === cur}
                aria-label={`${r.subject}, ${t(`rebase.actions.${r.action}`)}`}
                className={["rebase-row", `act-${r.action}`, i === cur && "on active", dragging === i && "dragging"].filter(Boolean).join(" ")}
                draggable
                onDragStart={(e) => {
                  setDragging(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", r.sha);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  if (dragging !== i) {
                    move(dragging, i);
                    setDragging(i);
                  }
                }}
                onClick={() => setAt(i)}
              >
                <span className="rebase-grip" aria-hidden="true">
                  ⋮⋮
                </span>
                <button
                  type="button"
                  id={`rb-act-${i}`}
                  tabIndex={-1}
                  className={`rebase-action act-${r.action}`}
                  aria-haspopup="menu"
                  title={t("rebase.actionHint")}
                  onClick={(e) => {
                    setAt(i);
                    actionMenu(i, e.currentTarget);
                  }}
                >
                  {t(`rebase.actions.${r.action}`)}
                </button>
                <span className="rebase-main">
                  {r.action === "reword" ? (
                    <textarea
                      id={`rb-msg-${i}`}
                      className="pf-input rebase-message"
                      rows={Math.min(6, Math.max(2, r.message.split("\n").length))}
                      value={r.message}
                      aria-label={t("rebase.newMessage", { subject: r.subject })}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((rs) => rs && rs.map((x, k) => (k === i ? { ...x, message: v } : x)));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          listRef.current?.focus();
                        }
                      }}
                    />
                  ) : (
                    <span className="rebase-subject" title={r.original}>
                      {r.subject}
                    </span>
                  )}
                </span>
                {r.pushed && <span className="rebase-pushed" title={t("rebase.pushedHint")}>{t("rebase.pushed")}</span>}
                <span className="mono muted reflog-sha">{r.sha.slice(0, 7)}</span>
                <span className="muted reflog-time">{when(r.time)}</span>
              </li>
            ))}
          </ul>
          <footer className="conflict-foot rebase-foot">
            <span className="muted rebase-summary" role="status">
              {[
                t("rebase.count", { count: rows.length }),
                sum.moved ? t("rebase.moved", { count: sum.moved }) : null,
                sum.reword ? t("rebase.reworded", { count: sum.reword }) : null,
                sum.squash ? t("rebase.squashed", { count: sum.squash }) : null,
                sum.drop ? t("rebase.dropped", { count: sum.drop }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {pushed && !problem && <span className="rebase-warn">{t("rebase.pushedWarn")}</span>}
            {problem && (
              <span id="rebase-why" className="dialog-why">
                {t(problem)}
              </span>
            )}
            <button className="btn sm" onClick={() => void back()}>
              {t("conflict.cancel")}
            </button>
            <button className="btn sm primary" disabled={!!problem || running} aria-describedby={problem ? "rebase-why" : undefined} onClick={() => void start()}>
              {t("rebase.start")}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
