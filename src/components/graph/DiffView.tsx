// Diff d'un fichier d'un commit, affiché à la place du graphe (Échap ou « Retour » pour revenir).

import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "../../store/app";
import { useGraph, type OpenDiff } from "../../store/graph";
import { Icon } from "../Icon";
import { CopyDiffButton, DiffBody, DiffViewToggle, useEscape, useReturnFocus } from "./DiffBody";
import { commitSides } from "./BinaryPreview";
import { StatusBadge } from "./FileList";
import { fileMenu } from "./menus";
import { openContextMenu } from "../ContextMenu";
import { DiffStats } from "./DiffStats";

export function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="icon-btn bordered" onClick={onClick} aria-label={t("diff.back")} title={`${t("diff.back")} (${t("keys.escape")})`}>
      <Icon name="back" size={16} />
    </button>
  );
}

/** Chemin du fichier en tête du diff ; un renommage raccourcit d'abord l'ancien nom. */
export function DiffPath({ file, onContextMenu }: { file: { path: string; oldPath?: string | null }; onContextMenu: (e: React.MouseEvent) => void }) {
  const full = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <span className="diff-path mono" title={full} onContextMenu={onContextMenu}>
      {file.oldPath && <span className="diff-old muted">{file.oldPath} →</span>}
      <span className="diff-new">{file.path}</span>
    </span>
  );
}

export function DiffView({ path, diff }: { path: string; diff: OpenDiff }) {
  const { t } = useTranslation();
  const closeDiff = useGraph((s) => s.closeDiff);
  const sectionRef = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useCallback(() => {
    returnFocus();
    closeDiff(path);
  }, [closeDiff, path, returnFocus]);
  useEscape(close);
  const { file } = diff;
  const reopen = () => {
    const d = useGraph.getState().diffs[path];
    if (d) void useGraph.getState().openDiff(path, d.sha, d.file, d.base);
  };

  // « Ignorer les espaces » ou « Fichier entier » changé : le diff est relu.
  const opts = useApp((s) => `${!!s.settings.diffIgnoreWs}|${!!s.settings.diffFull}`);
  const shownOpts = useRef(opts);
  useEffect(() => {
    if (shownOpts.current === opts) return;
    shownOpts.current = opts;
    reopen();
  });

  return (
    <section className="diff-view" ref={sectionRef} aria-label={t("diff.label", { file: file.path })}>
      <header className="diff-head">
        <BackButton onClick={close} />
        <StatusBadge status={file.status} />
        <DiffPath file={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file.path, { rev: diff.sha, deleted: file.status === "D", change: diff.base ? undefined : file }))} />
        {diff.data && <DiffStats diff={diff.data} />}
        <span className="mono muted diff-sha" title={diff.base ? t("multi.diffRange") : undefined}>
          {diff.base ? `${diff.base.slice(0, 7)}..${diff.sha.slice(0, 7)}` : diff.sha.slice(0, 7)}
        </span>
        <CopyDiffButton file={file} data={diff.data} />
        <DiffViewToggle />
      </header>
      <div className="diff-body">
        <DiffBody
          data={diff.data}
          error={diff.error}
          onRetry={reopen}
          resetKey={`${diff.sha}\n${file.path}`}
          copyAs={file}
          binarySides={commitSides(path, file, diff.sha, diff.base)}
          blame={file.status === "D" ? undefined : { path, file: file.path, rev: diff.sha, beforeReveal: () => closeDiff(path) }}
        />
      </div>
    </section>
  );
}
