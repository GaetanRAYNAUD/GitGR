// « Ce qui part au push / arrive au pull » : les commits entre HEAD et sa branche suivie, et
// leurs fichiers cumulés avec le diff de chacun, avant de pousser ou de tirer. Ouverte à la
// place du graphe par les badges ↑ / ↓ de la barre d'outils. Pour ↓, d'après la branche
// suivie telle qu'au dernier fetch (bouton Fetch pour la relire).

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import type { FileChange, FileDiff, RangeChanges, RangeDirection } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useRangeView } from "../../store/range";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { DiffBody, DiffViewToggle, useEscape } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { ChangeCounts, FileList, FileViewToggle, StatusBadge } from "./FileList";
import { fileMenu } from "./menus";

export function RangeView({ path, direction }: { path: string; direction: RangeDirection }) {
  const { t } = useTranslation();
  const close = useRangeView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
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

  // Relu quand HEAD, la branche suivie ou l'écart changent (après un push, un pull, un fetch).
  const stamp = `${summary?.head}|${summary?.upstream}|${summary?.ahead}|${summary?.behind}`;
  useEffect(() => {
    let live = true;
    setError(null);
    api.rangeChanges(path, direction).then(
      (r) => {
        if (!live) return;
        setData(r);
        // Le fichier choisi reste ouvert s'il fait encore partie de la plage.
        setFile((f) => (f && r.files.some((x) => x.path === f.path) ? f : null));
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, direction, stamp]);

  useEffect(() => {
    if (!file || !data) return;
    let live = true;
    setDiff(null);
    api.rangeDiff(path, data.base, data.tip, file.path, file.oldPath, { ignoreWs, full }).then(
      (d) => live && setDiff({ data: d, error: null }),
      (e) => live && setDiff({ data: null, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, data, file, ignoreWs, full]);

  const ops = useOps.getState();
  const upstream = summary?.upstream ?? "";
  const count = data?.commits.length ?? 0;
  const title = data ? t(`range.${direction}Title`, { count, upstream }) : error ? errorMessage(t, error) : t("prv.loading");
  const ago = (seconds: number) => {
    const rt = relativeTime(seconds * 1000);
    return t(`time.${rt.key}`, { count: rt.count });
  };

  return (
    <section className="pull-view range-view" aria-label={t(`range.${direction}Label`)}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name={direction} size={15} />
        <span className="pull-view-title">{title}</span>
        {direction === "pull" && (
          <button className="mini" disabled={!!running} onClick={() => void ops.fetch(path)} title={t("range.fetchHint")}>
            {t("repo.fetch")}
          </button>
        )}
        <button className="mini primary" disabled={!!running || count === 0} onClick={() => void (direction === "push" ? ops.push(path) : ops.pull(path))}>
          {t(`repo.${direction}`)}
        </button>
      </header>
      {data && count === 0 ? (
        <p className="muted pull-pad">{t(`range.${direction}Empty`, { upstream })}</p>
      ) : data ? (
        <div className="pull-files">
          <div className="pull-file-list">
            <div className="section-h">
              <span>{t("range.commits", { count })}</span>
            </div>
            <ul className="range-commits" aria-label={t("range.commits", { count })}>
              {data.commits.map((c) => (
                <li key={c.sha}>
                  <button className="range-commit" title={t("range.showInGraph")} onClick={() => void reveal(path, c.sha).then((ok) => ok && back())}>
                    <span className="range-subject">{c.subject}</span>
                    <span className="range-meta muted">
                      <span className="mono">{c.sha.slice(0, 7)}</span> · {c.author} · {ago(c.time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="section-h">
              <span>{t("details.files", { count: data.files.length })}</span>
              <ChangeCounts files={data.files} />
              {data.files.length > 0 && <FileViewToggle />}
            </div>
            <FileList
              files={data.files}
              view={fileView}
              label={t("details.files", { count: data.files.length })}
              isActive={(f) => file?.path === f.path}
              onOpen={setFile}
              onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
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
                    blame={file.status === "D" ? undefined : { path, file: file.path, rev: data.tip }}
                  />
                </div>
              </>
            ) : (
              <p className="muted pull-pad">{t("prv.pickFile")}</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
