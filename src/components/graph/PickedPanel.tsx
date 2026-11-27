// Panneau de droite quand plusieurs commits sont sélectionnés (Ctrl+clic, Maj+clic) : la
// liste des commits choisis, puis les fichiers modifiés cumulés et leur diff quand la
// sélection s'y prête (plage contiguë, ou deux commits), avec le cherry-pick du lot.
// Commits : liste à une tabulation (↑ / ↓, Entrée = ne garder que ce commit, Maj+F10 = les
// actions du lot).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { LAYOUT, useWidthStyle } from "../../lib/layout";
import { compareOf, orderPicked, squashable } from "../../lib/multiSelect";
import type { FileChange } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { openContextMenu, useContextMenu } from "../ContextMenu";
import { ResizableBlock } from "../Splitter";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";
import { fileMenu, pickedMenu } from "./menus";
import { listKeys, RetryNotice, useCommitWhen } from "./viewKit";

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
  const [reload, setReload] = useState(0);
  /** Ligne active de la liste au clavier. */
  const [row, setRow] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { when, full: fullDate } = useCommitWhen();

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
  }, [path, base, tip, reload]);

  const merges = ordered.some((c) => c.parents.length > 1);
  const branch = refs?.headBranch ?? "HEAD";
  const at = Math.min(row, Math.max(0, ordered.length - 1));
  const onKeyDown = listKeys(ordered.length, at, {
    go: (i) => {
      setRow(i);
      document.getElementById(`pk-${ordered[i].sha}`)?.scrollIntoView({ block: "nearest" });
    },
    enter: () => useGraph.getState().select(path, ordered[at].sha),
    menu: () => {
      const box = document.getElementById(`pk-${ordered[at].sha}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, pickedMenu(t, path, ordered, refs));
    },
  });
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
              title={t("multi.cherryPickHint", { branch })}
              aria-describedby={merges ? "multi-merge-note" : undefined}
              onClick={() => void useOps.getState().cherryPick(path, ordered.map((c) => c.sha).reverse())}
            >
              {t("multi.cherryPickShort", { count: ordered.length })}
            </button>
            {squashable(ordered) && (
              <button className="btn" disabled={running || !refs?.head} title={t("multi.squashHint")} onClick={() => void useOps.getState().squash(path, ordered)}>
                {t("multi.squashShort", { count: ordered.length })}
              </button>
            )}
          </div>
          {/* La raison d'un bouton grisé, lisible au clavier et par les lecteurs d'écran. */}
          {merges ? (
            <p id="multi-merge-note" className="muted multi-hint">
              {t("multi.cherryPickMerge")}
            </p>
          ) : (
            <p className="muted multi-hint">{t("multi.cherryPickOn", { branch })}</p>
          )}
        </div>
        <ul
          ref={listRef}
          className="range-commits"
          role="listbox"
          tabIndex={0}
          aria-label={t("multi.commits")}
          aria-description={t("multi.keys")}
          aria-activedescendant={ordered[at] ? `pk-${ordered[at].sha}` : undefined}
          onKeyDown={onKeyDown}
        >
          {ordered.map((c, i) => (
            <li
              key={c.sha}
              id={`pk-${c.sha}`}
              role="option"
              aria-selected={true}
              aria-label={c.subject}
              aria-description={[c.author, when(c.time), c.sha.slice(0, 7)].join(", ")}
              className={["range-commit", i === at && "active"].filter(Boolean).join(" ")}
              title={t("multi.selectOne")}
              onClick={() => useGraph.getState().select(path, c.sha)}
              onContextMenu={(e) => {
                setRow(i);
                openContextMenu(e, pickedMenu(t, path, ordered, refs));
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
      </ResizableBlock>

      {base && tip && (
        <>
          <div className="section-h">
            <span>{t("details.files", { count: list.length })}</span>
            <ChangeCounts files={list} />
            {list.length > 0 && <FileViewToggle />}
          </div>
          {files?.error ? (
            <RetryNotice error={files.error} onRetry={() => setReload((n) => n + 1)} />
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
