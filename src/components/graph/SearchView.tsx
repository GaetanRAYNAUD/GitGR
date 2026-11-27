// Recherche dans les modifications (« quand ce texte a été ajouté / retiré ? »), ouverte à la
// place du graphe depuis la barre d'outils : `git log -S` (ou `-G` pour une expression
// régulière) sur toutes les branches, éventuellement limité à un fichier ou un dossier.
//
// Souris : clic = ses détails ; double-clic = le montrer dans le graphe ; clic droit = ses
// actions. Clavier : le champ a le focus à l'ouverture, Entrée lance la recherche et la liste
// prend le focus ; ↓ depuis le champ y va aussi. Liste à une tabulation : ↑ / ↓ (les détails
// suivent), Entrée = détails, Maj+Entrée = dans le graphe, Maj+F10 = actions ; Échap ferme.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { Commit } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useGraphFind } from "../../store/graphFind";
import { useSearchView, type ContentQuery } from "../../store/range";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu } from "./menus";
import { listKeys, RetryNotice, scrollRow, useCommitWhen } from "./viewKit";

const LIMIT = 200;
const EMPTY: ContentQuery = { text: "", regex: false, file: "" };

export function SearchView({ path }: { path: string }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
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
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [form, setForm] = useState<ContentQuery>(last);
  const [results, setResults] = useState<Commit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Champ texte vide à l'envoi : dit sous le champ, effacé à la frappe. */
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Après un envoi, la liste prend le focus dès qu'elle arrive. */
  const focusList = useRef(false);
  const { when, full } = useCommitWhen();

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

  const list = results ?? [];
  const at = Math.max(
    0,
    list.findIndex((c) => c.sha === selected),
  );
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) close(path);
      else setMissing(sha);
    });
  const choose = (i: number) => {
    const c = list[i];
    if (!c) return;
    setMissing(null);
    useGraph.getState().select(path, c.sha);
    scrollRow(`sr-${c.sha}`);
  };
  const items = (sha: string): MenuItem[] => [{ label: t("reflog.showInGraph"), onClick: () => reveal(sha) }, "sep", ...commitMenu(t, path, sha, refs)];
  const onKeyDown = listKeys(list.length, at, {
    go: choose,
    enter: (shift) => (shift ? reveal(list[at].sha) : choose(at)),
    menu: () => {
      useGraph.getState().select(path, list[at].sha);
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
        <ul
          ref={listRef}
          className="reflog-list"
          role="listbox"
          tabIndex={0}
          aria-label={count}
          aria-activedescendant={list[at] ? `sr-${list[at].sha}` : undefined}
          onKeyDown={onKeyDown}
        >
          {results.map((c, i) => (
            <li
              key={c.sha}
              id={`sr-${c.sha}`}
              role="option"
              aria-selected={selected === c.sha}
              aria-label={c.subject}
              aria-description={[c.author, when(c.time), c.sha.slice(0, 7)].join(", ")}
              className={["reflog-row", selected === c.sha && "on", i === at && "active"].filter(Boolean).join(" ")}
              onClick={() => choose(i)}
              onDoubleClick={() => reveal(c.sha)}
              onContextMenu={(ev) => {
                useGraph.getState().select(path, c.sha);
                openContextMenu(ev, items(c.sha));
              }}
            >
              <span className="reflog-message">{c.subject}</span>
              <span className="muted search-author">{c.author}</span>
              <span className="mono muted reflog-sha">{c.sha.slice(0, 7)}</span>
              <span className="muted reflog-time" title={full(c.time)}>
                {when(c.time)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
