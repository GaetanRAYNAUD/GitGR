// Historique d'un fichier, ouvert à la place du graphe depuis le clic droit sur un fichier :
// commits de la branche courante qui le modifient (`git log --follow`, renommages suivis).
//
// Souris : clic = ses détails ; double-clic = le diff du fichier à ce commit (Retour revient
// ici) ; clic droit = ses actions. Clavier : une seule tabulation, puis ↑ / ↓ (les détails
// suivent), Entrée = le diff, Maj+Entrée = dans le graphe, Maj+F10 / touche Menu = actions.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { commitDate } from "../../lib/format";
import type { FileHistoryEntry } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { fileViewGoBack, useBlameView, useFileHistoryView } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { StatusBadge } from "./FileList";
import { commitMenu, fileMenu } from "./menus";

/** Nombre de commits lus au plus (cf. `history.rs`). */
const LIMIT = 500;

export function FileHistoryView({ path, file }: { path: string; file: string }) {
  const { t, i18n } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const back = useCallback(() => {
    if (!fileViewGoBack(path)) returnFocus();
  }, [path, returnFocus]);
  useEscape(back);
  const here = { kind: "history" as const, file };
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Relu quand les refs changent (commit, checkout, pull…). Une relecture qui échoue garde la
  // liste déjà affichée (erreur en bandeau, « Réessayer »).
  useEffect(() => {
    let live = true;
    api.fileHistory(path, file).then(
      (list) => {
        if (!live) return;
        setEntries(list);
        setError(null);
      },
      (e) => {
        if (live) setError(errorCode(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, file, refs, reload]);

  // Focus sur la liste dès qu'elle est là.
  const focused = useRef(false);
  useEffect(() => {
    if (entries && entries.length > 0 && !focused.current) {
      focused.current = true;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [entries]);

  const when = (s: number) => {
    const d = commitDate(s * 1000, i18n.language);
    return d.key === "date" ? d.text : t(`time.${d.key}`, { count: d.count });
  };
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) useFileHistoryView.getState().close(path);
      else setMissing(sha);
    });
  const showDiff = (e: FileHistoryEntry) => {
    useGraph.getState().select(path, e.commit.sha);
    void useGraph.getState().openDiff(path, e.commit.sha, e.change);
  };
  const choose = (e: FileHistoryEntry) => {
    setMissing(null);
    useGraph.getState().select(path, e.commit.sha);
  };
  const items = (e: FileHistoryEntry): MenuItem[] => [
    { label: t("fileHistory.showDiff"), onClick: () => showDiff(e) },
    { label: t("reflog.showInGraph"), onClick: () => reveal(e.commit.sha) },
    {
      label: t("blame.atCommit"),
      disabled: e.change.status === "D",
      title: e.change.status === "D" ? t("blame.deleted") : undefined,
      onClick: () => useBlameView.getState().show(path, { file: e.change.path, rev: e.commit.sha, historyFile: file }, here),
    },
    "sep",
    ...commitMenu(t, path, e.commit.sha, refs),
  ];

  const list = entries ?? [];
  // Ligne active : le commit choisi s'il est dans la liste, sinon la première.
  const activeIndex = Math.max(
    0,
    list.findIndex((e) => e.commit.sha === selected),
  );
  const go = (i: number) => {
    const n = Math.max(0, Math.min(i, list.length - 1));
    if (!list[n]) return;
    choose(list[n]);
    document.getElementById(`fh-${list[n].commit.sha}`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    const e = list[activeIndex];
    if (!e) return;
    let handled = true;
    if (ev.key === "ArrowDown") go(activeIndex + 1);
    else if (ev.key === "ArrowUp") go(activeIndex - 1);
    else if (ev.key === "Home") go(0);
    else if (ev.key === "End") go(list.length - 1);
    else if (ev.key === "PageDown") go(activeIndex + 10);
    else if (ev.key === "PageUp") go(activeIndex - 10);
    else if (ev.key === "Enter") {
      if (ev.shiftKey) reveal(e.commit.sha);
      else showDiff(e);
    } else if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
      useGraph.getState().select(path, e.commit.sha);
      const box = document.getElementById(`fh-${e.commit.sha}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(e));
    } else handled = false;
    if (handled) ev.preventDefault();
  };

  // Le fichier n'est plus dans la copie de travail (dernier commit : suppression) : pas de blame.
  const gone = list[0]?.change.status === "D";
  const count = entries
    ? entries.length >= LIMIT
      ? t("fileHistory.resultsMore", { count: LIMIT })
      : t("fileHistory.results", { count: entries.length })
    : "";

  return (
    <section ref={sectionRef} className="pull-view reflog-view file-history-view" aria-label={t("fileHistory.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title" title={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file))}>
          {t("fileHistory.of")} <span className="mono">{file}</span>
        </span>
        <button
          className="btn sm"
          disabled={gone}
          title={gone ? t("fileHistory.blameGone") : undefined}
          onClick={() => useBlameView.getState().show(path, { file, rev: null, historyFile: file }, here)}
        >
          {t("blame.menu")}
        </button>
      </header>
      <p className="muted reflog-hint">
        {count && <span className="file-history-count">{count}</span>}
        {t("fileHistory.keys")}
      </p>
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
      {!entries ? (
        !error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="muted pull-pad">{t("fileHistory.none")}</p>
      ) : (
        <ul
          ref={listRef}
          className="reflog-list"
          role="listbox"
          tabIndex={0}
          aria-label={count}
          aria-activedescendant={list[activeIndex] ? `fh-${list[activeIndex].commit.sha}` : undefined}
          onKeyDown={onKeyDown}
        >
          {entries.map((e, i) => {
            const status = t(`details.status.${e.change.status}`, { defaultValue: e.change.status });
            const description = [
              status,
              e.change.oldPath ? t("fileHistory.renamedFrom", { path: e.change.oldPath }) : null,
              e.commit.author,
              when(e.commit.time),
              e.commit.sha.slice(0, 7),
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={e.commit.sha}
                id={`fh-${e.commit.sha}`}
                role="option"
                aria-selected={selected === e.commit.sha}
                aria-label={e.commit.subject}
                aria-description={description}
                className={["reflog-row", selected === e.commit.sha && "on", i === activeIndex && "active"].filter(Boolean).join(" ")}
                onClick={() => choose(e)}
                onDoubleClick={() => showDiff(e)}
                onContextMenu={(ev) => {
                  useGraph.getState().select(path, e.commit.sha);
                  openContextMenu(ev, items(e));
                }}
              >
                <StatusBadge status={e.change.status} />
                <span className="reflog-message">
                  {e.commit.subject}
                  {e.change.oldPath && <span className="muted file-history-rename">{t("fileHistory.renamedFrom", { path: e.change.oldPath })}</span>}
                </span>
                <span className="muted search-author">{e.commit.author}</span>
                <span className="mono muted file-history-sha">{e.commit.sha.slice(0, 7)}</span>
                <span className="muted reflog-time" title={new Date(e.commit.time * 1000).toLocaleString(i18n.language)}>
                  {when(e.commit.time)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
