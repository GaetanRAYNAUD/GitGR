// Panneau de droite quand plusieurs commits sont sélectionnés (Ctrl+clic, Maj+clic) : la
// liste des commits choisis, puis les fichiers modifiés cumulés et leur diff quand la
// sélection s'y prête (plage contiguë, ou deux commits), avec le cherry-pick du lot.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import { LAYOUT, useWidthStyle } from "../../lib/layout";
import { compareOf, orderPicked } from "../../lib/multiSelect";
import type { FileChange } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { openContextMenu } from "../ContextMenu";
import { ResizableBlock } from "../Splitter";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";
import { fileMenu, pickedMenu } from "./menus";

export function PickedPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const widthStyle = useWidthStyle(LAYOUT.panel);
  const commits = useGraph((s) => s.graphs[path]?.commits);
  const picked = useGraph((s) => s.graphs[path]?.picked);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const diff = useGraph((s) => s.diffs[path]);
  const running = useOps((s) => !!s.running[path]);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const ordered = useMemo(() => orderPicked(commits ?? [], picked ?? []), [commits, picked]);
  const cmp = useMemo(() => compareOf(ordered), [ordered]);
  const [files, setFiles] = useState<{ data?: FileChange[]; error?: string } | null>(null);

  const base = cmp.kind === "sparse" ? null : cmp.base;
  const tip = cmp.kind === "sparse" ? null : cmp.tip;
  useEffect(() => {
    setFiles(null);
    if (!base || !tip) return;
    let live = true;
    api.compareFiles(path, base, tip).then(
      (data) => live && setFiles({ data }),
      (e) => live && setFiles({ error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, base, tip]);

  const merges = ordered.some((c) => c.parents.length > 1);
  const branch = refs?.headBranch ?? "HEAD";
  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
  const list = files?.data ?? [];

  return (
    <aside className="commit-panel picked-panel" aria-label={t("multi.label")} style={widthStyle}>
      <ResizableBlock layoutKey={LAYOUT.details} label={t("layout.details")} className="details-top">
        <div className="details-head">
          <h2 className="details-subject">{t("multi.title", { count: ordered.length })}</h2>
          <p className="muted multi-hint">
            {cmp.kind === "chain" ? t("multi.chain") : cmp.kind === "pair" ? t("multi.pair", { from: cmp.base.slice(0, 7), to: cmp.tip.slice(0, 7) }) : t("multi.sparse")}
          </p>
          <div className="multi-actions">
            <button
              className="btn primary"
              disabled={running || merges || !refs?.head}
              title={merges ? t("multi.cherryPickMerge") : t("multi.cherryPickHint", { branch })}
              onClick={() => void useOps.getState().cherryPick(path, ordered.map((c) => c.sha).reverse())}
            >
              {t("multi.cherryPick", { count: ordered.length, branch })}
            </button>
          </div>
        </div>
        <ul className="range-commits" aria-label={t("multi.commits")}>
          {ordered.map((c) => (
            <li key={c.sha}>
              <button
                className="range-commit"
                title={t("multi.selectOne")}
                onClick={() => useGraph.getState().select(path, c.sha)}
                onContextMenu={(e) => openContextMenu(e, pickedMenu(t, path, ordered, refs))}
              >
                <span className="range-subject">{c.subject}</span>
                <span className="range-meta muted">
                  <span className="mono">{c.sha.slice(0, 7)}</span> · {c.author} · {ago(c.time)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ResizableBlock>

      {base && tip && (
        <>
          <div className="section-h">
            <span>{t("details.files", { count: list.length })}</span>
            <ChangeCounts files={list} />
            {list.length > 0 && <FileViewToggle />}
          </div>
          {files?.error ? (
            <p className="details-note muted" role="alert">
              {errorMessage(t, files.error)}
            </p>
          ) : !files ? (
            <p className="details-note muted">{t("details.loading")}</p>
          ) : list.length === 0 ? (
            <p className="details-note muted">{t("details.noFiles")}</p>
          ) : (
            <FileList
              files={list}
              view={fileView}
              label={t("details.files", { count: list.length })}
              isActive={(f) => diff?.base === base && diff.sha === tip && diff.file.path === f.path}
              onOpen={(f) => void useGraph.getState().openDiff(path, tip, f, base)}
              onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
            />
          )}
        </>
      )}
    </aside>
  );
}
