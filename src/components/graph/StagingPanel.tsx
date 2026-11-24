// Panneau de droite quand la ligne « modifications en cours » est sélectionnée :
// fichiers non indexés / indexés / en conflit, et zone de commit.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { dirIgnore, ignoreChoices } from "../../lib/gitignore";
import { dirMenu, fileMenu, showConflict } from "./menus";
import { errorMessage } from "../../lib/errors";
import { LAYOUT, sectionKey, useWidthStyle } from "../../lib/layout";
import type { StatusFile } from "../../lib/types";
import { useApp } from "../../store/app";
import { areaOf, changedCount, useWork } from "../../store/worktree";
import { useDialogs } from "../../store/dialogs";
import { useConflictView } from "../../store/range";
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
  /** Fichiers sélectionnés (Ctrl+clic, Maj+clic), dans une seule liste à la fois. */
  const [picked, setPicked] = useState<{ kind: ListKind; paths: Set<string> } | null>(null);
  const widthStyle = useWidthStyle(LAYOUT.panel);

  const st = work?.status;
  const total = changedCount(st);
  const busy = !!work?.busy;
  const diff = work?.diff;
  const openConflict = useConflictView((s) => s.open[path]);

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

  /** Stash partiel : les fichiers cochés (ceux de départ d'office), avec un message. Les
   *  fichiers en conflit n'y sont pas (git refuse de les stasher). */
  const askStash = async (start: StatusFile[]) => {
    if (!st) return;
    const files = new Map<string, StatusFile[]>();
    for (const f of [...st.unstaged, ...st.staged]) files.set(f.path, [...(files.get(f.path) ?? []), f]);
    const hint = (list: StatusFile[]) => {
      if (list.some((f) => f.status === "?")) return t("staging.stashPickUntracked");
      const staged = list.filter((f) => st.staged.includes(f)).length;
      return staged === 0 ? undefined : staged === list.length ? t("staging.stashPickStaged") : t("staging.stashPickPartly");
    };
    const answer = await useDialogs.getState().input({
      title: start.length === 1 ? t("staging.stashFileTitle", { file: start[0].path }) : t("staging.stashFilesTitle"),
      label: t("staging.stashFileLabel"),
      initial: t("staging.stashMessage", { branch: branch ?? "HEAD" }),
      submit: t("staging.stashFileSubmit"),
      validate: (v) => (v.trim() ? null : t("staging.stashFileEmpty")),
      picks: {
        label: t("staging.stashPickLabel"),
        items: [...files].map(([p, list]) => ({ id: p, label: p, hint: hint(list) })),
        checked: start.map((f) => f.path),
      },
    });
    if (!answer?.picked?.length) return;
    // Renommage : l'ancien chemin part avec, sinon sa suppression resterait indexée.
    const paths = answer.picked.flatMap((p) => (files.get(p) ?? []).flatMap((f) => (f.oldPath ? [f.oldPath, f.path] : [f.path])));
    await w.stashFiles(path, answer.value.trim(), [...new Set(paths)]);
  };
  const stashItem = (f: StatusFile): MenuItem => ({ label: t("staging.stashFile"), disabled: busy, onClick: () => void askStash([f]) });

  /** Clic droit sur un fichier : ses actions dans cette liste, avant celles de tout fichier. */
  const stagingItems = (kind: ListKind, f: StatusFile): MenuItem[] => {
    if (kind === "staged") return [{ label: t("staging.unstage"), disabled: busy, onClick: () => w.unstage(path, [f]) }, stashItem(f)];
    if (kind === "conflicted")
      return [
        { label: t("conflict.open"), disabled: busy, onClick: () => showConflict(path, f.path) },
        { label: t("conflict.showDiff"), onClick: () => w.openDiff(path, f, "conflicted") },
        { label: t("staging.resolved"), disabled: busy, onClick: () => w.stage(path, [f]) },
      ];
    const items: MenuItem[] = [
      { label: t("staging.stage"), disabled: busy, onClick: () => w.stage(path, [f]) },
      { label: t("staging.discard"), danger: true, disabled: busy, onClick: () => void askDiscard([f]) },
      stashItem(f),
    ];
    if (f.status === "?") {
      items.push("sep", ...ignoreChoices(f.path).map((c): MenuItem => ({ label: t(`staging.ignore.${c.kind}`, { name: c.label }), disabled: busy, onClick: () => w.ignore(path, c.pattern) })));
    } else if (f.status !== "D") {
      const [own] = ignoreChoices(f.path);
      items.push("sep", { label: t("staging.ignore.untrack", { name: own.label }), title: t("staging.ignore.untrackHint"), disabled: busy, onClick: () => w.untrack(path, f.path, own.pattern) });
    }
    return items;
  };

  /** Actions sur plusieurs fichiers d'une liste (sélection, dossier). */
  const bulkItems = (kind: ListKind, files: StatusFile[]): MenuItem[] => {
    const count = files.length;
    if (kind === "conflicted") return [{ label: t("staging.resolvedFiles", { count }), disabled: busy, onClick: () => w.stage(path, files) }];
    const stash: MenuItem = { label: t("staging.stashFiles"), disabled: busy, onClick: () => void askStash(files) };
    if (kind === "staged") return [{ label: t("staging.unstageFiles", { count }), disabled: busy, onClick: () => w.unstage(path, files) }, stash];
    return [
      { label: t("staging.stageFiles", { count }), disabled: busy, onClick: () => w.stage(path, files) },
      { label: t("staging.discardFilesMenu", { count }), danger: true, disabled: busy, onClick: () => void askDiscard(files) },
      stash,
    ];
  };

  /** Clic droit sur un fichier : la sélection entière s'il en fait partie, sinon lui seul. */
  const fileContextMenu = (e: React.MouseEvent, kind: ListKind, files: StatusFile[], f: StatusFile) => {
    const sel = picked?.kind === kind ? files.filter((x) => picked.paths.has(x.path)) : [];
    if (sel.length > 1 && sel.includes(f)) return openContextMenu(e, bulkItems(kind, sel));
    setPicked({ kind, paths: new Set([f.path]) });
    openContextMenu(e, [...stagingItems(kind, f), "sep", ...fileMenu(t, path, f.path)]);
  };

  /** Clic droit sur un dossier (arborescence) : ses fichiers de cette liste. */
  const dirContextMenu = (e: React.MouseEvent, kind: ListKind, dir: string, files: StatusFile[]) => {
    setPicked({ kind, paths: new Set(files.map((f) => f.path)) });
    const items = bulkItems(kind, files);
    if (kind === "unstaged" && files.every((f) => f.status === "?")) {
      const c = dirIgnore(dir);
      items.push("sep", { label: t("staging.ignore.dir", { name: c.label }), disabled: busy, onClick: () => w.ignore(path, c.pattern) });
    }
    openContextMenu(e, [...items, "sep", ...dirMenu(t, path, dir)]);
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
              isActive={(f) => (kind === "conflicted" ? openConflict === f.path : diff?.file.path === f.path && diff.area === areaOf(f, kind))}
              onOpen={(f) => (kind === "conflicted" ? showConflict(path, f.path) : w.openDiff(path, f, areaOf(f, kind)))}
              onDoubleClick={(f) => (kind === "staged" ? w.unstage(path, [f]) : w.stage(path, [f]))}
              onContextMenu={(e, f) => fileContextMenu(e, kind, files, f)}
              onDirContextMenu={(e, dir, inside) => dirContextMenu(e, kind, dir, inside)}
              selected={picked?.kind === kind ? picked.paths : undefined}
              onSelect={(paths) => setPicked({ kind, paths })}
              actions={(f) =>
                kind === "staged" ? (
                  <button className="mini" disabled={busy} onClick={() => w.unstage(path, [f])}>
                    {t("staging.unstage")}
                  </button>
                ) : kind === "conflicted" ? (
                  <>
                    <button className="mini" disabled={busy} onClick={() => showConflict(path, f.path)} title={t("conflict.openHint")}>
                      {t("conflict.open")}
                    </button>
                    <button
                      className="mini icon"
                      disabled={busy}
                      onClick={() => w.stage(path, [f])}
                      aria-label={t("staging.resolved")}
                      title={`${t("staging.resolved")} — ${t("staging.resolvedHint")}`}
                    >
                      <Icon name="check" size={13} />
                    </button>
                  </>
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

      {/* À côté du commit : l'autre façon de garder les modifications (fichiers choisis). */}
      <CommitBox
        path={path}
        onStash={!busy && st && st.unstaged.length + st.staged.length > 0 ? () => void askStash([]) : undefined}
      />
    </aside>
  );
}
