// Diff d'un fichier de la copie de travail, à la place du graphe : indexer / retirer /
// abandonner le fichier entier, un bloc, ou des lignes choisies (clic, Maj+clic pour une plage ;
// au clavier, Espace, Maj+flèches, Entrée, Suppr).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileDiff, LineRef } from "../../lib/types";
import { useApp } from "../../store/app";
import { useWork, type WorkDiff } from "../../store/worktree";
import { useDialogs } from "../../store/dialogs";
import { compareLines, CopyDiffButton, DiffBody, DiffViewToggle, lineKey, useEscape, useReturnFocus } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { StatusBadge } from "./FileList";
import { fileMenu } from "./menus";
import { openContextMenu } from "../ContextMenu";

/** Lignes modifiées (`+`/`-`) d'un diff, dans l'ordre d'affichage. */
function changedLines(data: FileDiff | undefined, hunk?: number): LineRef[] {
  if (!data) return [];
  const out: LineRef[] = [];
  data.hunks.forEach((h, hi) => {
    if (hunk !== undefined && hi !== hunk) return;
    h.lines.forEach((l, li) => l.kind !== " " && out.push({ hunk: hi, line: li }));
  });
  return out;
}

export function WorkDiffView({ path, diff }: { path: string; diff: WorkDiff }) {
  const { t } = useTranslation();
  const w = useWork.getState();
  const busy = useWork((s) => !!s.repos[path]?.busy);
  const closeDiff = useWork((s) => s.closeDiff);
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const update = useApp((s) => s.updateSettings);
  const sectionRef = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(sectionRef);

  const { file, area, data } = diff;
  // Espaces ignorés : le diff affiché n'est pas celui que git appliquerait, pas de découpage.
  const splittable = area === "unstaged" || area === "staged";
  // Fichier entier : idem (le diff relu pour indexer n'a que 3 lignes de contexte).
  const lineMode = splittable && !ignoreWs && !full;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<LineRef | null>(null);
  const count = selected.size;

  // Échap : d'abord la sélection de lignes, puis la vue (le focus revient à la liste).
  const close = useCallback(() => {
    returnFocus();
    closeDiff(path);
  }, [returnFocus, closeDiff, path]);
  const onEscape = useCallback(() => (count > 0 ? setSelected(new Set()) : close()), [count, close]);
  useEscape(onEscape);

  // Nouveau diff (autre fichier, autre côté, contenu changé) : la sélection n'a plus de sens.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [file.path, area, data?.fingerprint]);

  // « Ignorer les espaces » ou « Fichier entier » changé : le diff est relu.
  const opts = `${ignoreWs}|${full}`;
  const shownOpts = useRef(opts);
  useEffect(() => {
    if (shownOpts.current === opts) return;
    shownOpts.current = opts;
    const d = useWork.getState().repos[path]?.diff;
    if (d) void useWork.getState().openDiff(path, d.file, d.area);
  }, [opts, path]);

  const all = useMemo(() => changedLines(data), [data]);

  const toggle = (hunk: number, line: number, range: boolean) => {
    const key = lineKey(hunk, line);
    // Lu maintenant : l'updater de setState s'exécute plus tard, après la mise à jour de l'ancre.
    const a = anchor.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && a) {
        const i = all.findIndex((r) => r.hunk === a.hunk && r.line === a.line);
        const j = all.findIndex((r) => r.hunk === hunk && r.line === line);
        const [from, to] = i < j ? [i, j] : [j, i];
        for (const r of all.slice(from, to + 1)) next.add(lineKey(r.hunk, r.line));
      } else if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
    anchor.current = { hunk, line };
  };

  const extend = (from: LineRef, to: LineRef) => {
    const [a, b] = compareLines(from, to) <= 0 ? [from, to] : [to, from];
    setSelected(new Set(all.filter((r) => compareLines(r, a) >= 0 && compareLines(r, b) <= 0).map((r) => lineKey(r.hunk, r.line))));
  };

  const picked = (): LineRef[] => all.filter((r) => selected.has(lineKey(r.hunk, r.line)));

  /** Confirmation d'un abandon (irréversible), puis l'action. */
  const confirmDiscard = async (title: string, body: string, run: () => void) => {
    const ok = await useDialogs.getState().choose({
      title,
      body,
      choices: [{ id: "discard", label: t("staging.discard"), danger: true }],
    });
    if (ok) run();
  };

  const discardLines = (lines: LineRef[], what: "lines" | "hunk") =>
    confirmDiscard(
      t(what === "hunk" ? "staging.discardHunkTitle" : "staging.discardLinesTitle", { count: lines.length }),
      t("staging.discardLinesBody", { file: file.path }),
      () => w.applyLines(path, lines, "discard"),
    );

  const discardFile = () =>
    confirmDiscard(
      t("staging.discardTitle", { count: 1 }),
      t(file.status === "?" ? "staging.discardUntracked" : "staging.discardFile", { file: file.path }),
      () => w.discard(path, [file]),
    );

  /** Entrée / Suppr dans le diff : la sélection, sinon le bloc de la ligne active. */
  const onKeyAction = (action: "apply" | "discard", at: LineRef) => {
    if (!lineMode || busy) return;
    const lines = count ? picked() : changedLines(data, at.hunk);
    if (!lines.length) return;
    if (action === "apply") void w.applyLines(path, lines, area === "staged" ? "unstage" : "stage");
    else if (area === "unstaged") void discardLines(lines, count ? "lines" : "hunk");
  };

  const enter = t("keys.enter");
  const hunkActions =
    lineMode && data
      ? (h: number) => {
          const lines = changedLines(data, h);
          // Pas d'arrêt de tabulation par bloc : Entrée et Suppr dans le diff les remplacent.
          return area === "staged" ? (
            <button className="mini" tabIndex={-1} disabled={busy} title={`${t("staging.unstageHunk")} (${enter})`} onClick={() => w.applyLines(path, lines, "unstage")}>
              {t("staging.unstageHunk")}
            </button>
          ) : (
            <>
              <button className="mini danger-text" tabIndex={-1} disabled={busy} title={`${t("staging.discardHunk")} (${t("keys.delete")})`} onClick={() => discardLines(lines, "hunk")}>
                {t("staging.discardHunk")}
              </button>
              <button className="mini" tabIndex={-1} disabled={busy} title={`${t("staging.stageHunk")} (${enter})`} onClick={() => w.applyLines(path, lines, "stage")}>
                {t("staging.stageHunk")}
              </button>
            </>
          );
        }
      : undefined;

  const lineBar = () => {
    if (splittable && ignoreWs)
      return (
        <div className="line-bar">
          <span className="muted">{t("diff.wsHidden")}</span>
          <span className="line-bar-actions">
            <button className="mini" onClick={() => update({ diffIgnoreWs: false })}>
              {t("diff.showWs")}
            </button>
          </span>
        </div>
      );
    if (splittable && full)
      return (
        <div className="line-bar">
          <span className="muted">{t("diff.fullHidden")}</span>
          <span className="line-bar-actions">
            <button className="mini" onClick={() => update({ diffFull: false })}>
              {t("diff.showHunks")}
            </button>
          </span>
        </div>
      );
    if (area === "untracked")
      return (
        <div className="line-bar">
          <span className="muted">{t("staging.untrackedHint")}</span>
        </div>
      );
    if (!lineMode) return null;
    return (
      <div className={count ? "line-bar on" : "line-bar"}>
        <span role="status">{count > 0 && t("staging.linesSelected", { count })}</span>
        {count === 0 ? (
          <span className="muted line-hint">{t(area === "staged" ? "staging.linesHintStaged" : "staging.linesHint")}</span>
        ) : (
          <span className="line-bar-actions">
            <button className="mini" onClick={() => setSelected(new Set())} title={`${t("staging.clearSelection")} (${t("keys.escape")})`}>
              {t("staging.clearSelection")}
            </button>
            {area === "staged" ? (
              <button className="mini primary" disabled={busy} title={enter} onClick={() => w.applyLines(path, picked(), "unstage")}>
                {t("staging.unstageLines", { count })}
              </button>
            ) : (
              <>
                <button className="mini danger-text" disabled={busy} title={t("keys.delete")} onClick={() => discardLines(picked(), "lines")}>
                  {t("staging.discardLines", { count })}
                </button>
                <button className="mini primary" disabled={busy} title={enter} onClick={() => w.applyLines(path, picked(), "stage")}>
                  {t("staging.stageLines", { count })}
                </button>
              </>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="diff-view" ref={sectionRef} aria-label={t("diff.label", { file: file.path })}>
      <header className="diff-head">
        <BackButton onClick={close} />
        <StatusBadge status={file.status} />
        <DiffPath file={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file.path))} />
        <span className={`area-pill area-${area}`}>{t(`staging.area.${area}`)}</span>
        {data && <DiffStats diff={data} />}
        <span className="diff-file-actions">
          {area === "staged" ? (
            <button className="btn sm" disabled={busy} onClick={() => w.unstage(path, [file])}>
              {t("staging.unstageFile")}
            </button>
          ) : area === "conflicted" ? (
            <button className="btn sm" disabled={busy} onClick={() => w.stage(path, [file])}>
              {t("staging.resolved")}
            </button>
          ) : (
            <>
              <button className="btn sm danger-text" disabled={busy} onClick={discardFile}>
                {t("staging.discardFileButton")}
              </button>
              <button className="btn sm" disabled={busy} onClick={() => w.stage(path, [file])}>
                {t("staging.stageFile")}
              </button>
            </>
          )}
          <CopyDiffButton file={file} data={data} />
          <DiffViewToggle />
        </span>
      </header>

      {lineBar()}

      <div className="diff-body">
        <DiffBody
          data={data}
          error={diff.error}
          hunkActions={hunkActions}
          selection={lineMode ? { selected, toggle, extend, all: () => setSelected(new Set(all.map((r) => lineKey(r.hunk, r.line)))) } : undefined}
          onKeyAction={lineMode ? onKeyAction : undefined}
          onRetry={() => void useWork.getState().openDiff(path, file, area)}
          resetKey={`${file.path}\n${area}`}
          copyAs={file}
          // Marge de blame sur la copie de travail ; la version indexée n'en a pas.
          blame={
            file.status === "D"
              ? undefined
              : { path, file: file.path, rev: null, unavailable: area === "staged" ? t("diff.blameStaged") : undefined, beforeReveal: () => closeDiff(path) }
          }
        />
      </div>
    </section>
  );
}
