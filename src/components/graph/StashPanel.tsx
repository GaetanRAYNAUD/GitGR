// Panneau de droite quand un stash est sélectionné (dans le graphe ou la section « Stashes ») :
// comme pour un commit, le graphe reste au milieu ; ici son message, d'où il part, de quoi
// l'appliquer / le pop / le supprimer, et ses fichiers (suivis, puis non suivis mis de côté
// avec lui). Un fichier s'ouvre dans le diff, à la place du graphe, comme ceux d'un commit.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { EMPTY_TREE, stashLabel } from "../../lib/stashes";
import type { FileChange, StashChanges, StashEntry } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";
import { fileMenu } from "./menus";
import { RetryNotice, useCommitWhen } from "./viewKit";

type StashFile = FileChange & { untracked?: boolean };

export function StashPanel({ path, entry }: { path: string; entry: StashEntry }) {
  const { t } = useTranslation();
  const { when, full: fullDate } = useCommitWhen();
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const running = useOps((s) => !!s.running[path]);
  const diff = useGraph((s) => s.diffs[path]);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{ sha: string; changes: StashChanges } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.stashChanges(path, entry.sha).then(
      (changes) => live && setData({ sha: entry.sha, changes }),
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, entry.sha, reload]);

  const changes = data?.sha === entry.sha ? data.changes : null;
  const files = useMemo<StashFile[]>(
    () => (changes ? [...changes.files, ...changes.untrackedFiles.map((f) => ({ ...f, untracked: true }))] : []),
    [changes],
  );
  // Diff d'un fichier : par rapport au commit de départ ; un non suivi, depuis l'arbre vide.
  const open = (f: StashFile) => {
    if (f.untracked && changes?.untracked) void useGraph.getState().openDiff(path, changes.untracked, f, EMPTY_TREE);
    else void useGraph.getState().openDiff(path, entry.sha, f);
  };
  const isOpen = (f: StashFile) =>
    !!diff && diff.file.path === f.path && (f.untracked ? diff.sha === changes?.untracked : diff.sha === entry.sha && !diff.base);

  const ops = useOps.getState();
  const { text, branch } = stashLabel(entry.message);
  const busy = running ? t("repo.busy") : undefined;

  return (
    <>
      <div className="details-head stash-panel-head">
        <p className="eyebrow">
          <Icon name="stash" size={13} /> {t("stashes.panelTitle")}
        </p>
        <h2 className="details-subject">{text}</h2>
        <div className="stash-panel-meta muted">
          {branch && <span>{t("stashes.onBranch", { branch })}</span>}
          <span title={fullDate(entry.time)}>{when(entry.time)}</span>
          <button className="link mono" title={t("stashes.showBase")} onClick={() => void useGraph.getState().reveal(path, entry.base)}>
            {entry.base.slice(0, 7)}
          </button>
        </div>
        <div className="stash-panel-actions">
          <button className="btn sm primary" disabled={running} title={busy} onClick={() => void ops.applyStash(path, entry.sha, true)}>
            {t("stashes.popShort")}
          </button>
          <button className="btn sm" disabled={running} title={busy} onClick={() => void ops.applyStash(path, entry.sha, false)}>
            {t("stashes.applyShort")}
          </button>
          <button className="btn sm danger-text" disabled={running} title={busy} onClick={() => void ops.dropStash(path, entry.sha, text)}>
            {t("stashes.drop")}
          </button>
        </div>
      </div>

      <div className="section-h">
        <span className="section-h-label">{t("details.files", { count: files.length })}</span>
        <ChangeCounts files={files} />
        {files.length > 0 && <FileViewToggle />}
      </div>
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!changes && !error && <p className="details-note muted">{t("prv.loading")}</p>}
      {changes && files.length === 0 && <p className="details-note muted">{t("stashes.noFiles")}</p>}
      {changes && files.length > 0 && (
        <FileList
          files={files}
          view={fileView}
          label={t("details.files", { count: files.length })}
          isActive={isOpen}
          onOpen={open}
          onContextMenu={(e, f) =>
            openContextMenu(
              e,
              fileMenu(t, path, f.path, {
                change: f,
                load: () => (f.untracked ? api.rangeDiff(path, EMPTY_TREE, changes.untracked!, f.path, f.oldPath) : api.rangeDiff(path, changes.base, changes.tip, f.path, f.oldPath)),
              }),
            )
          }
          actions={(f) => (f.untracked ? <span className="side-meta">{t("stashes.untracked")}</span> : null)}
        />
      )}
    </>
  );
}
