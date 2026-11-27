// « Où était HEAD » (reflog), ouvert à la place du graphe depuis la barre d'outils : les
// positions passées de HEAD ou d'une branche locale, pour retrouver un commit perdu (reset,
// rebase raté, branche supprimée).
//
// Souris : clic = ses détails à droite ; double-clic = le montrer dans le graphe ; clic droit =
// branche, checkout, reset. Clavier : une seule tabulation, ↑ / ↓ (les détails suivent),
// Entrée = détails, Maj+Entrée = dans le graphe, Maj+F10 / touche Menu = actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { ReflogEntry } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useReflogView } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu } from "./menus";
import { listKeys, RetryNotice, scrollRow, useCommitWhen } from "./viewKit";

export function ReflogView({ path, refname }: { path: string; refname: string }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useReflogView((s) => s.close);
  const show = useReflogView((s) => s.show);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const commits = useGraph((s) => s.graphs[path]?.commits);
  const done = useGraph((s) => s.graphs[path]?.done ?? false);
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Ligne active (un même commit peut revenir plusieurs fois). */
  const [row, setRow] = useState(0);
  /** Commit montré dans le graphe mais introuvable dans l'historique des branches. */
  const [missing, setMissing] = useState<number | null>(null);
  const { when, full } = useCommitWhen();

  // Relu à chaque nouvel état des refs (commit, checkout, reset…). Une relecture qui échoue
  // garde la liste affichée (erreur en bandeau, « Réessayer »).
  useEffect(() => {
    let live = true;
    api.reflog(path, refname).then(
      (list) => {
        if (!live) return;
        setEntries(list);
        setError(null);
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, refname, refs, reload]);

  // Focus sur la liste dès qu'elle est là (une fois par ref).
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (entries?.length && focused.current !== refname) {
      focused.current = refname;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [entries, refname]);

  const known = useMemo(() => new Set((commits ?? []).map((c) => c.sha)), [commits]);
  const locals = (refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short);
  const list = entries ?? [];
  const at = Math.min(row, Math.max(0, list.length - 1));

  const reveal = (i: number, sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) close(path);
      else setMissing(i);
    });
  const choose = (i: number) => {
    const e = list[i];
    if (!e) return;
    setRow(i);
    setMissing(null);
    useGraph.getState().select(path, e.sha);
    scrollRow(`rl-${i}`);
  };
  const items = (i: number, sha: string): MenuItem[] => [{ label: t("reflog.showInGraph"), onClick: () => reveal(i, sha) }, "sep", ...commitMenu(t, path, sha, refs)];
  const onKeyDown = listKeys(list.length, at, {
    go: choose,
    enter: (shift) => (shift ? reveal(at, list[at].sha) : choose(at)),
    menu: () => {
      useGraph.getState().select(path, list[at].sha);
      const box = document.getElementById(`rl-${at}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(at, list[at].sha));
    },
  });

  return (
    <section ref={sectionRef} className="pull-view reflog-view" aria-label={t("reflog.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title">{t("reflog.title", { ref: refname })}</span>
        <select className="pf-input reflog-ref" value={refname} onChange={(e) => show(path, e.target.value)} aria-label={t("reflog.ref")}>
          <option value="HEAD">{t("reflog.head")}</option>
          {locals.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </header>
      <p className="muted reflog-hint" title={t("reflog.keys")}>
        {t("reflog.keys")}
      </p>
      {missing !== null && (
        <p className="details-note muted blame-note" role="status">
          {t("reflog.notInGraph")}
        </p>
      )}
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!entries ? (
        !error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="muted pull-pad">{t("reflog.empty")}</p>
      ) : (
        <ul
          ref={listRef}
          className="reflog-list"
          role="listbox"
          tabIndex={0}
          aria-label={t("reflog.title", { ref: refname })}
          aria-activedescendant={`rl-${at}`}
          onKeyDown={onKeyDown}
        >
          {entries.map((e, i) => {
            const lost = done && !known.has(e.sha);
            const message = e.message || e.subject;
            return (
              <li
                key={`${i}:${e.sha}`}
                id={`rl-${i}`}
                role="option"
                aria-selected={i === at}
                aria-label={message}
                aria-description={[e.action, lost ? t("reflog.lost") : null, e.sha.slice(0, 7), when(e.time), `@{${i}}`].filter(Boolean).join(", ")}
                className={["reflog-row", i === at && "on active"].filter(Boolean).join(" ")}
                onClick={() => choose(i)}
                onDoubleClick={() => reveal(i, e.sha)}
                onContextMenu={(ev) => {
                  setRow(i);
                  useGraph.getState().select(path, e.sha);
                  openContextMenu(ev, items(i, e.sha));
                }}
              >
                <span className="mono reflog-index">@{`{${i}}`}</span>
                <span className="reflog-action">{e.action}</span>
                <span className="reflog-message">{message}</span>
                {lost && <span className="reflog-lost">{t("reflog.lost")}</span>}
                <span className="mono muted reflog-sha">{e.sha.slice(0, 7)}</span>
                <span className="muted reflog-time" title={full(e.time)}>
                  {when(e.time)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
