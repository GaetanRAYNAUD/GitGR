// Résolution d'un fichier en conflit, ouverte à la place du graphe (bouton « Résoudre » des
// modifications en cours). Chaque bloc en conflit montre ses deux côtés (et la version commune
// si git l'a écrite) et, tout de suite, un résultat proposé « A puis B » (marqué « à
// vérifier ») ; un choix rapide (A, B, A puis B, B puis A, aucun) remplace ce résultat,
// qui reste éditable directement : taper, corriger, supprimer, et Alt+↑ / Alt+↓ pour monter ou
// descendre des lignes. Rien n'est ajouté « à la suite » dans l'ordre des clics : le résultat
// d'un bloc est à sa place dans le fichier. « Enregistrer » écrit le fichier et le marque
// résolu (`git add`) une fois tous les blocs résolus.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { chooseLines, composeResolution, moveLines, parseConflicts, type ConflictBlock, type ConflictChoice } from "../../lib/conflicts";
import { errorMessage } from "../../lib/errors";
import { useApp } from "../../store/app";
import { useConflictView } from "../../store/range";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";

const CHOICES: ConflictChoice[] = ["ours", "theirs", "ours-theirs", "theirs-ours", "none"];
/** Au-delà, une partie commune est résumée (premières et dernières lignes). */
const COMMON_MAX = 8;
const COMMON_EDGE = 3;

export function ConflictView({ path, file }: { path: string; file: string }) {
  const { t } = useTranslation();
  const close = useConflictView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Résultat de chaque bloc (lignes séparées par `\n`) ; `null` : pas encore résolu. */
  const [results, setResults] = useState<(string | null)[]>([]);
  /** Blocs choisis ou modifiés (les autres gardent la proposition par défaut, « A puis B »). */
  const [reviewed, setReviewed] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.conflictText(path, file).then(
      (s) => live && setText(s),
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, file]);

  const parsed = useMemo(() => (text === null ? null : parseConflicts(text)), [text]);
  const blocks = useMemo(() => (parsed?.segments.filter((s) => s.kind === "conflict") ?? []) as ConflictBlock[], [parsed]);
  // Rendu tout de suite : chaque bloc part des deux côtés (A puis B), à ajuster.
  useEffect(() => {
    setResults(blocks.map((b) => chooseLines(b, "ours-theirs").join("\n")));
    setReviewed(blocks.map(() => false));
  }, [blocks]);

  const setResult = (k: number, value: string | null) => {
    setResults((r) => r.map((x, i) => (i === k ? value : x)));
    setReviewed((r) => r.map((x, i) => i === k || x));
  };
  const choose = (k: number, choice: ConflictChoice) => setResult(k, chooseLines(blocks[k], choice).join("\n"));
  const chooseAll = (choice: ConflictChoice) => {
    setResults(blocks.map((b) => chooseLines(b, choice).join("\n")));
    setReviewed(blocks.map(() => true));
  };
  const remaining = results.filter((r) => r === null).length;
  const unreviewed = reviewed.filter((r) => !r).length;
  const status = remaining
    ? t("conflict.remaining", { count: remaining })
    : unreviewed
      ? t("conflict.unreviewed", { count: unreviewed })
      : t("conflict.allResolved");
  const oursLabel = blocks[0]?.oursLabel || "HEAD";
  const theirsLabel = blocks[0]?.theirsLabel || t("conflict.theirs");

  const save = async () => {
    if (!parsed || remaining > 0) return;
    setSaving(true);
    const content = composeResolution(
      parsed,
      results.map((r) => (r === null ? null : r === "" ? [] : r.split("\n"))),
    );
    try {
      await api.resolveConflict(path, file, content);
      await useApp.getState().refreshRepo(path);
      useApp.getState().notify(t("conflict.saved", { file }));
      back();
    } catch (e) {
      setError(errorCode(e));
      setSaving(false);
    }
  };

  let k = -1;
  return (
    <section className="pull-view conflict-view" aria-label={t("conflict.label", { file })}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="merge" size={15} />
        <span className="pull-view-title mono" title={file}>
          {t("conflict.title", { file })}
        </span>
        {parsed && blocks.length > 0 && (
          <span className={remaining ? "conflict-status conflict-left" : "conflict-status muted"} role="status" title={status}>
            {status}
          </span>
        )}
        {parsed && blocks.length > 0 && (
          <>
            <button className="btn sm" onClick={() => chooseAll("ours")} title={t("conflict.allHint", { side: oursLabel })}>
              {t("conflict.allOurs", { side: oursLabel })}
            </button>
            <button className="btn sm" onClick={() => chooseAll("theirs")} title={t("conflict.allHint", { side: theirsLabel })}>
              {t("conflict.allTheirs", { side: theirsLabel })}
            </button>
          </>
        )}
        <button className="btn sm primary" disabled={!parsed || remaining > 0 || saving} onClick={() => void save()}>
          {t("conflict.save")}
        </button>
      </header>
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !parsed ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : (
        <div className="conflict-body">
          {blocks.length === 0 && <p className="details-note muted">{t("conflict.noMarkers")}</p>}
          {parsed.segments.map((seg, i) => {
            if (seg.kind === "common") {
              const long = seg.lines.length > COMMON_MAX;
              const shown = long ? [...seg.lines.slice(0, COMMON_EDGE), null, ...seg.lines.slice(-COMMON_EDGE)] : seg.lines;
              return (
                <pre key={i} className="conflict-common mono">
                  {shown.map((l, j) =>
                    l === null ? (
                      <span key={j} className="conflict-skip">
                        {t("conflict.skipped", { count: seg.lines.length - 2 * COMMON_EDGE })}
                        {"\n"}
                      </span>
                    ) : (
                      `${l}\n`
                    ),
                  )}
                </pre>
              );
            }
            k++;
            const n = k;
            const result = results[n] ?? null;
            const rows = result === null ? 0 : Math.max(2, result.split("\n").length + 1);
            return (
              <div key={i} className={result === null ? "conflict-block open" : reviewed[n] ? "conflict-block done" : "conflict-block proposed"} role="group" aria-label={t("conflict.block", { index: n + 1, count: blocks.length })}>
                <div className="conflict-head">
                  <span>{t("conflict.block", { index: n + 1, count: blocks.length })}</span>
                  <span className="conflict-choices">
                    {CHOICES.map((c) => (
                      <button key={c} className="mini" onClick={() => choose(n, c)}>
                        {t(`conflict.choice.${c}`, { ours: seg.oursLabel || "A", theirs: seg.theirsLabel || "B" })}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="conflict-sides">
                  <div className="conflict-side ours">
                    <div className="conflict-side-h">A · {seg.oursLabel || t("conflict.ours")}</div>
                    <pre className="mono">{seg.ours.map((l) => `${l}\n`).join("") || " "}</pre>
                  </div>
                  <div className="conflict-side theirs">
                    <div className="conflict-side-h">B · {seg.theirsLabel || t("conflict.theirs")}</div>
                    <pre className="mono">{seg.theirs.map((l) => `${l}\n`).join("") || " "}</pre>
                  </div>
                </div>
                {seg.base && (
                  <details className="conflict-base">
                    <summary>{t("conflict.base")}</summary>
                    <pre className="mono">{seg.base.map((l) => `${l}\n`).join("") || " "}</pre>
                  </details>
                )}
                <div className="conflict-result">
                  <div className="conflict-side-h">
                    {t("conflict.result")}
                    {result !== null && (
                      <button className="mini" onClick={() => setResult(n, null)}>
                        {t("conflict.reset")}
                      </button>
                    )}
                  </div>
                  {result === null ? (
                    <p className="muted conflict-pending">
                      {t("conflict.pending")}{" "}
                      <button className="link" onClick={() => setResult(n, "")}>
                        {t("conflict.write")}
                      </button>
                    </p>
                  ) : (
                    <textarea
                      className="mono conflict-edit"
                      value={result}
                      rows={rows}
                      spellCheck={false}
                      aria-label={t("conflict.resultOf", { index: n + 1 })}
                      title={t("conflict.editHint")}
                      onChange={(e) => setResult(n, e.target.value)}
                      onKeyDown={(e) => {
                        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                        e.preventDefault();
                        const el = e.currentTarget;
                        const moved = moveLines(el.value, el.selectionStart, el.selectionEnd, e.key === "ArrowUp" ? -1 : 1);
                        if (!moved) return;
                        setResult(n, moved.text);
                        requestAnimationFrame(() => el.setSelectionRange(moved.start, moved.end));
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
