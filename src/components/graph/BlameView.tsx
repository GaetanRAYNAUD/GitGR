// Blame d'un fichier, ouvert à la place du graphe (clic droit sur un fichier, historique du
// fichier) : chaque ligne avec le commit qui l'a écrite (`git blame`), à un commit donné ou
// sur la copie de travail. Les lignes consécutives d'un même commit forment un bloc, dont la
// première ligne porte le commit (qui, quand, puis le résumé).
//
// Souris : clic = ses détails ; double-clic = le montrer dans le graphe ; clic droit = ses
// actions. Clavier : une seule tabulation, puis ↑ / ↓ (Pg↑ / Pg↓, Début / Fin) de ligne en
// ligne, F7 / Maj+F7 de bloc en bloc, Entrée = détails, Maj+Entrée = dans le graphe,
// Maj+F10 / touche Menu = actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { commitDate } from "../../lib/format";
import type { Blame, BlameCommit } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useWork } from "../../store/worktree";
import { fileViewGoBack, useBlameView, useFileHistoryView, type BlameTarget } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu, fileMenu } from "./menus";

/** SHA des lignes pas encore commitées (copie de travail). */
const uncommitted = (sha: string) => /^0+$/.test(sha);

export function BlameView({ path, target }: { path: string; target: BlameTarget }) {
  const { t, i18n } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const back = useCallback(() => {
    // Vue d'avant (historique, blame à un autre commit) s'il y en a une, sinon le graphe et le
    // focus rendu à ce qui avait ouvert la vue.
    if (!fileViewGoBack(path)) returnFocus();
  }, [path, returnFocus]);
  useEscape(back);
  const { file, rev } = target;
  const historyFile = target.historyFile ?? file;
  const here = { kind: "blame" as const, target };
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [blame, setBlame] = useState<Blame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Ligne active au clavier (index). */
  const [active, setActive] = useState(0);

  // Relu quand les refs changent ; celui de la copie de travail aussi quand elle change. Une
  // relecture qui échoue garde le blame déjà affiché (erreur en bandeau, « Réessayer »).
  const work = useWork((s) => (rev ? null : (s.repos[path]?.status ?? null)));
  useEffect(() => {
    let live = true;
    api.blame(path, file, rev).then(
      (b) => {
        if (!live) return;
        setBlame(b);
        setError(null);
      },
      (e) => {
        if (live) setError(errorCode(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, file, rev, refs, work, reload]);

  // Focus sur la grille dès qu'elle est là (une fois par fichier / commit).
  const focused = useRef(false);
  useEffect(() => {
    if (blame && blame.lines.length > 0 && !focused.current) {
      focused.current = true;
      gridRef.current?.focus({ preventScroll: true });
    }
  }, [blame]);

  const commits = useMemo(() => new Map((blame?.commits ?? []).map((c) => [c.sha, c])), [blame]);
  // Âge relatif de chaque commit (0 : le plus ancien du fichier, 1 : le plus récent), pour la
  // marque en marge ; les lignes pas encore commitées comptent comme les plus récentes.
  const age = useMemo(() => {
    const times = (blame?.commits ?? []).filter((c) => !uncommitted(c.sha)).map((c) => c.time);
    const min = Math.min(...times);
    const span = Math.max(...times) - min;
    return (c: BlameCommit) => (uncommitted(c.sha) || span <= 0 ? 1 : (c.time - min) / span);
  }, [blame]);
  const when = (s: number) => {
    const d = commitDate(s * 1000, i18n.language);
    return d.key === "date" ? d.text : t(`time.${d.key}`, { count: d.count });
  };
  const fullDate = (s: number) => new Date(s * 1000).toLocaleString(i18n.language);
  const lines = blame?.lines ?? [];
  const at = Math.min(active, Math.max(lines.length - 1, 0));

  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) useBlameView.getState().close(path);
      else setMissing(sha);
    });
  const pick = (c: BlameCommit) => {
    setMissing(null);
    if (!uncommitted(c.sha)) useGraph.getState().select(path, c.sha);
  };
  const items = (c: BlameCommit): MenuItem[] => [
    { label: t("reflog.showInGraph"), onClick: () => reveal(c.sha) },
    {
      label: t("blame.atCommit"),
      disabled: rev === c.sha,
      title: rev === c.sha ? t("blame.atCommitSame") : undefined,
      onClick: () => useBlameView.getState().show(path, { file: c.filename || file, rev: c.sha, historyFile }, here),
    },
    {
      label: t("blame.before"),
      disabled: !c.previous,
      title: c.previous ? t("blame.beforeHint", { sha: c.previous.sha.slice(0, 7) }) : t("blame.beforeNone"),
      onClick: () => c.previous && useBlameView.getState().show(path, { file: c.previous.filename, rev: c.previous.sha, historyFile }, here),
    },
    "sep",
    ...commitMenu(t, path, c.sha, refs),
  ];
  const menu = (ev: React.MouseEvent, c: BlameCommit) => {
    if (uncommitted(c.sha)) return;
    useGraph.getState().select(path, c.sha);
    openContextMenu(ev, items(c));
  };

  /** Ligne `i` active, et visible. */
  const go = (i: number) => {
    const n = Math.max(0, Math.min(i, lines.length - 1));
    setActive(n);
    document.getElementById(`blame-l-${n}`)?.scrollIntoView({ block: "nearest" });
  };
  /** Début du bloc (commit) suivant / précédent. */
  const block = (dir: 1 | -1) => {
    let i = at;
    if (dir === -1) while (i > 0 && lines[i - 1].sha === lines[at].sha) i--;
    i += dir;
    if (dir === -1) while (i > 0 && lines[i - 1].sha === lines[i].sha) i--;
    else while (i < lines.length && i > 0 && lines[i - 1].sha === lines[i].sha) i++;
    if (i >= 0 && i < lines.length) go(i);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (lines.length === 0) return;
    const c = commits.get(lines[at].sha);
    const page = Math.max(1, Math.floor((gridRef.current?.parentElement?.clientHeight ?? 400) / 19) - 1);
    let handled = true;
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "PageDown") go(at + page);
    else if (e.key === "PageUp") go(at - page);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(lines.length - 1);
    else if (e.key === "F7") block(e.shiftKey ? -1 : 1);
    else if (e.key === "Enter" && c) {
      if (e.shiftKey) {
        if (!uncommitted(c.sha)) reveal(c.sha);
      } else pick(c);
    } else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && c && !uncommitted(c.sha)) {
      useGraph.getState().select(path, c.sha);
      const box = document.getElementById(`blame-l-${at}`)?.querySelector(".blame-commit")?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(c));
    } else handled = false;
    if (handled) e.preventDefault();
  };

  const showHistory = () => useFileHistoryView.getState().show(path, historyFile, here);

  return (
    <section ref={sectionRef} className="pull-view blame-view" aria-label={t("blame.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title" title={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file, rev ? { rev } : undefined))}>
          {t("blame.of")} <span className="mono">{file}</span>
        </span>
        {rev ? <span className="mono muted diff-sha">{rev.slice(0, 7)}</span> : <span className="muted diff-sha">{t("blame.workingCopy")}</span>}
        <button className="btn sm" onClick={showHistory}>
          {t("fileHistory.menu")}
        </button>
      </header>
      <p className="muted reflog-hint blame-hint">{t("blame.keys")}</p>
      {blame?.truncated && <p className="details-note muted blame-note">{t("blame.truncated")}</p>}
      {missing && (
        <p className="details-note muted blame-note" role="status">
          {t("reflog.notInGraph")}
        </p>
      )}
      {error && (
        <div className="notice error blame-error" role="alert">
          <Icon name="alert" />
          <span>{errorMessage(t, error)}</span>
          <button type="button" className="link notice-action" onClick={() => setReload((n) => n + 1)}>
            {t("graph.retry")}
          </button>
        </div>
      )}
      {!blame ? (
        !error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : lines.length === 0 ? (
        <p className="muted pull-pad">{t("blame.empty")}</p>
      ) : (
        <div className="blame-body">
          <table
            ref={gridRef}
            className="blame-table mono"
            role="grid"
            tabIndex={0}
            aria-label={t("blame.gridLabel", { file })}
            aria-activedescendant={`blame-l-${at}`}
            onKeyDown={onKeyDown}
          >
            <tbody>
              {lines.map((l, i) => {
                const c = commits.get(l.sha);
                const start = i === 0 || lines[i - 1].sha !== l.sha;
                const mine = uncommitted(l.sha);
                const who = c && !mine ? `${c.author} · ${when(c.time)}` : "";
                return (
                  <tr
                    key={i}
                    id={`blame-l-${i}`}
                    aria-label={mine || !c ? t("blame.rowUncommitted", { n: i + 1 }) : t("blame.row", { n: i + 1, summary: c.summary, who })}
                    className={[start && "start", selected === l.sha && "on", mine && "wip", i === at && "active"].filter(Boolean).join(" ") || undefined}
                  >
                    <td
                      className="blame-commit"
                      style={c ? ({ "--age": age(c).toFixed(2) } as React.CSSProperties) : undefined}
                      title={c && !mine ? `${c.summary}\n${c.author} <${c.email}>\n${fullDate(c.time)}\n${c.sha.slice(0, 7)}` : t("blame.uncommittedHint")}
                      onClick={() => {
                        setActive(i);
                        if (c) pick(c);
                      }}
                      onDoubleClick={() => c && !mine && reveal(c.sha)}
                      onContextMenu={(ev) => {
                        setActive(i);
                        if (c) menu(ev, c);
                      }}
                    >
                      {start && c && (
                        <span className="blame-cell">
                          {mine ? (
                            <span className="blame-summary">{t("blame.uncommitted")}</span>
                          ) : (
                            <>
                              <span className="muted blame-meta">{who}</span>
                              <span className="blame-summary">{c.summary}</span>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="ln muted">{i + 1}</td>
                    <td className="blame-text">{l.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
