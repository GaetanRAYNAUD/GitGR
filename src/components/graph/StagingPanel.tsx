// Panneau de droite quand la ligne « modifications en cours » est sélectionnée :
// fichiers non indexés / indexés / en conflit, et zone de commit.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { ignoreChoices } from "../../lib/gitignore";
import { fileMenu } from "./menus";
import { errorMessage } from "../../lib/errors";
import { LAYOUT, sectionKey, useWidthStyle } from "../../lib/layout";
import type { StatusFile } from "../../lib/types";
import { useApp } from "../../store/app";
import { areaOf, changedCount, useWork } from "../../store/worktree";
import { useDialogs } from "../../store/dialogs";
import { Icon } from "../Icon";
import { ResizableBlock } from "../Splitter";
import { CommitBox } from "./CommitBox";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";

type ListKind = "conflicted" | "unstaged" | "staged";

export function StagingPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const work = useWork((s) => s.repos[path]);
  const w = useWork.getState();
  const branch = useApp((s) => s.summaries[path]?.data?.branch);
  const view = useApp((s) => s.settings.fileView ?? "list");
  const [closed, setClosed] = useState<Set<ListKind>>(() => new Set());
  const widthStyle = useWidthStyle(LAYOUT.panel);

  const st = work?.status;
  const total = changedCount(st);
  const busy = !!work?.busy;
  const diff = work?.diff;

  const askDiscard = async (files: StatusFile[]) => {
    const ok = await useDialogs.getState().choose({
      title: t("staging.discardTitle", { count: files.length }),
      body:
        files.length === 1
          ? t(files[0].status === "?" ? "staging.discardUntracked" : "staging.discardFile", { file: files[0].path })
          : t("staging.discardFiles", { count: files.length }),
      choices: [{ id: "discard", label: t("staging.discard"), danger: true }],
    });
    if (ok) w.discard(path, files);
  };

  /** Clic droit sur un fichier : ses actions dans cette liste, avant celles de tout fichier. */
  const stagingItems = (kind: ListKind, f: StatusFile): MenuItem[] => {
    if (kind === "staged") return [{ label: t("staging.unstage"), disabled: busy, onClick: () => w.unstage(path, [f]) }];
    if (kind === "conflicted") return [{ label: t("staging.resolved"), disabled: busy, onClick: () => w.stage(path, [f]) }];
    const items: MenuItem[] = [
      { label: t("staging.stage"), disabled: busy, onClick: () => w.stage(path, [f]) },
      { label: t("staging.discard"), danger: true, disabled: busy, onClick: () => void askDiscard([f]) },
    ];
    if (f.status === "?") {
      items.push("sep", ...ignoreChoices(f.path).map((c): MenuItem => ({ label: t(`staging.ignore.${c.kind}`, { name: c.label }), disabled: busy, onClick: () => w.ignore(path, c.pattern) })));
    } else if (f.status !== "D") {
      const [own] = ignoreChoices(f.path);
      items.push("sep", { label: t("staging.ignore.untrack", { name: own.label }), title: t("staging.ignore.untrackHint"), disabled: busy, onClick: () => w.untrack(path, f.path, own.pattern) });
    }
    return items;
  };

  const askDiscardAll = async () => {
    const pick = await useDialogs.getState().choose({
      title: t("staging.discardAllTitle"),
      body: t("staging.discardAllBody", { count: total }),
      choices: [
        { id: "stash", label: t("staging.stashInstead") },
        { id: "discard", label: t("staging.discardAll"), danger: true },
      ],
    });
    if (pick === "stash") w.stashAll(path, t("staging.stashMessage", { branch: branch ?? "HEAD" }));
    else if (pick === "discard") w.discardAll(path);
  };

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
            <ChangeCounts files={files} />
          </button>
          {bulk}
        </div>
        {open &&
          (files.length === 0 ? (
            <p className="details-note muted">{t(`staging.${kind}Empty`)}</p>
          ) : (
            <ResizableBlock
              layoutKey={sectionKey(`stage:${kind}`)}
              label={t("layout.section", { name: t(`staging.${kind}`) })}
              className="stage-content"
            >
            <FileList
              files={files}
              view={view}
              label={t(`staging.${kind}`)}
              isActive={(f) => diff?.file.path === f.path && diff.area === areaOf(f, kind)}
              onOpen={(f) => w.openDiff(path, f, areaOf(f, kind))}
              onDoubleClick={(f) => (kind === "staged" ? w.unstage(path, [f]) : w.stage(path, [f]))}
              onContextMenu={(e, f) => openContextMenu(e, [...stagingItems(kind, f), "sep", ...fileMenu(t, path, f.path)])}
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
            </ResizableBlock>
          ))}
      </div>
    );
  };

  return (
    <aside className="commit-panel staging" aria-label={t("staging.label")} style={widthStyle}>
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
    </aside>
  );
}
