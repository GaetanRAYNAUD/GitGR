// Contenu d'un stash, ouvert à la place du graphe depuis la section « Stashes » : ses fichiers
// (suivis, puis non suivis mis de côté avec lui) et le diff de chacun, avec de quoi
// l'appliquer, le pop ou le supprimer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { EMPTY_TREE, stashLabel } from "../../lib/stashes";
import type { FileChange, FileDiff, StashChanges, StashEntry } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useStashView } from "../../store/range";
import { useStashList } from "../../store/stashes";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { commitSides } from "./BinaryPreview";
import { DiffBody, DiffViewToggle, useEscape, useReturnFocus } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { ChangeCounts, FileList, FileViewToggle, StatusBadge } from "./FileList";
import { fileMenu } from "./menus";
import { RetryNotice, useCommitWhen } from "./viewKit";

type StashFile = FileChange & { untracked?: boolean };

export function StashView({ path, entry }: { path: string; entry: StashEntry }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useStashView((s) => s.close);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const [reload, setReload] = useState(0);
  const [diffReload, setDiffReload] = useState(0);
  const { when, full: fullDate } = useCommitWhen();
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
      (c) => {
        if (!live) return;
        setData(c);
        setError(null);
        // Le premier fichier s'ouvre d'office.
        setFile((f) => f ?? c.files[0] ?? (c.untrackedFiles[0] ? { ...c.untrackedFiles[0], untracked: true } : null));
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, entry.sha, reload]);

  // Focus sur la liste des fichiers dès qu'elle est là.
  const focused = useRef(false);
  useEffect(() => {
    if (data && !focused.current) {
      focused.current = true;
      sectionRef.current?.querySelector<HTMLElement>('.pull-file-list [tabindex="0"]')?.focus({ preventScroll: true });
    }
  }, [data]);

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
  }, [path, data, file, ignoreWs, full, diffReload]);

  const ops = useOps.getState();
  const { text, branch } = stashLabel(entry.message);
  const untrackedCount = data?.untrackedFiles.length ?? 0;
  // Appliqué et retiré, ou supprimé : la vue n'a plus d'objet.
  const after = (drop: boolean) => (ok: boolean) => ok && drop && back();

  return (
    <section ref={sectionRef} className="pull-view stash-view" aria-label={t("stashes.viewLabel", { name: text })}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="stash" size={15} />
        <span className="pull-view-title" title={entry.message}>
          {text}
        </span>
        <button className="btn sm" disabled={!!running} onClick={() => void ops.applyStash(path, entry.sha, false)}>
          {t("stashes.applyShort")}
        </button>
        <button className="btn sm primary" disabled={!!running} onClick={() => void ops.applyStash(path, entry.sha, true).then(after(true))}>
          {t("stashes.popShort")}
        </button>
        <button className="btn sm danger-text" disabled={!!running} onClick={() => void ops.dropStash(path, entry.sha, text).then(after(true))}>
          {t("stashes.drop")}
        </button>
      </header>
      {/* D'où vient le stash : sa branche, sa date, le commit de départ (cliquable). */}
      <div className="pull-view-meta stash-meta">
        {branch && <span>{t("stashes.onBranch", { branch })}</span>}
        <span title={fullDate(entry.time)}>{when(entry.time)}</span>
        <button
          className="link mono"
          title={t("stashes.showBase")}
          onClick={() => void useGraph.getState().reveal(path, entry.base).then((ok) => ok && close(path))}
        >
          {entry.base.slice(0, 7)}
        </button>
        {untrackedCount > 0 && <span>{t("stashes.untrackedCount", { count: untrackedCount })}</span>}
      </div>
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!data && !error && <p className="muted pull-pad">{t("prv.loading")}</p>}
      {data && files.length === 0 && <p className="muted pull-pad">{t("stashes.noFiles")}</p>}
      {data && files.length > 0 && (
        <div className="pull-files range-files">
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
                    onRetry={() => setDiffReload((n) => n + 1)}
                    resetKey={file.path}
                    binarySides={file.untracked ? { path, old: null, new: { rev: data.untracked!, file: file.path } } : commitSides(path, file, data.tip, data.base)}
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
