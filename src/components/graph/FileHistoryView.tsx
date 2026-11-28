// Historique d'un fichier, ouvert à la place du graphe depuis le clic droit sur un fichier :
// commits de la branche courante qui le modifient (`git log --follow`, renommages suivis),
// à gauche, et le diff du fichier au commit choisi, à droite (comme le « Show History »
// d'IntelliJ). Un second commit marqué (Ctrl+clic, Espace) : le diff entre les deux versions.
// « Voir dans le graphe » met ces commits en avant dans le graphe (les autres estompés).
//
// Souris : clic = ce commit (détails et diff) ; Ctrl+clic = le comparer ; double-clic = le diff
// en plein écran ; clic droit = ses actions. Clavier : une seule tabulation dans la liste, ↑ / ↓
// (le diff suit), Espace = comparer, Entrée = aller dans le diff, Maj+Entrée = dans le graphe,
// Maj+F10 / touche Menu = actions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { commitDate } from "../../lib/format";
import type { FileDiff, FileHistoryEntry } from "../../lib/types";
import { diffOpts, useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useGraphFind } from "../../store/graphFind";
import { fileViewGoBack, useBlameView, useFileHistoryView } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { commitSides } from "./BinaryPreview";
import { DiffBody, DiffViewToggle, useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { DiffStats } from "./DiffStats";
import { StatusBadge } from "./FileList";
import { commitMenu, fileMenu } from "./menus";

/** Nombre de commits lus au plus (cf. `history.rs`). */
const LIMIT = 500;

export function FileHistoryView({ path, file }: { path: string; file: string }) {
  const { t, i18n } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const diffRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const back = useCallback(() => {
    if (!fileViewGoBack(path)) returnFocus();
  }, [path, returnFocus]);
  useEscape(back);
  const here = { kind: "history" as const, file };
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Commit marqué pour comparer avec le commit choisi (Ctrl+clic, Espace). */
  const [compare, setCompare] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ key: string; data?: FileDiff; error?: string } | null>(null);
  const [diffReload, setDiffReload] = useState(0);

  // Relu quand les refs changent (commit, checkout, pull…). Une relecture qui échoue garde la
  // liste déjà affichée (erreur en bandeau, « Réessayer »).
  useEffect(() => {
    let live = true;
    api.fileHistory(path, file).then(
      (list) => {
        if (!live) return;
        setEntries(list);
        setError(null);
      },
      (e) => {
        if (live) setError(errorCode(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, file, refs, reload]);

  // Focus sur la liste dès qu'elle est là.
  const focused = useRef(false);
  useEffect(() => {
    if (entries && entries.length > 0 && !focused.current) {
      focused.current = true;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [entries]);

  const list = useMemo(() => entries ?? [], [entries]);
  // Ligne active : le commit choisi s'il est dans la liste, sinon la première.
  const activeIndex = Math.max(
    0,
    list.findIndex((e) => e.commit.sha === selected),
  );
  const active = list[activeIndex];
  const other = compare && compare !== active?.commit.sha ? list.find((e) => e.commit.sha === compare) : undefined;
  // Comparaison : de la version la plus ancienne (plus bas dans la liste) à la plus récente.
  const [older, newer] = other && list.indexOf(other) > activeIndex ? [other, active] : [active, other];

  // Diff du fichier au commit choisi, ou entre les deux commits comparés.
  const diffKey = active ? `${other ? `${older!.commit.sha}..${newer!.commit.sha}` : active.commit.sha}|${ignoreWs}|${full}|${diffReload}` : "";
  useEffect(() => {
    if (!active) return;
    let live = true;
    const key = diffKey;
    const opts = diffOpts();
    const run =
      other && older && newer
        ? api.rangeDiff(path, older.commit.sha, newer.commit.sha, newer.change.path, older.change.path !== newer.change.path ? older.change.path : null, opts)
        : api.commitDiff(path, active.commit.sha, active.change.path, active.change.oldPath ?? null, opts);
    setDiff((d) => (d?.key === key ? d : { key }));
    run.then(
      (data) => live && setDiff({ key, data }),
      (e) => live && setDiff({ key, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
    // Lu par sa clé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffKey, path]);

  const when = (s: number) => {
    const d = commitDate(s * 1000, i18n.language);
    return d.key === "date" ? d.text : t(`time.${d.key}`, { count: d.count });
  };
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) useFileHistoryView.getState().close(path);
      else setMissing(sha);
    });
  const showDiff = (e: FileHistoryEntry) => {
    useGraph.getState().select(path, e.commit.sha);
    void useGraph.getState().openDiff(path, e.commit.sha, e.change);
  };
  const choose = (e: FileHistoryEntry) => {
    setMissing(null);
    useGraph.getState().select(path, e.commit.sha);
  };
  const toggleCompare = (e: FileHistoryEntry) => setCompare((c) => (c === e.commit.sha || e.commit.sha === active?.commit.sha ? null : e.commit.sha));
  /** « Voir dans le graphe » : ces commits mis en avant dans le graphe, les autres estompés. */
  const showInGraph = () => {
    if (!entries) return;
    useFileHistoryView.getState().close(path);
    useGraphFind.getState().showSet(path, { label: file, shas: entries.map((e) => e.commit.sha) });
  };
  const items = (e: FileHistoryEntry): MenuItem[] => [
    { label: t("fileHistory.showDiff"), onClick: () => showDiff(e) },
    {
      label: compare === e.commit.sha ? t("fileHistory.uncompare") : t("fileHistory.compare"),
      disabled: e.commit.sha === active?.commit.sha,
      title: e.commit.sha === active?.commit.sha ? t("fileHistory.compareSelf") : undefined,
      onClick: () => toggleCompare(e),
    },
    { label: t("reflog.showInGraph"), onClick: () => reveal(e.commit.sha) },
    {
      label: t("blame.atCommit"),
      disabled: e.change.status === "D",
      title: e.change.status === "D" ? t("blame.deleted") : undefined,
      onClick: () => useBlameView.getState().show(path, { file: e.change.path, rev: e.commit.sha, historyFile: file }, here),
    },
    "sep",
    ...commitMenu(t, path, e.commit.sha, refs),
  ];

  const go = (i: number) => {
    const n = Math.max(0, Math.min(i, list.length - 1));
    if (!list[n]) return;
    choose(list[n]);
    document.getElementById(`fh-${list[n].commit.sha}`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    const e = list[activeIndex];
    if (!e) return;
    let handled = true;
    if (ev.key === "ArrowDown") go(activeIndex + 1);
    else if (ev.key === "ArrowUp") go(activeIndex - 1);
    else if (ev.key === "Home") go(0);
    else if (ev.key === "End") go(list.length - 1);
    else if (ev.key === "PageDown") go(activeIndex + 10);
    else if (ev.key === "PageUp") go(activeIndex - 10);
    else if (ev.key === " ") {
      // Espace : la ligne active devient le point de comparaison (ou cesse de l'être) ; on
      // choisit ensuite l'autre commit avec ↑ / ↓.
      setCompare((c) => (c === e.commit.sha ? null : e.commit.sha));
    } else if (ev.key === "Enter") {
      if (ev.shiftKey) reveal(e.commit.sha);
      else diffRef.current?.querySelector<HTMLElement>('[role="grid"]')?.focus();
    } else if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
      useGraph.getState().select(path, e.commit.sha);
      const box = document.getElementById(`fh-${e.commit.sha}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(e));
    } else handled = false;
    if (handled) ev.preventDefault();
  };

  // Le fichier n'est plus dans la copie de travail (dernier commit : suppression) : pas de blame.
  const gone = list[0]?.change.status === "D";
  const count = entries
    ? entries.length >= LIMIT
      ? t("fileHistory.resultsMore", { count: LIMIT })
      : t("fileHistory.results", { count: entries.length })
    : "";
  const shownDiff = diff?.key === diffKey ? diff : undefined;
  const diffFile = (other ? newer : active)?.change;

  return (
    <section ref={sectionRef} className="pull-view reflog-view file-history-view" aria-label={t("fileHistory.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title" title={file} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file))}>
          {t("fileHistory.of")} <span className="mono">{file}</span>
        </span>
        <button className="btn sm" disabled={!entries?.length} onClick={showInGraph} title={t("fileHistory.inGraphHint")}>
          {t("fileHistory.inGraph")}
        </button>
        <button
          className="btn sm"
          disabled={gone}
          title={gone ? t("fileHistory.blameGone") : undefined}
          onClick={() => useBlameView.getState().show(path, { file, rev: null, historyFile: file }, here)}
        >
          {t("blame.menu")}
        </button>
      </header>
      {missing && (
        <p className="details-note muted blame-note" role="status">
          {t("reflog.notInGraph")}
        </p>
      )}
      {error && (
        <div className="notice error blame-error" role="alert">
          <Icon name="alert" />
          <span>{errorMessage(t, error)}</span>
          <button type="button" className="link notice-action" onClick={() => setReload((n) => n + 1)}>
            {t("graph.retry")}
          </button>
        </div>
      )}
      {!entries ? (
        !error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="muted pull-pad">{t("fileHistory.none")}</p>
      ) : (
        <div className="file-history-split">
          <div className="file-history-list">
            <p className="muted reflog-hint" title={t("fileHistory.keys")}>
              {count && <span className="file-history-count">{count}</span>}
              {t("fileHistory.keys")}
            </p>
            <ul
              ref={listRef}
              className="reflog-list"
              role="listbox"
              tabIndex={0}
              aria-label={count}
              aria-activedescendant={active ? `fh-${active.commit.sha}` : undefined}
              onKeyDown={onKeyDown}
            >
              {entries.map((e, i) => {
                const status = t(`details.status.${e.change.status}`, { defaultValue: e.change.status });
                const compared = compare === e.commit.sha && e !== active;
                const description = [
                  status,
                  e.change.oldPath ? t("fileHistory.renamedFrom", { path: e.change.oldPath }) : null,
                  e.commit.author,
                  when(e.commit.time),
                  e.commit.sha.slice(0, 7),
                  compared ? t("fileHistory.compared") : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <li
                    key={e.commit.sha}
                    id={`fh-${e.commit.sha}`}
                    role="option"
                    aria-selected={selected === e.commit.sha}
                    aria-label={e.commit.subject}
                    aria-description={description}
                    className={["reflog-row", selected === e.commit.sha && "on", i === activeIndex && "active", compared && "compared"].filter(Boolean).join(" ")}
                    onClick={(ev) => (ev.ctrlKey || ev.metaKey ? toggleCompare(e) : choose(e))}
                    onDoubleClick={() => showDiff(e)}
                    onContextMenu={(ev) => {
                      useGraph.getState().select(path, e.commit.sha);
                      openContextMenu(ev, items(e));
                    }}
                  >
                    <StatusBadge status={e.change.status} />
                    <span className="reflog-message">
                      {e.commit.subject}
                      {e.change.oldPath && <span className="muted file-history-rename">{t("fileHistory.renamedFrom", { path: e.change.oldPath })}</span>}
                    </span>
                    <span className="muted search-author">{e.commit.author}</span>
                    <span className="mono muted file-history-sha">{e.commit.sha.slice(0, 7)}</span>
                    <span className="muted reflog-time" title={new Date(e.commit.time * 1000).toLocaleString(i18n.language)}>
                      {when(e.commit.time)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="file-history-diff" ref={diffRef}>
            <header className="diff-head">
              {other && older && newer ? (
                <span className="file-history-compare">
                  <span className="muted">{t("fileHistory.comparing")}</span>{" "}
                  <span className="mono">
                    {older.commit.sha.slice(0, 7)}..{newer.commit.sha.slice(0, 7)}
                  </span>
                  <button className="mini" onClick={() => setCompare(null)}>
                    {t("fileHistory.stopCompare")}
                  </button>
                </span>
              ) : (
                active && <span className="mono muted">{active.commit.sha.slice(0, 7)}</span>
              )}
              {shownDiff?.data && <DiffStats diff={shownDiff.data} />}
              <span className="status-spacer" />
              <DiffViewToggle />
            </header>
            <div className="diff-body">
              <DiffBody
                data={shownDiff?.data}
                error={shownDiff?.error}
                onRetry={() => setDiffReload((n) => n + 1)}
                resetKey={diffKey}
                binarySides={
                  other && older && newer
                    ? { path, old: { rev: older.commit.sha, file: older.change.path }, new: newer.change.status === "D" ? null : { rev: newer.commit.sha, file: newer.change.path } }
                    : active && commitSides(path, { status: active.change.status, path: active.change.path, oldPath: active.change.oldPath ?? null }, active.commit.sha)
                }
                blame={
                  diffFile && diffFile.status !== "D"
                    ? { path, file: diffFile.path, rev: (other ? newer : active)!.commit.sha, beforeReveal: () => useFileHistoryView.getState().close(path) }
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
