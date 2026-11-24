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
import { chooseLines, composeResolution, moveLines, parseConflicts, pickLines, picksOf, sideDiff, type LinePicks, type ConflictBlock, type ConflictChoice } from "../../lib/conflicts";
import { errorMessage } from "../../lib/errors";
import { useApp } from "../../store/app";
import { useConflictView } from "../../store/range";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";

const CHOICES: ConflictChoice[] = ["ours", "theirs", "ours-theirs", "theirs-ours", "none"];
/** Lignes communes montrées avant et après chaque bloc, de part et d'autre. */
const CONTEXT = 3;

type PreviewLine = { text: string; state: "common" | "open" | "proposed" | "done"; block: number | null };

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
  /** Lignes cochées de chaque côté, par bloc (le résultat en découle quand on en coche une). */
  const [picks, setPicks] = useState<LinePicks[]>([]);
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
    setPicks(blocks.map((b) => picksOf(b, "ours-theirs")));
  }, [blocks]);

  const setResult = (k: number, value: string | null) => {
    setResults((r) => r.map((x, i) => (i === k ? value : x)));
    setReviewed((r) => r.map((x, i) => i === k || x));
  };
  const setPick = (k: number, p: LinePicks) => setPicks((all) => all.map((x, i) => (i === k ? p : x)));
  const choose = (k: number, choice: ConflictChoice) => {
    setPick(k, picksOf(blocks[k], choice));
    setResult(k, chooseLines(blocks[k], choice).join("\n"));
  };
  /** Coche ou décoche une ligne d'un côté : le résultat est refait à partir des lignes cochées,
   *  chacune à sa place logique (pas dans l'ordre des clics). */
  const toggleLine = (k: number, side: keyof LinePicks, index: number) => {
    const cur = picks[k] ?? { ours: [], theirs: [] };
    const list = cur[side].includes(index) ? cur[side].filter((x) => x !== index) : [...cur[side], index];
    const next = { ...cur, [side]: list };
    setPick(k, next);
    setResult(k, pickLines(blocks[k], next).join("\n"));
  };
  const chooseAll = (choice: ConflictChoice) => {
    setResults(blocks.map((b) => chooseLines(b, choice).join("\n")));
    setPicks(blocks.map((b) => picksOf(b, choice)));
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

  // Fichier résultant, ligne par ligne, avec d'où vient chaque ligne (partie commune, bloc).
  const preview = useMemo((): PreviewLine[] => {
    if (!parsed) return [];
    const out: PreviewLine[] = [];
    let b = 0;
    for (const seg of parsed.segments) {
      if (seg.kind === "common") {
        for (const l of seg.lines) out.push({ text: l, state: "common", block: null });
        continue;
      }
      const r = results[b];
      const state = r === null || r === undefined ? "open" : reviewed[b] ? "done" : "proposed";
      const lines =
        r === null || r === undefined
          ? ["<<<<<<< " + seg.oursLabel, ...seg.ours, "=======", ...seg.theirs, ">>>>>>> " + seg.theirsLabel]
          : r === ""
            ? []
            : r.split("\n");
      // Bloc vide (« Aucun ») : une ligne repère, pour savoir où il était.
      if (!lines.length) out.push({ text: "", state, block: b });
      else for (const l of lines) out.push({ text: l, state, block: b });
      b++;
    }
    return out;
  }, [parsed, results, reviewed]);

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
              // Ce que le contexte des blocs voisins ne montre pas : résumé, à lire en bas.
              const shown = (parsed.segments[i - 1] ? CONTEXT : 0) + (parsed.segments[i + 1] ? CONTEXT : 0);
              const hidden = seg.lines.length - shown;
              return hidden > 0 ? (
                <p key={i} className="conflict-skip">
                  {t("conflict.skipped", { count: hidden })}
                </p>
              ) : null;
            }
            k++;
            const prev = parsed.segments[i - 1];
            const next = parsed.segments[i + 1];
            const before = prev?.kind === "common" ? prev.lines.slice(-CONTEXT) : [];
            const after = next?.kind === "common" ? next.lines.slice(0, CONTEXT) : [];
            // Couleurs : chaque côté comparé à la version commune (diff3), sinon à l'autre côté.
            const side = (which: keyof LinePicks, lines: string[], other: string[]) => {
              let index = -1;
              const picked = new Set(picks[n]?.[which] ?? []);
              return (
              <pre className="mono">
                {before.map((l, j) => (
                  <span key={`b${j}`} className="conflict-ctx">{`${l}\n`}</span>
                ))}
                <span className="conflict-lines">
                  {lines.length === 0 && seg.base === null && other.length === 0 ? "\n" : null}
                  {sideDiff(seg.base ?? other, lines).map((l, j) => {
                    if (l.kind === "del")
                      return (
                        <span key={j} className="cl cl-del" title={t("conflict.kind.del")}>
                          {`${l.text}\n`}
                        </span>
                      );
                    const at = ++index;
                    const on = picked.has(at);
                    return (
                      <span
                        key={j}
                        role="checkbox"
                        aria-checked={on}
                        tabIndex={0}
                        className={`cl cl-${l.kind} pickable${on ? " picked" : ""}`}
                        title={[l.kind === "same" ? null : t(`conflict.kind.${l.kind}`), t("conflict.pickHint")].filter(Boolean).join(" · ")}
                        onClick={() => toggleLine(n, which, at)}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            toggleLine(n, which, at);
                          }
                        }}
                      >{`${l.text}\n`}</span>
                    );
                  })}
                </span>
                {after.map((l, j) => (
                  <span key={`a${j}`} className="conflict-ctx">{`${l}\n`}</span>
                ))}
              </pre>
              );
            };
            const n = k;
            const result = results[n] ?? null;
            const rows = result === null ? 0 : Math.max(2, result.split("\n").length + 1);
            return (
              <div key={i} className={result === null ? "conflict-block open" : reviewed[n] ? "conflict-block done" : "conflict-block proposed"} role="group" aria-label={t("conflict.block", { index: n + 1, count: blocks.length })}>
                <div className="conflict-head">
                  <button className="link" title={t("conflict.showInFile")} onClick={() => document.getElementById(`cprev-${n}`)?.scrollIntoView({ block: "center" })}>
                    {t("conflict.block", { index: n + 1, count: blocks.length })}
                  </button>
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
                    <div className="conflict-side-h" title={seg.base ? t("conflict.vsBase") : t("conflict.vsOther")}>
                      A · {seg.oursLabel || t("conflict.ours")}
                    </div>
                    {side("ours", seg.ours, seg.theirs)}
                  </div>
                  <div className="conflict-side theirs">
                    <div className="conflict-side-h" title={seg.base ? t("conflict.vsBase") : t("conflict.vsOther")}>
                      B · {seg.theirsLabel || t("conflict.theirs")}
                    </div>
                    {side("theirs", seg.theirs, seg.ours)}
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
      {parsed && (
        <div className="conflict-preview" role="region" aria-label={t("conflict.preview")}>
          <div className="conflict-preview-h">{t("conflict.previewTitle", { count: preview.length })}</div>
          <div className="conflict-preview-body">
            <table className="mono">
              <tbody>
                {preview.map((l, i) => (
                  <tr
                    key={i}
                    id={l.block !== null && preview[i - 1]?.block !== l.block ? `cprev-${l.block}` : undefined}
                    className={l.state === "common" ? undefined : `pv-${l.state}`}
                  >
                    <td className="ln">{i + 1}</td>
                    <td className="pv-text">{l.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
