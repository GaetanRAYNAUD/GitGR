// Historique d'un fichier, ouvert à la place du graphe depuis le clic droit sur un fichier :
// commits de la branche courante qui le modifient (`git log --follow`, renommages suivis).
// Clic : ses détails ; double-clic : le diff du fichier à ce commit (Retour revient ici) ;
// clic droit : ses actions.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import type { FileHistoryEntry } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useBlameView, useFileHistoryView } from "../../store/range";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";
import { StatusBadge } from "./FileList";
import { commitMenu, fileMenu } from "./menus";

const LIMIT = 500;

export function FileHistoryView({ path, file }: { path: string; file: string }) {
  const { t } = useTranslation();
  const close = useFileHistoryView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  // Relu quand les refs changent (commit, checkout, pull…).
  useEffect(() => {
    let live = true;
    api.fileHistory(path, file).then(
      (list) => {
        if (!live) return;
        setEntries(list);
        setError(null);
      },
      (e) => {
        if (!live) return;
        setEntries(null);
        setError(errorCode(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, file, refs]);

  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) back();
      else setMissing(sha);
    });
  const showDiff = (e: FileHistoryEntry) => {
    useGraph.getState().select(path, e.commit.sha);
    void useGraph.getState().openDiff(path, e.commit.sha, e.change);
  };

  return (
    <section className="pull-view reflog-view file-history-view" aria-label={t("fileHistory.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="clock" size={15} />
        <span className="pull-view-title mono" onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file))}>
          {t("fileHistory.title", { file })}
        </span>
        <button className="btn sm" onClick={() => useBlameView.getState().show(path, { file, rev: null })}>
          {t("blame.menu")}
        </button>
      </header>
      <p className="muted reflog-hint">
        {entries ? t("fileHistory.results", { count: entries.length }) + (entries.length >= LIMIT ? ` · ${t("fileHistory.limit")}` : "") + " · " : ""}
        {t("fileHistory.hint")}
      </p>
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !entries ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="muted pull-pad">{t("fileHistory.none")}</p>
      ) : (
        <ul className="reflog-list" aria-label={t("fileHistory.results", { count: entries.length })}>
          {entries.map((e) => (
            <li key={e.commit.sha}>
              <button
                className={selected === e.commit.sha ? "reflog-row on" : "reflog-row"}
                onClick={() => {
                  setMissing(null);
                  useGraph.getState().select(path, e.commit.sha);
                }}
                onDoubleClick={() => showDiff(e)}
                onContextMenu={(ev) => {
                  useGraph.getState().select(path, e.commit.sha);
                  openContextMenu(ev, [
                    { label: t("fileHistory.showDiff"), onClick: () => showDiff(e) },
                    { label: t("reflog.showInGraph"), onClick: () => reveal(e.commit.sha) },
                    {
                      label: t("blame.atCommit"),
                      disabled: e.change.status === "D",
                      onClick: () => useBlameView.getState().show(path, { file: e.change.path, rev: e.commit.sha }),
                    },
                    "sep",
                    ...commitMenu(t, path, e.commit.sha, refs),
                  ]);
                }}
              >
                <StatusBadge status={e.change.status} />
                <span className="reflog-message">
                  {e.commit.subject}
                  {e.change.oldPath && <span className="muted file-history-rename"> · {t("fileHistory.renamedFrom", { path: e.change.oldPath })}</span>}
                </span>
                <span className="muted search-author">{e.commit.author}</span>
                <span className="mono muted">{e.commit.sha.slice(0, 7)}</span>
                <span className="muted reflog-time">{ago(e.commit.time)}</span>
              </button>
              {missing === e.commit.sha && (
                <p className="details-note muted reflog-missing" role="status">
                  {t("reflog.notInGraph")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
