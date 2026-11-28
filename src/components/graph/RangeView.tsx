// « Ce qui part au push / arrive au pull » : les commits entre HEAD et sa branche suivie, et
// leurs fichiers cumulés avec le diff de chacun, avant de pousser ou de tirer. Ouverte à la
// place du graphe par les badges ↑ / ↓ de la barre d'outils. Pour ↓, d'après la branche
// suivie telle qu'au dernier fetch (bouton Fetch pour la relire).
//
// Commits : liste à une tabulation, « Toute la plage » en tête. Choisir un commit (clic, ↑ / ↓)
// centre la vue sur lui : son message, ses fichiers et leur diff à la place des changements
// cumulés. Maj+Entrée ou double-clic = le montrer dans le graphe, Maj+F10 = actions. Le
// premier fichier s'ouvre d'office.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { CommitDetails, FileChange, FileDiff, RangeChanges, RangeDirection } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useRangeView } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { DiffBody, DiffViewToggle, useEscape, useReturnFocus } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { ChangeCounts, FileList, FileViewToggle, StatusBadge } from "./FileList";
import { commitMenu, fileMenu } from "./menus";
import { listKeys, RetryNotice, samePath, scrollRow, useCommitWhen } from "./viewKit";

export function RangeView({ path, direction }: { path: string; direction: RangeDirection }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useRangeView((s) => s.close);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const [reload, setReload] = useState(0);
  const [diffReload, setDiffReload] = useState(0);
  const { when, full: fullDate } = useCommitWhen();
  const summary = useApp((s) => s.summaries[path]?.data);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const running = useOps((s) => s.running[path]);
  const reveal = useGraph((s) => s.reveal);
  const [data, setData] = useState<RangeChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState<{ data: FileDiff | null; error: string | null } | null>(null);
  /** Commit sur lequel la vue est centrée (`null` : toute la plage). */
  const [focus, setFocus] = useState<string | null>(null);
  const [details, setDetails] = useState<{ sha: string; data?: CommitDetails; error?: string } | null>(null);
  const [detailsReload, setDetailsReload] = useState(0);

  // Relu quand HEAD, la branche suivie ou l'écart changent (après un push, un pull, un fetch).
  const stamp = `${summary?.head}|${summary?.upstream}|${summary?.ahead}|${summary?.behind}`;
  // Une relecture qui échoue garde ce qui est affiché (erreur en bandeau, « Réessayer »).
  useEffect(() => {
    let live = true;
    api.rangeChanges(path, direction).then(
      (r) => {
        if (!live) return;
        setData(r);
        setError(null);
        // Commit centré sorti de la plage (après un push, un pull) : retour à toute la plage.
        setFocus((s) => (s && r.commits.some((c) => c.sha === s) ? s : null));
        // Le fichier choisi reste ouvert s'il fait encore partie de la plage ; sinon le premier.
        setFile((f) => samePath(f, r.files));
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, direction, stamp, reload]);

  // Focus sur les commits dès qu'ils sont là.
  const focused = useRef(false);
  useEffect(() => {
    if (data?.commits.length && !focused.current) {
      focused.current = true;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [data]);

  // Commit centré : ses détails (message, fichiers) ; son premier fichier s'ouvre.
  useEffect(() => {
    if (!focus) return;
    let live = true;
    api.commitDetails(path, focus).then(
      (d) => {
        if (!live) return;
        setDetails({ sha: focus, data: d });
        setFile((f) => samePath(f, d.files));
      },
      (e) => live && setDetails({ sha: focus, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, focus, detailsReload]);

  const shown = focus && details?.sha === focus ? details : null;
  const files = focus ? (shown?.data?.files ?? null) : (data?.files ?? null);
  // Le diff suit le fichier et la portée : le commit centré, ou toute la plage.
  useEffect(() => {
    if (!file || !data || !files?.some((f) => f.path === file.path)) return;
    let live = true;
    setDiff(null);
    const opts = { ignoreWs, full };
    (focus ? api.commitDiff(path, focus, file.path, file.oldPath, opts) : api.rangeDiff(path, data.base, data.tip, file.path, file.oldPath, opts)).then(
      (d) => live && setDiff({ data: d, error: null }),
      (e) => live && setDiff({ data: null, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, data, files, focus, file, ignoreWs, full, diffReload]);

  const ops = useOps.getState();
  const upstream = summary?.upstream ?? "";
  const count = data?.commits.length ?? 0;
  const title = data ? t(`range.${direction}Title`, { count, upstream }) : t(`range.${direction}Label`);
  const commits = data?.commits ?? [];
  // Ligne 0 : toute la plage ; ligne i + 1 : le commit i.
  const at = focus ? Math.max(0, commits.findIndex((c) => c.sha === focus)) + 1 : 0;
  const rowId = (i: number) => (i === 0 ? "rg-all" : `rg-${commits[i - 1]?.sha}`);
  const showInGraph = (sha: string) => void reveal(path, sha).then((ok) => ok && close(path));
  const choose = (i: number) => {
    if (i > commits.length) return;
    setFocus(i === 0 ? null : commits[i - 1].sha);
    if (i === 0 && data) setFile((f) => samePath(f, data.files));
    scrollRow(rowId(i));
  };
  const items = (sha: string): MenuItem[] => [{ label: t("reflog.showInGraph"), onClick: () => showInGraph(sha) }, "sep", ...commitMenu(t, path, sha, refs)];
  const onKeyDown = listKeys(commits.length + 1, at, {
    go: choose,
    enter: (shift) => (shift && at > 0 ? showInGraph(commits[at - 1].sha) : choose(at)),
    menu: () => {
      if (at === 0) return;
      const box = document.getElementById(rowId(at))?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(commits[at - 1].sha));
    },
  });
  const centred = focus ? commits.find((c) => c.sha === focus) : undefined;
  const filesLabel = centred ? t("range.commitFiles", { count: files?.length ?? 0, sha: centred.sha.slice(0, 7) }) : t("details.files", { count: files?.length ?? 0 });

  return (
    <section ref={sectionRef} className="pull-view range-view" aria-label={t(`range.${direction}Label`)}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name={direction} size={15} />
        <span className="pull-view-title">{title}</span>
        {direction === "pull" && (
          <button className="btn sm" disabled={!!running} onClick={() => void ops.fetch(path)} title={t("range.fetchHint")}>
            {t("repo.fetch")}
          </button>
        )}
        <button className="btn sm primary" disabled={!!running || count === 0} onClick={() => void (direction === "push" ? ops.push(path) : ops.pull(path))}>
          {t(`repo.${direction}`)}
        </button>
      </header>
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {!data && !error && <p className="muted pull-pad">{t("prv.loading")}</p>}
      {data && count === 0 ? (
        <p className="muted pull-pad">{t(`range.${direction}Empty`, { upstream })}</p>
      ) : data ? (
        <div className="pull-files range-files">
          <div className="pull-file-list">
            <div className="section-h">
              <span>{t("range.commits", { count })}</span>
            </div>
            <ul
              ref={listRef}
              className="range-commits"
              role="listbox"
              tabIndex={0}
              aria-label={t("range.commits", { count })}
              aria-description={t("range.keys")}
              title={t("range.keys")}
              aria-activedescendant={rowId(at)}
              onKeyDown={onKeyDown}
            >
              <li
                id="rg-all"
                role="option"
                aria-selected={!focus}
                className={["range-commit range-all", !focus && "on active"].filter(Boolean).join(" ")}
                onClick={() => choose(0)}
              >
                <span className="range-subject">{t("range.all")}</span>
                <span className="range-meta muted">
                  <span>{t("range.allHint", { count })}</span>
                </span>
              </li>
              {data.commits.map((c, i) => (
                <li
                  key={c.sha}
                  id={`rg-${c.sha}`}
                  role="option"
                  aria-selected={focus === c.sha}
                  aria-label={c.subject}
                  aria-description={[c.author, when(c.time), c.sha.slice(0, 7)].join(", ")}
                  className={["range-commit", focus === c.sha && "on active"].filter(Boolean).join(" ")}
                  onClick={() => choose(i + 1)}
                  onDoubleClick={() => showInGraph(c.sha)}
                  onContextMenu={(ev) => {
                    choose(i + 1);
                    openContextMenu(ev, items(c.sha));
                  }}
                >
                  <span className="range-subject">{c.subject}</span>
                  <span className="range-meta muted">
                    <span className="mono">{c.sha.slice(0, 7)}</span>
                    <span>{c.author}</span>
                    <span title={fullDate(c.time)}>{when(c.time)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {/* Commit centré : son message complet, au-dessus de ses fichiers. */}
            {shown?.data?.body && <p className="range-body">{shown.data.body}</p>}
            <div className="section-h">
              <span>{filesLabel}</span>
              {files && <ChangeCounts files={files} />}
              {!!files?.length && <FileViewToggle />}
            </div>
            {shown?.error ? (
              <RetryNotice error={shown.error} onRetry={() => setDetailsReload((n) => n + 1)} />
            ) : !files ? (
              <p className="muted pull-pad">{t("prv.loading")}</p>
            ) : (
              <FileList
                files={files}
                view={fileView}
                label={filesLabel}
                isActive={(f) => file?.path === f.path}
                onOpen={setFile}
                onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
              />
            )}
          </div>
          <div className="pull-file-diff">
            {file && files?.some((f) => f.path === file.path) ? (
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
                    copyAs={file}
                    blame={file.status === "D" ? undefined : { path, file: file.path, rev: focus ?? data.tip }}
                  />
                </div>
              </>
            ) : !files ? (
              <p className="muted pull-pad">{t("prv.loading")}</p>
            ) : files.length === 0 ? (
              <p className="muted pull-pad">{t("range.noFiles")}</p>
            ) : (
              <p className="muted pull-pad">{t("prv.pickFile")}</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
