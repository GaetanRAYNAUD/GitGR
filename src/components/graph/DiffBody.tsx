// Corps d'un diff (partagé par le diff d'un commit et celui de la copie de travail) :
// états de chargement / erreur, hunks en une colonne (inline) ou côte à côte (split),
// actions par bloc et sélection de lignes.

import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import type { DiffLine, DiffViewSetting, FileDiff, Hunk } from "../../lib/types";
import { DIFF_WORD_BUDGET, hunkItems, hunkWordDiffs, type Segment } from "../../lib/wordDiff";
import { useApp } from "../../store/app";
import { Icon } from "../Icon";

/** Clé d'une ligne sélectionnée : `hunk:ligne`. */
export const lineKey = (hunk: number, line: number) => `${hunk}:${line}`;

/** Échap ferme le diff (les menus ouverts consomment Échap avant, cf. useDismiss). */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

/** Bascule inline / côte à côte, mémorisée dans les réglages. */
export function DiffViewToggle() {
  const { t } = useTranslation();
  const view = useApp((s) => s.settings.diffView ?? "inline");
  const update = useApp((s) => s.updateSettings);
  const options: DiffViewSetting[] = ["inline", "split"];
  return (
    <div className="view-toggle" role="group" aria-label={t("diff.view")}>
      {options.map((o) => (
        <button
          key={o}
          className={view === o ? "on" : undefined}
          aria-pressed={view === o}
          aria-label={t(`diff.${o}`)}
          title={t(`diff.${o}`)}
          onClick={() => update({ diffView: o })}
        >
          <Icon name={o} size={14} />
        </button>
      ))}
    </div>
  );
}

interface Selection {
  selected: Set<string>;
  toggle: (hunk: number, line: number, range: boolean) => void;
}

interface Props {
  data?: FileDiff;
  error?: string;
  /** Boutons affichés dans l'en-tête de chaque bloc. */
  hunkActions?: (hunk: number) => ReactNode;
  /** Sélection de lignes modifiées (copie de travail). */
  selection?: Selection;
}

/** Une ligne repérée par sa position dans le hunk (pour la sélection). */
interface Indexed {
  l: DiffLine;
  i: number;
}

/** Lignes côte à côte : contexte des deux côtés, et dans chaque groupe de changements les
 *  suppressions (à gauche) appariées aux ajouts (à droite) dans l'ordre — les mêmes paires
 *  que la comparaison mot à mot (`hunkItems`). */
export function splitRows(h: Hunk): { left?: Indexed; right?: Indexed }[] {
  const at = (i: number | undefined): Indexed | undefined => (i === undefined ? undefined : { l: h.lines[i], i });
  return hunkItems(h).flatMap((item) => {
    if ("context" in item) return [{ left: at(item.context), right: at(item.context) }];
    return Array.from({ length: Math.max(item.dels.length, item.adds.length) }, (_, k) => ({
      left: at(item.dels[k]),
      right: at(item.adds[k]),
    }));
  });
}

function HunkHeader({ h, hi, cols, hunkActions }: { h: Hunk; hi: number; cols: number; hunkActions?: (hunk: number) => ReactNode }) {
  return (
    <tr className="diff-hunk">
      <td colSpan={cols}>
        <div className="hunk-head">
          <span className="hunk-title">{h.header}</span>
          {hunkActions && <span className="hunk-actions">{hunkActions(hi)}</span>}
        </div>
      </td>
    </tr>
  );
}

/** Texte d'une ligne, avec les parties modifiées surlignées quand on les connaît. */
function LineText({ segments, text }: { segments?: Segment[]; text: string }) {
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((seg, k) =>
        seg.changed ? (
          <span key={k} className="hl">
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

export function DiffBody({ data, error, hunkActions, selection }: Props) {
  const { t } = useTranslation();
  const mode = useApp((s) => s.settings.diffView ?? "inline");
  // Mots réellement modifiés dans chaque ligne changée (suppression ↔ ajout appariés).
  const words = useMemo(() => {
    const budget = { left: DIFF_WORD_BUDGET };
    return data?.hunks.map((h) => hunkWordDiffs(h, budget)) ?? [];
  }, [data]);
  if (error) {
    return (
      <div className="notice error" role="alert">
        <Icon name="alert" />
        {errorMessage(t, error)}
      </div>
    );
  }
  if (!data) return <p className="muted">{t("diff.loading")}</p>;
  if (data.binary) return <p className="muted">{t("diff.binary")}</p>;
  if (data.hunks.length === 0) return <p className="muted">{data.truncated ? t("diff.tooBig") : t("diff.empty")}</p>;

  const isSel = (hi: number, li: number) => !!selection?.selected.has(lineKey(hi, li));
  /** Clic (Maj+clic : plage) sur une ligne modifiée, si la sélection est active. */
  const picker = (hi: number, x: Indexed | undefined) =>
    selection && x && x.l.kind !== " "
      ? (e: React.MouseEvent) => {
          e.preventDefault();
          selection.toggle(hi, x.i, e.shiftKey);
        }
      : undefined;
  const kindCls = (l: DiffLine) => (l.kind === "+" ? "add" : l.kind === "-" ? "del" : "");

  const inline = data.hunks.map((h, hi) => [
    <HunkHeader key={`h${hi}`} h={h} hi={hi} cols={3} hunkActions={hunkActions} />,
    ...h.lines.map((l, li) => {
      const changed = l.kind !== " ";
      const cls = [kindCls(l), isSel(hi, li) ? "picked" : ""].filter(Boolean).join(" ");
      return (
        <tr
          key={`${hi}-${li}`}
          className={cls || undefined}
          onMouseDown={picker(hi, { l, i: li })}
          aria-selected={selection && changed ? isSel(hi, li) : undefined}
        >
          <td className="ln">{l.old ?? ""}</td>
          <td className="ln">{l.new ?? ""}</td>
          <td className="code">
            <span className="sign" aria-hidden="true">
              {l.kind}
            </span>
            <LineText segments={words[hi]?.get(li)} text={l.text} />
          </td>
        </tr>
      );
    }),
  ]);

  const side = (hi: number, x: Indexed | undefined, which: "old" | "new") => {
    if (!x) return [<td key={`${which}-ln`} className="ln empty" />, <td key={`${which}-code`} className="code empty" />];
    const changed = x.l.kind !== " ";
    const cls = [kindCls(x.l), isSel(hi, x.i) ? "picked" : ""].filter(Boolean).join(" ");
    return [
      <td key={`${which}-ln`} className={`ln ${cls}`} onMouseDown={picker(hi, x)}>
        {x.l[which] ?? ""}
      </td>,
      <td
        key={`${which}-code`}
        className={`code ${cls}`}
        onMouseDown={picker(hi, x)}
        aria-selected={selection && changed ? isSel(hi, x.i) : undefined}
      >
        <LineText segments={words[hi]?.get(x.i)} text={x.l.text} />
      </td>,
    ];
  };

  const split = data.hunks.map((h, hi) => [
    <HunkHeader key={`h${hi}`} h={h} hi={hi} cols={4} hunkActions={hunkActions} />,
    ...splitRows(h).map((r, k) => (
      <tr key={`${hi}-${k}`}>
        {side(hi, r.left, "old")}
        {side(hi, r.right, "new")}
      </tr>
    )),
  ]);

  const cls = ["diff-table", mode === "split" ? "split" : "", selection ? "selectable" : ""].filter(Boolean).join(" ");
  return (
    <>
      <table className={cls}>
        {mode === "split" && (
          <colgroup>
            <col className="col-ln" />
            <col className="col-code" />
            <col className="col-ln" />
            <col className="col-code" />
          </colgroup>
        )}
        <tbody>{mode === "split" ? split : inline}</tbody>
      </table>
      {data.truncated && <p className="notice diff-truncated">{t("diff.truncated")}</p>}
    </>
  );
}
