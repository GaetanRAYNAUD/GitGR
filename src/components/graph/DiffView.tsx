// Diff d'un fichier d'un commit, affiché à la place du graphe (Échap ou « Retour » pour revenir).

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useGraph, type OpenDiff } from "../../store/graph";
import { Icon } from "../Icon";
import { DiffBody, DiffViewToggle, useEscape } from "./DiffBody";
import { StatusBadge } from "./FileList";
import { fileMenu } from "./menus";
import { openContextMenu } from "../ContextMenu";
import { DiffStats } from "./DiffStats";

export function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="icon-btn bordered" onClick={onClick} aria-label={t("diff.back")} title={`${t("diff.back")} (Esc)`}>
      <Icon name="back" size={16} />
    </button>
  );
}

export function DiffView({ path, diff }: { path: string; diff: OpenDiff }) {
  const { t } = useTranslation();
  const closeDiff = useGraph((s) => s.closeDiff);
  const close = useCallback(() => closeDiff(path), [closeDiff, path]);
  useEscape(close);
  const { file } = diff;

  return (
    <section className="diff-view" aria-label={t("diff.label", { file: file.path })}>
      <header className="diff-head">
        <BackButton onClick={close} />
        <StatusBadge status={file.status} />
        <span className="diff-path mono" onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file.path))}>
          {file.oldPath && <span className="muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        {diff.data && <DiffStats diff={diff.data} />}
        <span className="mono muted diff-sha" title={diff.base ? t("multi.diffRange") : undefined}>
          {diff.base ? `${diff.base.slice(0, 7)}..${diff.sha.slice(0, 7)}` : diff.sha.slice(0, 7)}
        </span>
        <DiffViewToggle />
      </header>
      <div className="diff-body">
        <DiffBody data={diff.data} error={diff.error} />
      </div>
    </section>
  );
}
