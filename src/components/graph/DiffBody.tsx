// Corps d'un diff (partagé par le diff d'un commit et celui de la copie de travail) :
// états de chargement / erreur, hunks en une colonne (inline) ou côte à côte (split),
// actions par bloc et sélection de lignes. Au clavier, une grille à une seule tabulation :
// une ligne active que les flèches déplacent (F7 : bloc suivant).

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { clamp, DIFF_LN_W as LN_W, diffSplitBounds, LAYOUT, useLayoutValue } from "../../lib/layout";
import type { DiffLine, DiffViewSetting, FileDiff, Hunk, LineRef } from "../../lib/types";
import { DIFF_WORD_BUDGET, hunkItems, hunkWordDiffs, type Segment } from "../../lib/wordDiff";
import { useApp } from "../../store/app";
import { openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { Splitter } from "../Splitter";
import { type BlameSource, MARGIN_W, useBlameMargin } from "./BlameMargin";

/** Clé d'une ligne sélectionnée : `hunk:ligne`. */
export const lineKey = (hunk: number, line: number) => `${hunk}:${line}`;

/** Ordre d'affichage de deux lignes d'un diff (bloc, puis rang dans le bloc). */
export const compareLines = (a: LineRef, b: LineRef) => a.hunk - b.hunk || a.line - b.line;

/** Échap ferme le diff ou la vue (les menus ouverts consomment Échap avant, cf. useDismiss),
 *  sauf pendant une saisie : un commentaire commencé n'est pas perdu. */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}

/** À la fermeture d'une vue qui avait le focus, le rend à l'élément qui l'avait avant d'y
 *  entrer (la ligne du fichier dans la liste), au lieu de le laisser tomber sur le graphe. */
export function useReturnFocus(ref: RefObject<HTMLElement | null>) {
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body && !ref.current?.contains(a)) last.current = a;
    const onIn = (e: FocusEvent) => {
      const el = e.target;
      // Une confirmation ou un menu passent : on garde l'élément d'avant.
      if (el instanceof HTMLElement && !ref.current?.contains(el) && !el.closest('[role="dialog"], [role="alertdialog"], [role="menu"]'))
        last.current = el;
    };
    document.addEventListener("focusin", onIn);
    return () => document.removeEventListener("focusin", onIn);
  }, [ref]);
  return useCallback(() => {
    const a = document.activeElement;
    const inside = !a || a === document.body || !!ref.current?.contains(a);
    if (inside && last.current?.isConnected) last.current.focus();
  }, [ref]);
}

let annotateToggles = 0;
function onAnnotateKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
  e.preventDefault();
  const s = useApp.getState();
  s.updateSettings({ diffBlame: !s.settings.diffBlame });
}

/** Bascule « Annoter » (marge de blame, Ctrl+Alt+B), mémorisée dans les réglages ; à placer
 *  dans un groupe `.view-toggle`. */
export function AnnotateToggle() {
  const { t } = useTranslation();
  const annotate = useApp((s) => !!s.settings.diffBlame);
  const update = useApp((s) => s.updateSettings);
  useEffect(() => {
    // Un seul écouteur, même si deux bascules sont montées (sinon Ctrl+Alt+B s'annulerait).
    if (annotateToggles++ === 0) window.addEventListener("keydown", onAnnotateKey);
    return () => {
      if (--annotateToggles === 0) window.removeEventListener("keydown", onAnnotateKey);
    };
  }, []);
  return (
    <button
      className={annotate ? "on" : undefined}
      aria-pressed={annotate}
      aria-label={t("diff.blame")}
      title={`${t("diff.blame")} (Ctrl+Alt+B)`}
      onClick={() => update({ diffBlame: !annotate })}
    >
      <Icon name="user" size={14} />
    </button>
  );
}

/** Bascules du diff, mémorisées dans les réglages : marge de blame (Ctrl+Alt+B), fichier
 *  entier, sans les espaces, et en ligne / côte à côte. */
export function DiffViewToggle() {
  const { t } = useTranslation();
  const view = useApp((s) => s.settings.diffView ?? "inline");
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const full = useApp((s) => !!s.settings.diffFull);
  const update = useApp((s) => s.updateSettings);
  const options: DiffViewSetting[] = ["inline", "split"];
  return (
    <span className="diff-tools">
      <span className="view-toggle">
        <AnnotateToggle />
        <button className={full ? "on" : undefined} aria-pressed={full} aria-label={t("diff.full")} title={t("diff.full")} onClick={() => update({ diffFull: !full })}>
          <Icon name="file" size={14} />
        </button>
        <button
          className={ignoreWs ? "on" : undefined}
          aria-pressed={ignoreWs}
          aria-label={t("diff.ignoreWs")}
          title={t("diff.ignoreWs")}
          onClick={() => update({ diffIgnoreWs: !ignoreWs })}
        >
          <Icon name="whitespace" size={14} />
        </button>
      </span>
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
    </span>
  );
}

/** Ne montre son contenu qu'après un court délai : un chargement rapide ne clignote pas. */
function Delayed({ ms, children }: { ms: number; children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return on ? <>{children}</> : null;
}

interface Selection {
  selected: Set<string>;
  /** Clic ou Espace : une ligne ; Maj+clic : la plage depuis la dernière ligne cliquée. */
  toggle: (hunk: number, line: number, range: boolean) => void;
  /** Maj+flèches : les lignes modifiées de `from` à `to`, à la place de la sélection. */
  extend: (from: LineRef, to: LineRef) => void;
  /** Ctrl+A : toutes les lignes modifiées. */
  all: () => void;
}

interface Props {
  data?: FileDiff;
  error?: string;
  /** Boutons affichés dans l'en-tête de chaque bloc. */
  hunkActions?: (hunk: number) => ReactNode;
  /** Sélection de lignes modifiées (copie de travail). */
  selection?: Selection;
  /** Entrée (`apply`) ou Suppr (`discard`) dans la grille, sur la ligne active. */
  onKeyAction?: (action: "apply" | "discard", at: LineRef) => void;
  /** Bouton « Réessayer » sous une erreur. */
  onRetry?: () => void;
  /** Change avec le fichier affiché : la ligne active repart du début. */
  resetKey?: string;
  /** Fichier et version de droite, pour la marge de blame (« Annoter »). */
  blame?: BlameSource;
  /** Texte cherché, surligné dans les lignes (recherche dans les modifications). */
  mark?: RegExp | null;
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

/** Toutes les lignes, dans l'ordre d'affichage en ligne (celui de la navigation au clavier). */
export function lineOrder(data: FileDiff | undefined): LineRef[] {
  const out: LineRef[] = [];
  data?.hunks.forEach((h, hunk) => h.lines.forEach((_, line) => out.push({ hunk, line })));
  return out;
}

/** Ligne visée par F7 (bloc suivant) ou Maj+F7 (précédent) : la première ligne modifiée du
 *  bloc, `-1` s'il n'y en a pas. Maj+F7 au milieu d'un bloc revient d'abord à son début. */
export function hunkJump(data: FileDiff, order: LineRef[], cur: number, back: boolean): number {
  const firstChange = (hunk: number) => {
    const h = data.hunks[hunk];
    const line = Math.max(0, h.lines.findIndex((l) => l.kind !== " "));
    return order.findIndex((r) => r.hunk === hunk && r.line === line);
  };
  const at = order[cur];
  if (!at) return order.length ? firstChange(0) : -1;
  if (!back) return at.hunk + 1 < data.hunks.length ? firstChange(at.hunk + 1) : -1;
  const start = firstChange(at.hunk);
  if (cur > start) return start;
  return at.hunk > 0 ? firstChange(at.hunk - 1) : -1;
}

function HunkHeader({
  h,
  hi,
  cols,
  id,
  hunkActions,
}: {
  h: Hunk;
  hi: number;
  cols: number;
  id: string;
  hunkActions?: (hunk: number) => ReactNode;
}) {
  return (
    <tr className="diff-hunk" id={id} role="row">
      <td colSpan={cols} role="gridcell">
        <div className="hunk-head">
          <span className="hunk-title">{h.header}</span>
          {hunkActions && <span className="hunk-actions">{hunkActions(hi)}</span>}
        </div>
      </td>
    </tr>
  );
}

/** Positions `[début, fin)` des correspondances de `mark` (expression globale) dans `text`. */
export function markRanges(text: string, mark: RegExp | null | undefined): [number, number][] {
  if (!mark || !text) return [];
  const out: [number, number][] = [];
  mark.lastIndex = 0;
  for (let m = mark.exec(text); m; m = mark.exec(text)) {
    // Une correspondance vide n'avance pas : on saute d'un caractère.
    if (!m[0]) mark.lastIndex++;
    else out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/** Texte d'une ligne, avec les parties modifiées surlignées quand on les connaît, et le texte
 *  cherché marqué — sur la ligne entière, même à cheval sur un mot modifié. */
function LineText({ segments, text, mark }: { segments?: Segment[]; text: string; mark?: RegExp | null }) {
  const ranges = markRanges(text, mark);
  if (!segments && !ranges.length) return <>{text}</>;
  const segs = segments ?? [{ text, changed: false }];
  // Coupures : bords des segments et des correspondances.
  const out: ReactNode[] = [];
  let at = 0;
  segs.forEach((seg, k) => {
    const end = at + seg.text.length;
    const cuts = new Set([at, end]);
    for (const [s, e] of ranges) {
      if (s > at && s < end) cuts.add(s);
      if (e > at && e < end) cuts.add(e);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const parts: ReactNode[] = [];
    for (let p = 0; p < points.length - 1; p++) {
      const [s, e] = [points[p], points[p + 1]];
      const piece = text.slice(s, e);
      const hit = ranges.some(([rs, re]) => s >= rs && e <= re);
      parts.push(
        hit ? (
          <mark key={s} className="diff-find">
            {piece}
          </mark>
        ) : (
          <Fragment key={s}>{piece}</Fragment>
        ),
      );
    }
    out.push(
      seg.changed ? (
        <span key={k} className="hl">
          {parts}
        </span>
      ) : (
        <Fragment key={k}>{parts}</Fragment>
      ),
    );
    at = end;
  });
  return <>{out}</>;
}

const PAGE = 20;

export function DiffBody({ data, error, hunkActions, selection, onKeyAction, onRetry, resetKey, blame, mark }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const mode = useApp((s) => s.settings.diffView ?? "inline");
  const ignoreWs = useApp((s) => !!s.settings.diffIgnoreWs);
  const annotate = useApp((s) => !!s.settings.diffBlame);
  const update = useApp((s) => s.updateSettings);
  const margin = useBlameMargin(blame);
  // Côte à côte : part de la largeur donnée au texte de gauche (absente = moitié-moitié).
  const saved = useLayoutValue(LAYOUT.diffSplit);
  const setLayout = useApp((s) => s.setLayout);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // Largeur de la table côte à côte : la part enregistrée est rebornée si la fenêtre rétrécit.
  const [wrapW, setWrapW] = useState(0);
  const hasWrap = mode === "split" && !!data && !error && !data.binary && data.hunks.length > 0;
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!hasWrap || !el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, [hasWrap]);
  // Largeur de la marge de blame, retirée de la place des deux versions.
  const annW = margin ? MARGIN_W : 0;
  const ratio = saved === undefined ? undefined : clamp(saved, diffSplitBounds(Math.max(0, wrapW - annW)));
  // Mots réellement modifiés dans chaque ligne changée (suppression ↔ ajout appariés).
  const words = useMemo(() => {
    const budget = { left: DIFF_WORD_BUDGET };
    return data?.hunks.map((h) => hunkWordDiffs(h, budget)) ?? [];
  }, [data]);

  const order = useMemo(() => lineOrder(data), [data]);
  // Ligne active (rang dans `order`), -1 tant que la grille n'a pas eu le focus. Gardée,
  // rebornée, quand le diff change après une indexation : on continue au même endroit.
  const [active, setActive] = useState(-1);
  const anchor = useRef(-1);
  // Anneau de la ligne active : au clavier seulement, pas après un clic.
  const [kbd, setKbd] = useState(false);
  const scrollTo = useRef<string | null>(null);
  // Focus donné par un clic sur une ligne : elle est déjà active, onFocus n'en choisit pas d'autre.
  const pointerFocus = useRef(false);
  useEffect(() => {
    setActive(-1);
    anchor.current = -1;
  }, [resetKey]);
  const cur = order.length ? Math.min(active, order.length - 1) : -1;

  // Largeur des numéros de ligne (chiffres du plus grand), pour les figer à gauche.
  const lnDigits = useMemo(() => {
    let max = 0;
    for (const h of data?.hunks ?? []) for (const l of h.lines) max = Math.max(max, l.old ?? 0, l.new ?? 0);
    return Math.max(3, String(max).length);
  }, [data]);

  useLayoutEffect(() => {
    const id = scrollTo.current;
    scrollTo.current = null;
    const table = tableRef.current;
    const box = table?.closest<HTMLElement>(".diff-body");
    const el = id ? document.getElementById(id) : null;
    if (!box || !el) return;
    const row = el.closest("tr") ?? el;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  });

  if (error) {
    return (
      <div className="notice error" role="alert">
        <Icon name="alert" />
        <span>{errorMessage(t, error)}</span>
        {onRetry && (
          <button className="btn sm notice-action" onClick={onRetry}>
            {t("graph.retry")}
          </button>
        )}
      </div>
    );
  }
  if (!data)
    return (
      <Delayed ms={200}>
        <p className="muted">{t("diff.loading")}</p>
      </Delayed>
    );
  if (data.binary) return <p className="muted">{t("diff.binary")}</p>;
  if (data.hunks.length === 0) {
    if (data.truncated) return <p className="muted">{t("diff.tooBig")}</p>;
    if (ignoreWs)
      return (
        <p className="muted diff-empty">
          {t("diff.onlyWs")}{" "}
          <button className="link" onClick={() => update({ diffIgnoreWs: false })}>
            {t("diff.showWs")}
          </button>
        </p>
      );
    return <p className="muted">{t("diff.empty")}</p>;
  }

  const cellId = (hi: number, li: number) => `${uid}-l${hi}-${li}`;
  const hunkId = (hi: number) => `${uid}-h${hi}`;
  const rank = (hi: number, li: number) => order.findIndex((r) => r.hunk === hi && r.line === li);
  const activeRef = cur >= 0 ? order[cur] : undefined;
  const isActive = (hi: number, li: number) => !!activeRef && activeRef.hunk === hi && activeRef.line === li;
  const lineAt = (r: LineRef) => data.hunks[r.hunk]?.lines[r.line];

  const go = (j: number, extend: boolean, target?: string) => {
    if (!order.length) return;
    const k = Math.max(0, Math.min(order.length - 1, j));
    const from = cur < 0 ? k : cur;
    if (extend && selection) {
      if (anchor.current < 0) anchor.current = from;
      selection.extend(order[anchor.current], order[k]);
    } else {
      anchor.current = k;
    }
    setActive(k);
    scrollTo.current = target ?? cellId(order[k].hunk, order[k].line);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTableElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey) return;
    setKbd(true);
    const at = cur < 0 ? 0 : cur;
    const plain = !e.ctrlKey;
    const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
    const moves: Record<string, number> = {
      ArrowDown: cur < 0 ? 0 : at + 1,
      ArrowUp: cur < 0 ? 0 : at - 1,
      PageDown: at + PAGE,
      PageUp: at - PAGE,
      Home: 0,
      End: order.length - 1,
    };
    if (e.key in moves && (plain || e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      return go(moves[e.key], e.shiftKey && vertical);
    }
    if (e.key === "F7" && plain) {
      e.preventDefault();
      const k = hunkJump(data, order, cur, e.shiftKey);
      // L'en-tête du bloc reste en vue avec sa première ligne.
      if (k >= 0) go(k, false, hunkId(order[k].hunk));
      return;
    }
    if (!activeRef) return;
    // B : détails du commit de la ligne (marge de blame) ; Maj+B : ses actions.
    if (margin && plain && e.key.toLowerCase() === "b") {
      const c = margin.at(lineAt(activeRef)?.new);
      if (!c) return;
      e.preventDefault();
      if (!e.shiftKey) margin.pick(c);
      else {
        const box = document.getElementById(cellId(activeRef.hunk, activeRef.line))?.getBoundingClientRect();
        const items = margin.menu(c);
        if (box && items.length) useContextMenu.getState().open(box.left, box.bottom, items);
      }
      return;
    }
    if (e.key === " " && plain && selection) {
      e.preventDefault();
      if (lineAt(activeRef)?.kind !== " ") selection.toggle(activeRef.hunk, activeRef.line, false);
      anchor.current = cur;
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "a" && selection) {
      e.preventDefault();
      selection.all();
      return;
    }
    if (e.key === "Enter" && plain && onKeyAction) {
      e.preventDefault();
      onKeyAction("apply", activeRef);
      return;
    }
    if (e.key === "Delete" && plain && onKeyAction) {
      e.preventDefault();
      onKeyAction("discard", activeRef);
    }
  };

  /** Clic sur une ligne : elle devient active ; si la sélection est active et la ligne
   *  modifiée, elle est cochée (Maj+clic : plage). */
  const picker = (hi: number, x: Indexed | undefined) =>
    x
      ? (e: React.MouseEvent) => {
          setKbd(false);
          const k = rank(hi, x.i);
          if (k >= 0) {
            setActive(k);
            if (!e.shiftKey) anchor.current = k;
          }
          if (selection && x.l.kind !== " ") {
            // Pas de sélection de texte ; le focus reste sur la grille.
            e.preventDefault();
            pointerFocus.current = true;
            tableRef.current?.focus({ preventScroll: true });
            pointerFocus.current = false;
            selection.toggle(hi, x.i, e.shiftKey);
          }
        }
      : undefined;

  const isSel = (hi: number, li: number) => !!selection?.selected.has(lineKey(hi, li));
  const kindCls = (l: DiffLine) => (l.kind === "+" ? "add" : l.kind === "-" ? "del" : "");
  /** Ce qu'entend un lecteur d'écran avant le texte : ajout, suppression, numéro. */
  const srPrefix = (l: DiffLine) =>
    l.kind === "+" ? t("diff.srAdd", { n: l.new }) : l.kind === "-" ? t("diff.srDel", { n: l.old }) : t("diff.srContext", { n: l.new });
  const code = (hi: number, x: Indexed) => (
    <>
      <span className="visually-hidden">{srPrefix(x.l)}</span>
      <span className="sign" aria-hidden="true">
        {x.l.kind === "-" ? "−" : x.l.kind}
      </span>
      <LineText segments={words[hi]?.get(x.i)} text={x.l.text} mark={mark} />
      {x.l.noEol && (
        <span className="no-eol" title={t("diff.noEol")}>
          {t("diff.noEolShort")}
        </span>
      )}
    </>
  );

  // Marge de blame : le commit de chaque ligne de la nouvelle version ; son nom et sa date sur
  // la première ligne d'un bloc du même commit (`prev` : commit de la ligne affichée au-dessus).
  let prev: string | null = null;
  const annCell = (n: number | null | undefined, key: string) => {
    if (!margin) return null;
    const c = margin.at(n);
    const start = !!c && c.sha !== prev;
    prev = c?.sha ?? null;
    return (
      <td
        key={key}
        className={c ? (start ? "ann start" : "ann") : "ann empty"}
        role="gridcell"
        aria-hidden="true"
        style={c ? ({ "--age": margin.age(c).toFixed(2) } as React.CSSProperties) : undefined}
        title={c ? margin.title(c) : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => c && margin.pick(c)}
        onDoubleClick={() => c && margin.reveal(c)}
        onContextMenu={(e) => c && openContextMenu(e, margin.menu(c))}
      >
        {start && c ? margin.label(c) : null}
      </td>
    );
  };
  /** Clic droit sur les numéros : afficher ou masquer la marge. */
  const lnMenu = (e: React.MouseEvent) =>
    openContextMenu(e, [{ label: t(annotate ? "diff.blameHide" : "diff.blameShow"), onClick: () => update({ diffBlame: !annotate }) }]);
  const extra = margin ? 1 : 0;

  const inline = data.hunks.map((h, hi) => [
    <HunkHeader key={`h${hi}`} h={h} hi={hi} cols={3 + extra} id={hunkId(hi)} hunkActions={hunkActions} />,
    ...h.lines.map((l, li) => {
      if (li === 0) prev = null;
      const changed = l.kind !== " ";
      const cls = [kindCls(l), isSel(hi, li) ? "picked" : "", isActive(hi, li) ? "active" : ""].filter(Boolean).join(" ");
      return (
        <tr key={`${hi}-${li}`} role="row" className={cls || undefined} onMouseDown={picker(hi, { l, i: li })}>
          {annCell(l.kind === "-" ? null : l.new, "ann")}
          <td className="ln" role="gridcell" aria-hidden="true" onContextMenu={lnMenu}>
            {l.old ?? ""}
          </td>
          <td className="ln ln2" role="gridcell" aria-hidden="true" onContextMenu={lnMenu}>
            {l.new ?? ""}
          </td>
          <td className="code" role="gridcell" id={cellId(hi, li)} aria-selected={selection && changed ? isSel(hi, li) : undefined}>
            {code(hi, { l, i: li })}
          </td>
        </tr>
      );
    }),
  ]);

  const side = (hi: number, x: Indexed | undefined, which: "old" | "new") => {
    if (!x)
      return [
        <td key={`${which}-ln`} className="ln empty" role="gridcell" aria-hidden="true" />,
        <td key={`${which}-code`} className="code empty" role="gridcell" aria-hidden="true" />,
      ];
    const changed = x.l.kind !== " ";
    // Le contexte paraît des deux côtés : la cellule de droite est celle de la grille.
    const owner = changed || which === "new";
    const cls = [kindCls(x.l), isSel(hi, x.i) ? "picked" : "", owner && isActive(hi, x.i) ? "active" : ""].filter(Boolean).join(" ");
    return [
      <td key={`${which}-ln`} className={`ln ${cls}`} role="gridcell" aria-hidden="true" onMouseDown={picker(hi, x)} onContextMenu={lnMenu}>
        {x.l[which] ?? ""}
      </td>,
      <td
        key={`${which}-code`}
        className={`code ${cls}`}
        role="gridcell"
        id={owner ? cellId(hi, x.i) : undefined}
        aria-hidden={owner ? undefined : true}
        onMouseDown={picker(hi, x)}
        aria-selected={selection && changed ? isSel(hi, x.i) : undefined}
      >
        {code(hi, x)}
      </td>,
    ];
  };

  const split = data.hunks.map((h, hi) => [
    <HunkHeader key={`h${hi}`} h={h} hi={hi} cols={4 + extra} id={hunkId(hi)} hunkActions={hunkActions} />,
    ...splitRows(h).map((r, k) => {
      if (k === 0) prev = null;
      return (
        <tr key={`${hi}-${k}`} role="row">
          {annCell(r.right?.l.new, "ann")}
          {side(hi, r.left, "old")}
          {side(hi, r.right, "new")}
        </tr>
      );
    }),
  ]);

  const cls = ["diff-table", mode === "split" ? "split" : "", selection ? "selectable" : "", kbd ? "kbd" : "", margin ? "annotated" : ""].filter(Boolean).join(" ");
  const grid = {
    ref: tableRef,
    className: cls,
    role: "grid",
    tabIndex: 0,
    "aria-label": t("diff.lines"),
    "aria-description": [t(selection ? "diff.keysSelect" : "diff.keys"), margin ? t("diff.keysBlame") : null].filter(Boolean).join(" "),
    "aria-multiselectable": selection ? true : undefined,
    "aria-activedescendant": activeRef ? cellId(activeRef.hunk, activeRef.line) : undefined,
    style: { "--ln-ch": lnDigits } as React.CSSProperties,
    onKeyDown,
    onFocus: (e: React.FocusEvent<HTMLTableElement>) => {
      if (e.target !== e.currentTarget) return;
      // Arrivée par Tab : l'anneau de la ligne active tout de suite ; par un clic, non.
      setKbd(e.currentTarget.matches(":focus-visible"));
      if (cur >= 0 || pointerFocus.current) return;
      // Premier passage : la première ligne modifiée.
      const k = order.findIndex((r) => lineAt(r)?.kind !== " ");
      setActive(Math.max(0, k));
      anchor.current = Math.max(0, k);
    },
  };
  const table =
    mode === "split" ? (
      <div className="diff-split-wrap" ref={wrapRef}>
        <table {...grid}>
          <colgroup>
            {margin && <col className="col-ann" />}
            <col className="col-ln" />
            <col className="col-code" style={ratio !== undefined ? { width: `${ratio * 100}%` } : undefined} />
            <col className="col-ln" />
            <col className="col-code" />
          </colgroup>
          <tbody>{split}</tbody>
        </table>
        {/* Séparateur entre les deux versions : sa position est la limite gauche des numéros de droite. */}
        <Splitter
          dir="x"
          label={t("layout.diffSplit")}
          className="diff-splitter"
          style={{
            left: ratio !== undefined ? `calc(${LN_W + annW}px + ${ratio * 100}%)` : annW ? `calc(${annW}px + (100% - ${annW}px) / 2)` : "50%",
          }}
          measure={(el) => el.offsetLeft}
          onChange={(x, final) => {
            const w = wrapRef.current?.clientWidth ?? 0;
            if (w > 0) setLayout({ [LAYOUT.diffSplit]: clamp((x - LN_W - annW) / w, diffSplitBounds(w - annW)) }, final);
          }}
          onReset={() => setLayout({ [LAYOUT.diffSplit]: null })}
        />
      </div>
    ) : (
      <table {...grid}>
        <tbody>{inline}</tbody>
      </table>
    );
  return (
    <>
      {annotate && blame?.unavailable && <p className="muted diff-note">{blame.unavailable}</p>}
      {table}
      {data.truncated && <p className="notice diff-truncated">{t("diff.truncated")}</p>}
    </>
  );
}
