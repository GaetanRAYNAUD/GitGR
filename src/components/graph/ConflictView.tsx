// Résolution d'un fichier en conflit, à la place du graphe, en trois panneaux comme dans
// IntelliJ : à gauche notre version, au centre le résultat, à droite l'autre version, alignés
// morceau par morceau et défilant ensemble. Les versions viennent de l'index de git (commune,
// nôtre, autre : `conflict_versions`) et sont fusionnées à trois voies (`lib/merge3.ts`) :
// les modifications sans conflit sont appliquées d'office (comme git l'a fait dans la copie de
// travail), les conflits partent de la version commune. Sur chaque modification : » / « pour
// envoyer un côté dans le résultat (le second s'ajoute après le premier, dans l'ordre des
// clics), X pour l'écarter, la baguette quand le conflit se résout mot à mot, ↺ pour revenir
// au départ. Un clic sur une ligne d'un côté la prend seule (ordre des clics) ; une ligne se
// glisse aussi dans le résultat. Le résultat reste éditable directement (Alt+↑ / Alt+↓
// déplacent des lignes). F7 / Maj+F7 : modification suivante / précédente. « Enregistrer »
// écrit le fichier, le marque résolu, puis ouvre le fichier en conflit suivant.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as KeyEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { moveLines, parseConflicts, sideDiff } from "../../lib/conflicts";
import { errorMessage } from "../../lib/errors";
import {
  acceptAll,
  applySide,
  changedSides,
  composeMerged,
  ignoreSide,
  initialState,
  isResolved,
  magic,
  merge3,
  splitText,
  togglePickLine,
  type ChangeState,
  type Chunk,
  type Side,
} from "../../lib/merge3";
import type { ConflictVersions } from "../../lib/types";
import { wordDiff, type Segment as WordSegment } from "../../lib/wordDiff";
import { useApp } from "../../store/app";
import { useDialogs } from "../../store/dialogs";
import { useConflictView } from "../../store/range";
import { useWork } from "../../store/worktree";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";

type Change = Extract<Chunk, { kind: "change" }>;

/** Lignes identiques gardées visibles autour d'une modification. */
const CONTEXT = 3;

interface Loaded {
  chunks: Chunk[];
  eol: string;
  finalEol: boolean;
  oursLabel: string;
  theirsLabel: string;
  /** La copie de travail n'a plus de marqueurs (déjà résolue à la main ?). */
  noMarkers: boolean;
}

function load(v: ConflictVersions): Loaded {
  const working = splitText(v.working);
  const ours = splitText(v.ours).lines;
  const theirs = splitText(v.theirs).lines;
  const base = v.base === null ? null : splitText(v.base).lines;
  const block = parseConflicts(v.working).segments.find((s) => s.kind === "conflict");
  return {
    chunks: merge3(base, ours, theirs),
    eol: working.eol,
    finalEol: v.working === "" ? v.ours.endsWith("\n") : working.finalEol,
    oursLabel: block?.kind === "conflict" ? block.oursLabel : "",
    theirsLabel: block?.kind === "conflict" ? block.theirsLabel : "",
    noMarkers: !block,
  };
}

/** Lignes d'un côté d'une modification, avec les mots changés par rapport à la version
 *  commune (ou à l'autre côté, sans elle). */
function sideLines(c: Change, side: Side): { text: string; words: WordSegment[] | null; changed: boolean }[] {
  const lines = side === "ours" ? c.ours : c.theirs;
  if (!changedSides(c).includes(side)) return lines.map((text) => ({ text, words: null, changed: false }));
  const ref = c.base ?? (side === "ours" ? c.theirs : c.ours);
  return sideDiff(ref, lines)
    .filter((l) => l.kind !== "del")
    .map((l) => ({ text: l.text, words: l.kind === "mod" && l.ref !== undefined ? (wordDiff(l.ref, l.text)?.new ?? null) : null, changed: l.kind !== "same" }));
}

function Words({ text, words }: { text: string; words: WordSegment[] | null }) {
  if (!words) return <>{text || " "}</>;
  return (
    <>
      {words.map((w, i) => (w.changed ? <mark key={i}>{w.text}</mark> : <span key={i}>{w.text}</span>))}
    </>
  );
}

export function ConflictView({ path, file }: { path: string; file: string }) {
  const { t } = useTranslation();
  const close = useConflictView((s) => s.close);
  const show = useConflictView((s) => s.show);
  const back = useCallback(() => close(path), [close, path]);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<ChangeState[]>([]);
  /** Parties identiques dépliées (indice du morceau). */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  /** Modification courante (navigation F7). */
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const conflicted = useWork((s) => s.repos[path]?.status?.conflicted);
  const files = useMemo(() => (conflicted ?? []).map((f) => f.path), [conflicted]);

  useEffect(() => {
    let live = true;
    api.conflictVersions(path, file).then(
      (v) => {
        if (!live) return;
        const d = load(v);
        setData(d);
        setStates(d.chunks.filter((c): c is Change => c.kind === "change").map((c) => initialState(c)));
      },
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, file]);

  const changes = useMemo(() => (data?.chunks.filter((c): c is Change => c.kind === "change") ?? []), [data]);
  /** Ce qui ne dépend que des versions, calculé une fois (pas à chaque frappe dans un résultat) :
   *  lignes de chaque côté avec leurs mots modifiés, et résultat de la baguette. */
  const prepared = useMemo(() => changes.map((c) => ({ ours: sideLines(c, "ours"), theirs: sideLines(c, "theirs"), magic: magic(c) })), [changes]);
  const set = (k: number, f: (s: ChangeState) => ChangeState) => setStates((all) => all.map((s, i) => (i === k ? f(s) : s)));
  const resolved = changes.map((c, k) => !!states[k] && isResolved(c, states[k]));
  const conflictsLeft = changes.filter((c, k) => c.type === "conflict" && !resolved[k]).length;
  const changesLeft = changes.filter((c, k) => c.type !== "conflict" && !resolved[k]).length;
  const touched = states.some((s, k) => changes[k] && JSON.stringify(s) !== JSON.stringify(initialState(changes[k])));
  const magicCount = changes.filter((_, k) => !resolved[k] && prepared[k]?.magic).length;

  const status = conflictsLeft
    ? t("conflict.conflictsLeft", { count: conflictsLeft })
    : changesLeft
      ? t("conflict.changesLeft", { count: changesLeft })
      : t("conflict.allResolved");
  const oursLabel = data?.oursLabel || t("conflict.ours");
  const theirsLabel = data?.theirsLabel || t("conflict.theirs");

  const goTo = useCallback((k: number) => {
    setCurrent(k);
    document.getElementById(`mchange-${k}`)?.scrollIntoView({ block: "center" });
  }, []);
  // Ouverture : sur le premier conflit.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !changes.length) return;
    opened.current = true;
    const first = changes.findIndex((c) => c.type === "conflict");
    if (first >= 0) requestAnimationFrame(() => goTo(first));
  }, [changes, goTo]);
  const step = useCallback(
    (dir: 1 | -1) => {
      if (!changes.length) return;
      goTo((current + dir + changes.length) % changes.length);
    },
    [changes.length, current, goTo],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F7") return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const applyMagicAll = () => setStates((all) => all.map((s, k) => (changes[k] && !isResolved(changes[k], s) ? (prepared[k]?.magic ?? s) : s)));
  const acceptSide = (side: Side) => setStates(changes.map((c) => acceptAll(c, side)));

  /** Quitter ce fichier : confirmation si des choix seraient perdus. */
  const leave = async (then: () => void) => {
    if (touched) {
      const ok = await useDialogs.getState().choose({
        title: t("conflict.leaveTitle"),
        body: t("conflict.leaveBody", { file }),
        choices: [{ id: "leave", label: t("conflict.leave"), danger: true }],
      });
      if (!ok) return;
    }
    then();
  };
  // Échap passe par la même confirmation que Retour / Annuler.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const onEscape = useCallback(() => void leaveRef.current(back), [back]);
  useEscape(onEscape);
  const fileIndex = files.indexOf(file);
  const otherFile = (dir: 1 | -1) => files[(fileIndex + dir + files.length) % files.length];

  const save = async () => {
    if (!data || conflictsLeft + changesLeft > 0) return;
    setSaving(true);
    try {
      await api.resolveConflict(path, file, composeMerged(data.chunks, states, data.eol, data.finalEol));
      await useApp.getState().refreshRepo(path);
      await useWork.getState().refresh(path);
      useApp.getState().notify(t("conflict.saved", { file }));
      const left = (useWork.getState().repos[path]?.status?.conflicted ?? []).map((f) => f.path).filter((p) => p !== file);
      // Fichier suivant dans l'ordre de la liste, sinon retour au graphe.
      const next = left.find((p) => files.indexOf(p) > fileIndex) ?? left[0];
      if (next) show(path, next);
      else back();
    } catch (e) {
      setError(errorCode(e));
      setSaving(false);
    }
  };

  // Numéros de ligne de chaque colonne, au fil des morceaux.
  const rows: ReactNode[] = [];
  if (data) {
    let lo = 1;
    let lr = 1;
    let lc = 1;
    let k = -1;
    const num = (n: number) => <span className="ln">{n}</span>;
    data.chunks.forEach((c, i) => {
      if (c.kind === "same") {
        const long = c.lines.length > 2 * CONTEXT + 2 && !expanded.has(i);
        const head = i === 0 ? 0 : CONTEXT;
        const tail = i === data.chunks.length - 1 ? 0 : CONTEXT;
        const shown = long ? [...c.lines.slice(0, head).map((l, j) => [l, j] as const), null, ...c.lines.slice(c.lines.length - tail).map((l, j) => [l, c.lines.length - tail + j] as const)] : c.lines.map((l, j) => [l, j] as const);
        const hidden = c.lines.length - head - tail;
        const [o, r, m] = [lo, lr, lc];
        rows.push(
          <div key={i} className="mrow msame">
            {(["ours", "gl", "center", "gr", "theirs"] as const).map((col) =>
              col === "gl" || col === "gr" ? (
                <span key={col} className={`mgut mgut-${col === "gl" ? "l" : "r"}`} />
              ) : (
                <div key={col} className={`mcell mcell-${col}`}>
                  {shown.map((e, j) =>
                    e === null ? (
                      <button key="skip" className="mskip" onClick={() => setExpanded((x) => new Set(x).add(i))} title={t("conflict.expand")}>
                        {t("conflict.skipped", { count: hidden })}
                      </button>
                    ) : (
                      <div key={j} className="ml">
                        {num((col === "ours" ? o : col === "theirs" ? r : m) + e[1])}
                        <span className="mt">{e[0] || " "}</span>
                      </div>
                    ),
                  )}
                </div>
              ),
            )}
          </div>,
        );
        lo += c.lines.length;
        lr += c.lines.length;
        lc += c.lines.length;
        return;
      }
      k++;
      const n = k;
      const s = states[n];
      if (!s) return;
      const done = resolved[n];
      const sides = changedSides(c);
      const [o, r, m] = [lo, lr, lc];
      const sideCell = (side: Side, start: number) => {
        const lines = prepared[n][side];
        const picked = new Map(s.picks.map((p, order) => [`${p.side}:${p.index}`, order + 1]));
        const pickable = sides.includes(side);
        return (
          <div className={`mcell mcell-${side}${pickable ? " changed" : ""}${s.ignored.includes(side) ? " ignored" : ""}${s.applied.includes(side) ? " applied" : ""}`}>
            {lines.length === 0 && <div className="mempty" />}
            {lines.map((l, j) => {
              const order = picked.get(`${side}:${j}`);
              const props = pickable
                ? {
                    role: "checkbox",
                    "aria-checked": order !== undefined,
                    "aria-label": l.text || t("conflict.emptyLine"),
                    tabIndex: 0,
                    title: t("conflict.pickHint"),
                    draggable: true,
                    onDragStart: (e: DragEvent) => e.dataTransfer.setData("text/plain", `${l.text}\n`),
                    onClick: () => set(n, (x) => togglePickLine(c, x, side, j)),
                    onKeyDown: (e: KeyEvent) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        set(n, (x) => togglePickLine(c, x, side, j));
                      }
                    },
                  }
                : {};
              return (
                <div key={j} className={`ml${l.changed ? (l.words ? " mchg" : " mchg mwhole") : ""}${order !== undefined ? " picked" : ""}${pickable ? " pickable" : ""}`} {...props}>
                  {num(start + j)}
                  <span className="mt">
                    <Words text={l.text} words={l.words} />
                  </span>
                  {order !== undefined && <span className="morder">{order}</span>}
                </div>
              );
            })}
          </div>
        );
      };
      const gutter = (side: Side) => {
        const open = sides.includes(side) && !s.applied.includes(side) && !s.ignored.includes(side);
        const label = side === "ours" ? oursLabel : theirsLabel;
        return (
          <span className={`mgut mgut-${side === "ours" ? "l" : "r"}`}>
            {open && (
              <>
                {side === "theirs" && (
                  <button className="mg-btn" onClick={() => set(n, (x) => ignoreSide(x, side))} aria-label={t("conflict.ignore", { side: label })} title={t("conflict.ignore", { side: label })}>
                    <Icon name="close" size={12} />
                  </button>
                )}
                <button
                  className="mg-btn mg-apply"
                  onClick={() => set(n, (x) => applySide(c, x, side))}
                  aria-label={t(s.applied.length ? "conflict.append" : "conflict.apply", { side: label })}
                  title={t(s.applied.length ? "conflict.append" : "conflict.apply", { side: label })}
                >
                  {side === "ours" ? "»" : "«"}
                </button>
                {side === "ours" && (
                  <button className="mg-btn" onClick={() => set(n, (x) => ignoreSide(x, side))} aria-label={t("conflict.ignore", { side: label })} title={t("conflict.ignore", { side: label })}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </>
            )}
          </span>
        );
      };
      const value = s.result.join("\n");
      const wand = !done ? prepared[n].magic : null;
      rows.push(
        <div
          key={i}
          id={`mchange-${n}`}
          className={`mrow mchange mtype-${c.type}${done ? " resolved" : ""}${n === current ? " current" : ""}`}
          role="group"
          aria-label={t(`conflict.kind.${c.type}`, { index: n + 1, count: changes.length })}
          onFocusCapture={() => setCurrent(n)}
        >
          {sideCell("ours", o)}
          {gutter("ours")}
          <div className="mcell mcell-center">
            <div className="mresult">
              <div className="mres-ln" aria-hidden>
                {(s.result.length ? s.result : [""]).map((_, j) => (
                  <span key={j} className="ln">
                    {s.result.length ? m + j : ""}
                  </span>
                ))}
              </div>
              <textarea
                className="mono mres-edit"
                value={value}
                rows={Math.max(1, s.result.length)}
                wrap="off"
                spellCheck={false}
                placeholder={t("conflict.emptyResult")}
                aria-label={t("conflict.resultOf", { index: n + 1 })}
                title={t("conflict.editHint")}
                onChange={(e) => {
                  const v = e.target.value;
                  set(n, (x) => ({ ...x, result: v === "" ? [] : v.split("\n"), edited: true, picks: [] }));
                }}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  const moved = moveLines(el.value, el.selectionStart, el.selectionEnd, e.key === "ArrowUp" ? -1 : 1);
                  if (!moved) return;
                  set(n, (x) => ({ ...x, result: moved.text.split("\n"), edited: true, picks: [] }));
                  requestAnimationFrame(() => el.setSelectionRange(moved.start, moved.end));
                }}
              />
              <span className="mres-tools">
                {wand && (
                  <button className="mg-btn mg-wand" onClick={() => set(n, () => wand)} aria-label={t("conflict.magicOne")} title={t("conflict.magicOne")}>
                    <Icon name="wand" size={12} />
                  </button>
                )}
                {JSON.stringify(s) !== JSON.stringify(initialState(c)) && (
                  <button className="mg-btn" onClick={() => set(n, () => initialState(c))} aria-label={t("conflict.reset")} title={t("conflict.reset")}>
                    <Icon name="undo" size={12} />
                  </button>
                )}
              </span>
            </div>
          </div>
          {gutter("theirs")}
          {sideCell("theirs", r)}
        </div>,
      );
      lo += c.ours.length;
      lr += c.theirs.length;
      lc += s.result.length;
    });
  }

  return (
    <section className="pull-view conflict-view" aria-label={t("conflict.label", { file })}>
      <header className="diff-head">
        <BackButton onClick={() => void leave(back)} />
        <Icon name="merge" size={15} />
        <span className="pull-view-title mono" title={file}>
          {t("conflict.title", { file })}
        </span>
        {files.length > 1 && fileIndex >= 0 && (
          <span className="conflict-files">
            <button className="mini icon" onClick={() => void leave(() => show(path, otherFile(-1)))} aria-label={t("conflict.prevFile")} title={t("conflict.prevFile")}>
              <Icon name="back" size={12} />
            </button>
            <span className="muted">{t("conflict.fileOf", { index: fileIndex + 1, count: files.length })}</span>
            <button className="mini icon" onClick={() => void leave(() => show(path, otherFile(1)))} aria-label={t("conflict.nextFile")} title={t("conflict.nextFile")}>
              <Icon name="arrow" size={12} />
            </button>
          </span>
        )}
        {data && (
          <span className={conflictsLeft ? "conflict-status conflict-left" : "conflict-status muted"} role="status" title={status}>
            {status}
          </span>
        )}
        {data && changes.length > 0 && (
          <span className="conflict-tools">
            <button className="mini icon" onClick={() => step(-1)} aria-label={t("conflict.prev")} title={t("conflict.prev")}>
              <Icon name="chevron" size={13} className="flip" />
            </button>
            <button className="mini icon" onClick={() => step(1)} aria-label={t("conflict.next")} title={t("conflict.next")}>
              <Icon name="chevron" size={13} />
            </button>
            <button className="mini icon" disabled={magicCount === 0} onClick={applyMagicAll} aria-label={t("conflict.magicAll")} title={t("conflict.magicAllHint", { count: magicCount })}>
              <Icon name="wand" size={13} />
            </button>
          </span>
        )}
      </header>
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !data ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : (
        <>
          {data.noMarkers && (
            <p className="details-note muted conflict-note">
              {t("conflict.noMarkers")}{" "}
              <button className="link" onClick={() => void useWork.getState().stage(path, [{ path: file, oldPath: null, status: "U" }]).then(back)}>
                {t("conflict.markAsIs")}
              </button>
            </p>
          )}
          <div className="mgrid-head">
            <span title={t("conflict.oursHint")}>{t("conflict.oursCol", { side: oursLabel })}</span>
            <span />
            <span>{t("conflict.result")}</span>
            <span />
            <span title={t("conflict.theirsHint")}>{t("conflict.theirsCol", { side: theirsLabel })}</span>
          </div>
          <div className="mgrid mono">
            {rows}
          </div>
        </>
      )}
      <footer className="conflict-foot">
        <button className="btn sm" disabled={!data} onClick={() => acceptSide("ours")} title={t("conflict.acceptHint", { side: oursLabel })}>
          {t("conflict.acceptOurs")}
        </button>
        <button className="btn sm" disabled={!data} onClick={() => acceptSide("theirs")} title={t("conflict.acceptHint", { side: theirsLabel })}>
          {t("conflict.acceptTheirs")}
        </button>
        <span className="conflict-foot-gap" />
        <button className="btn sm" onClick={() => void leave(back)}>
          {t("conflict.cancel")}
        </button>
        <button className="btn sm primary" disabled={!data || conflictsLeft + changesLeft > 0 || saving} onClick={() => void save()}>
          {t("conflict.save")}
        </button>
      </footer>
    </section>
  );
}
