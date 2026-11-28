// Recherche dans les modifications (« quand ce texte a été ajouté / retiré ? »), ouverte à la
// place du graphe depuis la barre d'outils : `git log -S` (ou `-G` pour une expression
// régulière) sur toutes les branches, éventuellement limité à un fichier ou un dossier.
//
// Deux volets : à gauche les commits trouvés, à droite celui qui est choisi, avec les seuls
// fichiers où le texte change et leur diff, le texte surligné.
//
// Souris : clic = le montrer à droite ; double-clic = le montrer dans le graphe ; clic droit =
// ses actions. Clavier : le champ a le focus à l'ouverture, Entrée lance la recherche et la
// liste prend le focus ; ↓ depuis le champ y va aussi. Liste à une tabulation : ↑ / ↓ (le volet
// de droite suit), Entrée = aller à ses fichiers, Maj+Entrée = dans le graphe, Maj+F10 =
// actions ; Échap ferme.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { Commit, FileChange, FileDiff } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useGraphFind } from "../../store/graphFind";
import { useSearchView, type ContentQuery } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { commitSides } from "./BinaryPreview";
import { DiffBody, DiffViewToggle, useEscape, useReturnFocus } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton, DiffPath } from "./DiffView";
import { FileList, StatusBadge } from "./FileList";
import { commitMenu, fileMenu } from "./menus";
import { listKeys, RetryNotice, samePath, scrollRow, useCommitWhen } from "./viewKit";

const LIMIT = 200;
const EMPTY: ContentQuery = { text: "", regex: false, file: "" };

/** Le texte cherché en expression globale, pour le surligner dans le diff. */
export function searchMark(q: ContentQuery): RegExp | null {
  if (!q.text) return null;
  try {
    return new RegExp(q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  } catch {
    return null;
  }
}

export function SearchView({ path }: { path: string }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useSearchView((s) => s.close);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const last = useSearchView((s) => s.queries[path]) ?? EMPTY;
  const setQuery = useSearchView((s) => s.setQuery);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const [form, setForm] = useState<ContentQuery>(last);
  const [results, setResults] = useState<Commit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Champ texte vide à l'envoi : dit sous le champ, effacé à la frappe. */
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Commit montré à droite. */
  const [focus, setFocus] = useState<string | null>(null);
  /** Fichiers du commit montré, pour la recherche `query` (ignorés si elle a changé). */
  const [files, setFiles] = useState<{ sha: string; query: ContentQuery; data?: FileChange[]; error?: string } | null>(null);
  const [filesReload, setFilesReload] = useState(0);
  const [file, setFile] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState<{ data: FileDiff | null; error: string | null } | null>(null);
  const [diffReload, setDiffReload] = useState(0);
  /** Après un envoi, la liste prend le focus dès qu'elle arrive. */
  const focusList = useRef(false);
  const { when, full: fullDate } = useCommitWhen();
  const mark = useMemo(() => searchMark(last), [last]);

  // La dernière recherche est refaite en revenant sur la vue. Un échec garde les résultats
  // précédents (erreur en bandeau, « Réessayer »).
  useEffect(() => {
    if (!last.text) return;
    let live = true;
    setBusy(true);
    api.searchChanges(path, last.text, last.regex, last.file || null).then(
      (list) => {
        if (!live) return;
        setResults(list);
        setError(null);
        setBusy(false);
        // Le commit montré reste s'il est encore trouvé ; sinon le premier.
        setFocus((s) => (s && list.some((c) => c.sha === s) ? s : (list[0]?.sha ?? null)));
      },
      (e) => {
        if (!live) return;
        setError(errorCode(e));
        setBusy(false);
      },
    );
    return () => {
      live = false;
    };
  }, [path, last, reload]);

  useEffect(() => {
    if (focusList.current && results?.length) {
      focusList.current = false;
      listRef.current?.focus();
    }
  }, [results]);

  // Fichiers du commit montré où le texte change ; le premier s'ouvre.
  useEffect(() => {
    if (!focus || !last.text) return;
    let live = true;
    api.searchFiles(path, focus, last.text, last.regex, last.file || null).then(
      (list) => {
        if (!live) return;
        setFiles({ sha: focus, query: last, data: list });
        setFile((f) => samePath(f, list));
      },
      (e) => live && setFiles({ sha: focus, query: last, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
    // `reload` : la même recherche relancée relit aussi les fichiers (le dépôt a pu changer).
  }, [path, focus, last, reload, filesReload]);

  const shown = focus && files?.sha === focus && files.query === last ? files : null;
  const fileShown = file && shown?.data?.some((f) => f.path === file.path) ? file : null;
  useEffect(() => {
    if (!focus || !fileShown) return;
    let live = true;
    setDiff(null);
    api.commitDiff(path, focus, fileShown.path, fileShown.oldPath, { ignoreWs, full }).then(
      (d) => live && setDiff({ data: d, error: null }),
      (e) => live && setDiff({ data: null, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, focus, fileShown, ignoreWs, full, diffReload]);

  const list = results ?? [];
  const at = Math.max(
    0,
    list.findIndex((c) => c.sha === focus),
  );
  const current = list[at];
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) close(path);
      else setMissing(sha);
    });
  const choose = (i: number) => {
    const c = list[i];
    if (!c) return;
    setMissing(null);
    setFocus(c.sha);
    scrollRow(`sr-${c.sha}`);
  };
  const items = (sha: string): MenuItem[] => [{ label: t("reflog.showInGraph"), onClick: () => reveal(sha) }, "sep", ...commitMenu(t, path, sha, refs)];
  const onKeyDown = listKeys(list.length, at, {
    go: choose,
    enter: (shift) => {
      if (shift) return reveal(list[at].sha);
      choose(at);
      // Entrée : vers les fichiers du commit (la liste, ou le diff s'il n'y en a qu'un).
      filesRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    },
    menu: () => {
      const box = document.getElementById(`sr-${list[at].sha}`)?.getBoundingClientRect();
      if (box) useContextMenu.getState().open(box.left + 12, box.bottom, items(list[at].sha));
    },
  });
  /** Champs du formulaire : Échap ferme la vue (elle n'écoute pas les champs), ↓ va aux résultats. */
  const onFieldKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowDown" && list.length) {
      e.preventDefault();
      listRef.current?.focus();
    }
  };
  const showInGraph = () => {
    useGraphFind.getState().showSet(path, { label: last.text, shas: list.map((c) => c.sha) });
    close(path);
  };

  const count = results ? (results.length >= LIMIT ? t("contentSearch.resultsMore", { count: LIMIT }) : t("contentSearch.results", { count: results.length })) : "";
  const filesLabel = current ? t("contentSearch.files", { count: shown?.data?.length ?? 0, sha: current.sha.slice(0, 7) }) : "";

  return (
    <section ref={sectionRef} className="pull-view reflog-view search-view" aria-label={t("contentSearch.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title">{t("contentSearch.title")}</span>
        <button className="btn sm" disabled={!list.length} onClick={showInGraph} title={t("contentSearch.highlightHint")}>
          {t("contentSearch.highlight")}
        </button>
      </header>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const q = { text: form.text, regex: form.regex, file: form.file.trim() };
          if (!q.text) return setEmpty(true);
          setMissing(null);
          focusList.current = true;
          // Même recherche : relancée quand même (un dépôt a pu changer).
          if (q.text === last.text && q.regex === last.regex && q.file === last.file) setReload((n) => n + 1);
          else setQuery(path, q);
        }}
      >
        <input
          autoFocus
          className="pf-input search-text mono"
          value={form.text}
          onChange={(e) => {
            setEmpty(false);
            setForm({ ...form, text: e.target.value });
          }}
          onKeyDown={onFieldKey}
          placeholder={t("contentSearch.text")}
          aria-label={t("contentSearch.text")}
          aria-invalid={empty || undefined}
          aria-describedby={empty ? "search-empty" : undefined}
          spellCheck={false}
        />
        <input
          className="pf-input search-file mono"
          value={form.file}
          onChange={(e) => setForm({ ...form, file: e.target.value })}
          onKeyDown={onFieldKey}
          placeholder={t("contentSearch.file")}
          aria-label={t("contentSearch.file")}
          spellCheck={false}
        />
        <label className="menu-check search-regex" title={t("contentSearch.regexHint")}>
          <input type="checkbox" checked={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.checked })} onKeyDown={onFieldKey} />
          {t("contentSearch.regex")}
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {t("contentSearch.submit")}
        </button>
        {empty && (
          <p id="search-empty" className="input-error search-empty">
            {t("errors.search_empty")}
          </p>
        )}
      </form>
      <p className="muted reflog-hint" title={t("contentSearch.keys")} aria-live="polite" aria-busy={busy || undefined}>
        {busy ? (
          <span className="file-history-count">{t("contentSearch.searching")}</span>
        ) : (
          count && <span className="file-history-count">{count}</span>
        )}
        {t("contentSearch.keys")}
      </p>
      {missing && (
        <p className="details-note muted blame-note" role="status">
          {t("reflog.notInGraph")}
        </p>
      )}
      {error && <RetryNotice error={error} onRetry={() => setReload((n) => n + 1)} />}
      {busy && !results ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : results && results.length === 0 ? (
        <p className="muted pull-pad">{t("contentSearch.none")}</p>
      ) : results ? (
        <div className="pull-files range-files search-split">
          <div className="pull-file-list search-results">
            <ul
              ref={listRef}
              className="reflog-list"
              role="listbox"
              tabIndex={0}
              aria-label={count}
              aria-activedescendant={current ? `sr-${current.sha}` : undefined}
              onKeyDown={onKeyDown}
            >
              {results.map((c, i) => (
                <li
                  key={c.sha}
                  id={`sr-${c.sha}`}
                  role="option"
                  aria-selected={focus === c.sha}
                  aria-label={c.subject}
                  aria-description={[c.author, when(c.time), c.sha.slice(0, 7)].join(", ")}
                  className={["reflog-row search-row", focus === c.sha && "on active"].filter(Boolean).join(" ")}
                  onClick={() => choose(i)}
                  onDoubleClick={() => reveal(c.sha)}
                  onContextMenu={(ev) => {
                    choose(i);
                    openContextMenu(ev, items(c.sha));
                  }}
                >
                  <span className="reflog-message">{c.subject}</span>
                  <span className="range-meta muted">
                    <span className="mono">{c.sha.slice(0, 7)}</span>
                    <span className="search-author">{c.author}</span>
                    <span title={fullDate(c.time)}>{when(c.time)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="pull-file-diff search-detail" ref={filesRef}>
            {current && (
              <>
                <div className="section-h">
                  <span>{filesLabel}</span>
                </div>
                {shown?.error ? (
                  <RetryNotice error={shown.error} onRetry={() => setFilesReload((n) => n + 1)} />
                ) : !shown?.data ? (
                  <p className="muted pull-pad">{t("details.loading")}</p>
                ) : shown.data.length === 0 ? (
                  <p className="muted pull-pad">{t("contentSearch.noFiles")}</p>
                ) : (
                  shown.data.length > 1 && (
                    <div className="search-files">
                      <FileList
                        files={shown.data}
                        view={fileView}
                        label={filesLabel}
                        isActive={(f) => fileShown?.path === f.path}
                        onOpen={setFile}
                        onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
                      />
                    </div>
                  )
                )}
                {fileShown && (
                  <>
                    <header className="diff-head">
                      <StatusBadge status={fileShown.status} />
                      <DiffPath file={fileShown} onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, fileShown.path))} />
                      {diff?.data && <DiffStats diff={diff.data} />}
                      <DiffViewToggle />
                    </header>
                    <div className="diff-body">
                      <DiffBody
                        data={diff?.data ?? undefined}
                        error={diff?.error ?? undefined}
                        onRetry={() => setDiffReload((n) => n + 1)}
                        resetKey={`${focus}:${fileShown.path}`}
                        copyAs={fileShown}
                        binarySides={focus ? commitSides(path, fileShown, focus) : undefined}
                        blame={fileShown.status === "D" ? undefined : { path, file: fileShown.path, rev: focus }}
                        mark={mark}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
