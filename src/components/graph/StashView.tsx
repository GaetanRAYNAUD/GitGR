// Contenu d'un stash, ouvert à la place du graphe depuis la section « Stashes » : ses fichiers
// (suivis, puis non suivis mis de côté avec lui) et le diff de chacun, avec de quoi
// l'appliquer, le pop ou le supprimer.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { EMPTY_TREE, stashLabel } from "../../lib/stashes";
import type { FileChange, FileDiff, StashChanges, StashEntry } from "../../lib/types";
import { useApp } from "../../store/app";
import { useOps } from "../../store/ops";
import { useStashView } from "../../store/range";
import { useStashList } from "../../store/stashes";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { DiffBody, DiffViewToggle, useEscape } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { ChangeCounts, FileList, FileViewToggle, StatusBadge } from "./FileList";
import { fileMenu } from "./menus";

type StashFile = FileChange & { untracked?: boolean };

export function StashView({ path, entry }: { path: string; entry: StashEntry }) {
  const { t } = useTranslation();
  const close = useStashView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const running = useOps((s) => s.running[path]);
  const [data, setData] = useState<StashChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<StashFile | null>(null);
  const [diff, setDiff] = useState<{ data: FileDiff | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    api.stashChanges(path, entry.sha).then(
      (c) => live && setData(c),
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, entry.sha]);

  // La pile a changé (pop, suppression, renommage, d'ici ou d'ailleurs) : la vue suit son stash,
  // et se ferme s'il n'y est plus.
  const { list: stashes, ready } = useStashList(path);
  useEffect(() => {
    if (!ready) return;
    const now = stashes.find((s) => s.sha === entry.sha);
    if (!now) close(path);
    else if (now.message !== entry.message) useStashView.getState().show(path, now);
  }, [path, stashes, ready, entry.sha, entry.message, close]);

  const files = useMemo<StashFile[]>(
    () => (data ? [...data.files, ...data.untrackedFiles.map((f) => ({ ...f, untracked: true }))] : []),
    [data],
  );

  useEffect(() => {
    if (!file || !data) return;
    let live = true;
    setDiff(null);
    const [base, tip] = file.untracked ? [EMPTY_TREE, data.untracked!] : [data.base, data.tip];
    api.rangeDiff(path, base, tip, file.path, file.oldPath, { ignoreWs, full }).then(
      (d) => live && setDiff({ data: d, error: null }),
      (e) => live && setDiff({ data: null, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, data, file, ignoreWs, full]);

  const ops = useOps.getState();
  const { text } = stashLabel(entry.message);
  // Appliqué et retiré, ou supprimé : la vue n'a plus d'objet.
  const after = (drop: boolean) => (ok: boolean) => ok && drop && back();

  return (
    <section className="pull-view stash-view" aria-label={t("stashes.viewLabel", { name: text })}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="stash" size={15} />
        <span className="pull-view-title" title={entry.message}>
          {error ? errorMessage(t, error) : text}
        </span>
        <button className="mini" disabled={!!running} onClick={() => void ops.applyStash(path, entry.sha, false)}>
          {t("stashes.applyShort")}
        </button>
        <button className="mini primary" disabled={!!running} onClick={() => void ops.applyStash(path, entry.sha, true).then(after(true))}>
          {t("stashes.popShort")}
        </button>
        <button className="mini danger-text" disabled={!!running} onClick={() => void ops.dropStash(path, entry.sha, text).then(after(true))}>
          {t("stashes.drop")}
        </button>
      </header>
      {data && (
        <div className="pull-files">
          <div className="pull-file-list">
            <div className="section-h">
              <span>{t("details.files", { count: files.length })}</span>
              <ChangeCounts files={files} />
              {files.length > 0 && <FileViewToggle />}
            </div>
            <FileList
              files={files}
              view={fileView}
              label={t("details.files", { count: files.length })}
              isActive={(f) => file?.path === f.path && !!file.untracked === !!f.untracked}
              onOpen={setFile}
              onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
              actions={(f) => (f.untracked ? <span className="side-meta">{t("stashes.untracked")}</span> : null)}
            />
          </div>
          <div className="pull-file-diff">
            {file ? (
              <>
                <header className="diff-head">
                  <StatusBadge status={file.status} />
                  <DiffPath file={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file.path))} />
                  {diff?.data && <DiffStats diff={diff.data} />}
                  <DiffViewToggle />
                </header>
                <div className="diff-body">
                  <DiffBody
                    data={diff?.data ?? undefined}
                    error={diff?.error ?? undefined}
                    resetKey={file.path}
                    blame={file.status === "D" ? undefined : { path, file: file.path, rev: file.untracked ? data.untracked! : data.tip }}
                  />
                </div>
              </>
            ) : (
              <p className="muted pull-pad">{t("prv.pickFile")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
