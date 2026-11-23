// Recherche dans les modifications (« quand ce texte a été ajouté / retiré ? »), ouverte à la
// place du graphe depuis la barre d'outils : `git log -S` (ou `-G` pour une expression
// régulière) sur toutes les branches, éventuellement limité à un fichier ou un dossier.
// Clic : ses détails ; double-clic : le montrer dans le graphe ; clic droit : ses actions.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import type { Commit } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useSearchView, type ContentQuery } from "../../store/range";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu } from "./menus";

const LIMIT = 200;
const EMPTY: ContentQuery = { text: "", regex: false, file: "" };

export function SearchView({ path }: { path: string }) {
  const { t } = useTranslation();
  const close = useSearchView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const last = useSearchView((s) => s.queries[path]) ?? EMPTY;
  const setQuery = useSearchView((s) => s.setQuery);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [form, setForm] = useState<ContentQuery>(last);
  const [results, setResults] = useState<Commit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);

  // La dernière recherche est refaite en revenant sur la vue.
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
      },
      (e) => {
        if (!live) return;
        setResults(null);
        setError(errorCode(e));
        setBusy(false);
      },
    );
    return () => {
      live = false;
    };
  }, [path, last]);

  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) back();
      else setMissing(sha);
    });

  return (
    <section className="pull-view reflog-view search-view" aria-label={t("contentSearch.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="search" size={15} />
        <span className="pull-view-title">{t("contentSearch.title")}</span>
      </header>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          const q = { text: form.text, regex: form.regex, file: form.file.trim() };
          if (!q.text) return setError("search_empty");
          setMissing(null);
          setQuery(path, q);
        }}
      >
        <input
          autoFocus
          className="search-text mono"
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          placeholder={t("contentSearch.text")}
          aria-label={t("contentSearch.text")}
          spellCheck={false}
        />
        <input
          className="search-file mono"
          value={form.file}
          onChange={(e) => setForm({ ...form, file: e.target.value })}
          placeholder={t("contentSearch.file")}
          aria-label={t("contentSearch.file")}
          spellCheck={false}
        />
        <button type="submit" className="btn primary" disabled={busy}>
          {t("contentSearch.submit")}
        </button>
        <label className="menu-check search-regex">
          <input type="checkbox" checked={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.checked })} />
          {t("contentSearch.regex")}
        </label>
      </form>
      <p className="muted reflog-hint">
        {results ? t("contentSearch.results", { count: results.length }) + (results.length >= LIMIT ? ` · ${t("contentSearch.limit")}` : "") + " · " : ""}
        {t("contentSearch.hint")}
      </p>
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : busy && !results ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : results && results.length === 0 ? (
        <p className="muted pull-pad">{t("contentSearch.none")}</p>
      ) : results ? (
        <ul className="reflog-list" aria-label={t("contentSearch.results", { count: results.length })}>
          {results.map((c) => (
            <li key={c.sha}>
              <button
                className={selected === c.sha ? "reflog-row on" : "reflog-row"}
                onClick={() => {
                  setMissing(null);
                  useGraph.getState().select(path, c.sha);
                }}
                onDoubleClick={() => reveal(c.sha)}
                onContextMenu={(ev) => {
                  useGraph.getState().select(path, c.sha);
                  openContextMenu(ev, [{ label: t("reflog.showInGraph"), onClick: () => reveal(c.sha) }, "sep", ...commitMenu(t, path, c.sha, refs)]);
                }}
              >
                <span className="reflog-message">{c.subject}</span>
                <span className="muted search-author">{c.author}</span>
                <span className="mono muted">{c.sha.slice(0, 7)}</span>
                <span className="muted reflog-time">{ago(c.time)}</span>
              </button>
              {missing === c.sha && (
                <p className="details-note muted reflog-missing" role="status">
                  {t("reflog.notInGraph")}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
