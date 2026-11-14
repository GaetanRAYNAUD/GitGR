// Diff d'un fichier de la copie de travail, à la place du graphe : indexer / retirer /
// abandonner le fichier entier, un bloc, ou des lignes choisies (clic, Maj+clic pour une plage).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileDiff, LineRef } from "../../lib/types";
import { useWork, type WorkDiff } from "../../store/worktree";
import { useDialogs } from "../../store/dialogs";
import { DiffBody, DiffViewToggle, lineKey, useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";
import { StatusBadge } from "./FileList";

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
  const close = useCallback(() => closeDiff(path), [closeDiff, path]);
  useEscape(close);

  const { file, area, data } = diff;
  const lineMode = area === "unstaged" || area === "staged";
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<LineRef | null>(null);

  // Nouveau diff (autre fichier, autre côté, contenu changé) : la sélection n'a plus de sens.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [file.path, area, data?.fingerprint]);

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

  const hunkActions =
    lineMode && data
      ? (h: number) => {
          const lines = changedLines(data, h);
          return area === "staged" ? (
            <button className="mini" disabled={busy} onClick={() => w.applyLines(path, lines, "unstage")}>
              {t("staging.unstageHunk")}
            </button>
          ) : (
            <>
              <button className="mini danger-text" disabled={busy} onClick={() => discardLines(lines, "hunk")}>
                {t("staging.discardHunk")}
              </button>
              <button className="mini" disabled={busy} onClick={() => w.applyLines(path, lines, "stage")}>
                {t("staging.stageHunk")}
              </button>
            </>
          );
        }
      : undefined;

  const count = selected.size;

  return (
    <section className="diff-view" aria-label={t("diff.label", { file: file.path })}>
      <header className="diff-head">
        <BackButton onClick={close} />
        <StatusBadge status={file.status} />
        <span className="diff-path mono">
          {file.oldPath && <span className="muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        <span className={`area-pill area-${area}`}>{t(`staging.area.${area}`)}</span>
        <span className="diff-file-actions">
          <DiffViewToggle />
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
        </span>
      </header>

      {lineMode && (
        <div className={count ? "line-bar on" : "line-bar"} role="status">
          {count === 0 ? (
            <span className="muted">{t("staging.linesHint")}</span>
          ) : (
            <>
              <span>{t("staging.linesSelected", { count })}</span>
              <span className="line-bar-actions">
                <button className="mini" onClick={() => setSelected(new Set())}>
                  {t("staging.clearSelection")}
                </button>
                {area === "staged" ? (
                  <button className="mini primary" disabled={busy} onClick={() => w.applyLines(path, picked(), "unstage")}>
                    {t("staging.unstageLines", { count })}
                  </button>
                ) : (
                  <>
                    <button className="mini danger-text" disabled={busy} onClick={() => discardLines(picked(), "lines")}>
                      {t("staging.discardLines", { count })}
                    </button>
                    <button className="mini primary" disabled={busy} onClick={() => w.applyLines(path, picked(), "stage")}>
                      {t("staging.stageLines", { count })}
                    </button>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      )}

      <div className="diff-body">
        <DiffBody
          data={data}
          error={diff.error}
          hunkActions={hunkActions}
          selection={lineMode ? { selected, toggle } : undefined}
        />
      </div>
    </section>
  );
}
