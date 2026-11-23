// « Où était HEAD » (reflog), ouvert à la place du graphe depuis la barre d'outils : les
// positions passées de HEAD ou d'une branche locale, pour retrouver un commit perdu (reset,
// rebase raté, branche supprimée). Clic : ses détails dans le panneau de droite ;
// double-clic : le montrer dans le graphe ; clic droit : branche, checkout, reset.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import type { ReflogEntry } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useReflogView } from "../../store/range";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu } from "./menus";

export function ReflogView({ path, refname }: { path: string; refname: string }) {
  const { t } = useTranslation();
  const close = useReflogView((s) => s.close);
  const show = useReflogView((s) => s.show);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const commits = useGraph((s) => s.graphs[path]?.commits);
  const done = useGraph((s) => s.graphs[path]?.done ?? false);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [entries, setEntries] = useState<ReflogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ligne choisie (un même commit peut revenir plusieurs fois). */
  const [row, setRow] = useState<number | null>(null);
  /** Commit montré dans le graphe mais introuvable dans l'historique des branches. */
  const [missing, setMissing] = useState<number | null>(null);

  // Relu à chaque nouvel état des refs (commit, checkout, reset…).
  useEffect(() => {
    let live = true;
    setError(null);
    api.reflog(path, refname).then(
      (list) => live && setEntries(list),
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, refname, refs]);

  const known = useMemo(() => new Set((commits ?? []).map((c) => c.sha)), [commits]);
  const locals = (refs?.refs ?? []).filter((r) => r.kind === "local").map((r) => r.short);
  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };

  const reveal = (i: number, sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) back();
      else setMissing(i);
    });

  return (
    <section className="pull-view reflog-view" aria-label={t("reflog.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="clock" size={15} />
        <span className="pull-view-title">{t("reflog.title", { ref: refname })}</span>
        <label className="reflog-ref">
          <select value={refname} onChange={(e) => show(path, e.target.value)} aria-label={t("reflog.ref")}>
            <option value="HEAD">{t("reflog.head")}</option>
            {locals.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="muted reflog-hint">{t("reflog.hint")}</p>
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !entries ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="muted pull-pad">{t("reflog.empty")}</p>
      ) : (
        <ul className="reflog-list" aria-label={t("reflog.label")}>
          {entries.map((e, i) => {
            const lost = done && !known.has(e.sha);
            const on = row === i && selected === e.sha;
            return (
              <li key={`${i}:${e.sha}`}>
                <button
                  className={on ? "reflog-row on" : "reflog-row"}
                  onClick={() => {
                    setRow(i);
                    setMissing(null);
                    useGraph.getState().select(path, e.sha);
                  }}
                  onDoubleClick={() => reveal(i, e.sha)}
                  onContextMenu={(ev) => {
                    setRow(i);
                    useGraph.getState().select(path, e.sha);
                    openContextMenu(ev, [
                      { label: t("reflog.showInGraph"), onClick: () => reveal(i, e.sha) },
                      "sep",
                      ...commitMenu(t, path, e.sha, refs),
                    ]);
                  }}
                >
                  <span className="reflog-action">{e.action}</span>
                  <span className="reflog-message">{e.message || e.subject}</span>
                  {lost && <span className="reflog-lost">{t("reflog.lost")}</span>}
                  <span className="mono muted">{e.sha.slice(0, 7)}</span>
                  <span className="muted reflog-time">{ago(e.time)}</span>
                </button>
                {missing === i && (
                  <p className="details-note muted reflog-missing" role="status">
                    {t("reflog.notInGraph")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
