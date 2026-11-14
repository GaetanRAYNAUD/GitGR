// Panneau de droite quand la ligne « modifications en cours » est sélectionnée :
// fichiers non indexés / indexés / en conflit, et zone de commit.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import type { StatusFile } from "../../lib/types";
import { useApp } from "../../store/app";
import { areaOf, changedCount, useWork } from "../../store/worktree";
import { ConfirmDialog, type ConfirmRequest } from "../ConfirmDialog";
import { Icon } from "../Icon";
import { CommitBox } from "./CommitBox";
import { FileList, FileViewToggle } from "./FileList";

type ListKind = "conflicted" | "unstaged" | "staged";

export function StagingPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const work = useWork((s) => s.repos[path]);
  const w = useWork.getState();
  const branch = useApp((s) => s.summaries[path]?.data?.branch);
  const view = useApp((s) => s.settings.fileView ?? "list");
  const [closed, setClosed] = useState<Set<ListKind>>(() => new Set());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const st = work?.status;
  const total = changedCount(st);
  const busy = !!work?.busy;
  const diff = work?.diff;

  const askDiscard = (files: StatusFile[]) =>
    setConfirm({
      title: t("staging.discardTitle", { count: files.length }),
      body:
        files.length === 1
          ? t(files[0].status === "?" ? "staging.discardUntracked" : "staging.discardFile", { file: files[0].path })
          : t("staging.discardFiles", { count: files.length }),
      actions: [{ label: t("staging.discard"), danger: true, onClick: () => w.discard(path, files) }],
    });

  const askDiscardAll = () =>
    setConfirm({
      title: t("staging.discardAllTitle"),
      body: t("staging.discardAllBody", { count: total }),
      actions: [
        { label: t("staging.stashInstead"), onClick: () => w.stashAll(path, t("staging.stashMessage", { branch: branch ?? "HEAD" })) },
        { label: t("staging.discardAll"), danger: true, onClick: () => w.discardAll(path) },
      ],
    });

  const section = (kind: ListKind, files: StatusFile[]) => {
    if (kind === "conflicted" && files.length === 0) return null;
    const open = !closed.has(kind);
    const toggle = () =>
      setClosed((prev) => {
        const next = new Set(prev);
        if (!next.delete(kind)) next.add(kind);
        return next;
      });
    const bulk =
      kind === "unstaged" ? (
        <button className="mini" disabled={busy || files.length === 0} onClick={() => w.stageAll(path)}>
          {t("staging.stageAll")}
        </button>
      ) : kind === "staged" ? (
        <button className="mini" disabled={busy || files.length === 0} onClick={() => w.unstageAll(path)}>
          {t("staging.unstageAll")}
        </button>
      ) : null;

    return (
      <div className="stage-section" key={kind}>
        <div className="section-h stage-h">
          <button className="stage-toggle" aria-expanded={open} onClick={toggle}>
            <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
            <span>{t(`staging.${kind}`)}</span>
            <span className="section-count">{files.length}</span>
          </button>
          {bulk}
        </div>
        {open &&
          (files.length === 0 ? (
            <p className="details-note muted">{t(`staging.${kind}Empty`)}</p>
          ) : (
            <FileList
              files={files}
              view={view}
              label={t(`staging.${kind}`)}
              isActive={(f) => diff?.file.path === f.path && diff.area === areaOf(f, kind)}
              onOpen={(f) => w.openDiff(path, f, areaOf(f, kind))}
              onDoubleClick={(f) => (kind === "staged" ? w.unstage(path, [f]) : w.stage(path, [f]))}
              actions={(f) =>
                kind === "staged" ? (
                  <button className="mini" disabled={busy} onClick={() => w.unstage(path, [f])}>
                    {t("staging.unstage")}
                  </button>
                ) : kind === "conflicted" ? (
                  <button className="mini" disabled={busy} onClick={() => w.stage(path, [f])} title={t("staging.resolvedHint")}>
                    {t("staging.resolved")}
                  </button>
                ) : (
                  <>
                    <button
                      className="mini icon danger-text"
                      disabled={busy}
                      onClick={() => askDiscard([f])}
                      aria-label={t("staging.discardOne", { file: f.path })}
                      title={t("staging.discard")}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                    <button className="mini" disabled={busy} onClick={() => w.stage(path, [f])}>
                      {t("staging.stage")}
                    </button>
                  </>
                )
              }
            />
          ))}
      </div>
    );
  };

  return (
    <aside className="commit-panel staging" aria-label={t("staging.label")}>
      <div className="staging-head">
        <div className="staging-title">
          <h2 className="details-subject">{t("staging.title")}</h2>
          <div className="staging-sub">
            {branch ? t("staging.onBranch", { branch, count: total }) : t("staging.files", { count: total })}
          </div>
        </div>
        <FileViewToggle />
        <button
          className="icon-btn bordered danger-text"
          disabled={busy || total === 0}
          onClick={askDiscardAll}
          aria-label={t("staging.discardAll")}
          title={t("staging.discardAllHint")}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      <div className="staging-lists">
        {work?.error ? (
          <p className="details-note muted" role="alert">
            {errorMessage(t, work.error)}
          </p>
        ) : !st ? (
          <p className="panel-empty muted">{t("details.loading")}</p>
        ) : total === 0 ? (
          <p className="panel-empty muted">{t("staging.clean")}</p>
        ) : (
          <>
            {section("conflicted", st.conflicted)}
            {section("unstaged", st.unstaged)}
            {section("staged", st.staged)}
          </>
        )}
      </div>

      <CommitBox path={path} />
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </aside>
  );
}
