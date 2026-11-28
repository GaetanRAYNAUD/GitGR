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
// déplacent des lignes). Clavier : F7 / Maj+F7 vont au conflit à régler suivant / précédent
// (Alt+F7 : toutes les modifications), Alt+← / Alt+→ prennent un côté pour la modification
// courante, Ctrl+S enregistre ; dans une colonne, ↑ / ↓ passent d'une ligne à l'autre (un
// seul arrêt de tabulation par colonne). « Enregistrer » écrit le fichier, le marque résolu,
// puis ouvre le fichier en conflit suivant. Les noms des côtés suivent l'opération en cours
// (merge, rebase, cherry-pick, revert) : pendant un rebase, « nous » est la branche de base.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as KeyEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import type { ConflictSides } from "../../lib/types";
import { BinaryPreview } from "./BinaryPreview";
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
import type { ConflictVersions, Operation } from "../../lib/types";
import { wordDiff, type Segment as WordSegment } from "../../lib/wordDiff";
import { useApp } from "../../store/app";
import { useDialogs } from "../../store/dialogs";
import { useConflictView } from "../../store/range";
import { useGraph } from "../../store/graph";
import { openContextMenu, useContextMenu } from "../ContextMenu";
import { useBlameMargin } from "./BlameMargin";
import { useWork } from "../../store/worktree";
import { Icon } from "../Icon";
import { AnnotateToggle, useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";

type Change = Extract<Chunk, { kind: "change" }>;

/** Lignes identiques gardées visibles autour d'une modification. */
const CONTEXT = 3;

/** Fichier tout juste enregistré : annoncé en haut de la vue du fichier suivant (un toast
 *  cacherait les boutons du pied). */
let justSaved: string | null = null;

/** Clé des libellés des côtés selon l'opération (`conflict.sides.*`). */
export function sidesKey(op: Operation | null | undefined): "merge" | "rebase" | "pick" | "revert" | "none" {
  if (op === "cherry-pick") return "pick";
  return op ?? "none";
}

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
  // Marge de blame (« Annoter ») sur « notre version » : le fichier à HEAD.
  const head = useGraph((s) => s.graphs[path]?.refs?.head ?? null);
  const blameSrc = useMemo(() => (head ? { path, file, rev: head, beforeReveal: () => close(path) } : undefined), [head, path, file, close]);
  const margin = useBlameMargin(blameSrc);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<ChangeState[]>([]);
  /** Parties identiques dépliées (indice du morceau). */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  /** Modification courante (navigation F7). */
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Échec d'un enregistrement : en bandeau, la grille et les choix restent. */
  const [saveError, setSaveError] = useState<string | null>(null);
  // Lu à la création, effacé ensuite (un initialiseur doit rester pur : StrictMode l'appelle deux fois).
  const [saved] = useState(() => justSaved);
  useEffect(() => {
    justSaved = null;
  }, []);
  /** Ligne qui porte l'arrêt de tabulation de chaque colonne (`modification:côté`). */
  const [roving, setRoving] = useState<Record<string, number>>({});
  const operation = useWork((s) => s.repos[path]?.status?.operation);
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
  // Noms des côtés selon l'opération ; le libellé des marqueurs (HEAD, nom de branche) à côté.
  const sk = sidesKey(operation);
  const oursName = t(`conflict.sides.${sk}.ours`);
  const theirsName = t(`conflict.sides.${sk}.theirs`);
  const oursLabel = data?.oursLabel || oursName;
  const theirsLabel = data?.theirsLabel || theirsName;
  const colTitle = (name: string, marker: string | undefined) => (marker ? t("conflict.col", { name, side: marker }) : name);

  /** Va à la modification `k` : la fait défiler au milieu et met le focus dans son résultat. */
  const goTo = useCallback((k: number) => {
    setCurrent(k);
    const row = document.getElementById(`mchange-${k}`);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }, []);
  // Ouverture : sur le premier conflit, le focus dans son résultat.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !changes.length) return;
    opened.current = true;
    const first = changes.findIndex((c) => c.type === "conflict");
    requestAnimationFrame(() => goTo(first >= 0 ? first : 0));
  }, [changes, goTo]);
  /** F7 : la modification à régler suivante (`all` : n'importe laquelle, Alt+F7). */
  const step = (dir: 1 | -1, all = false) => {
    const n = changes.length;
    // Plus rien à régler : on parcourt tout (relire avant d'enregistrer).
    const every = all || resolved.every(Boolean);
    for (let d = 1; d <= n; d++) {
      const k = (((current + dir * d) % n) + n) % n;
      if (every || !resolved[k]) return goTo(k);
    }
  };

  const applyMagicAll = () => setStates((all) => all.map((s, k) => (changes[k] && !isResolved(changes[k], s) ? (prepared[k]?.magic ?? s) : s)));
  /** Le fichier entier d'un côté : confirmation si des choix seraient remplacés. */
  const acceptSide = async (side: Side) => {
    if (touched) {
      const ok = await useDialogs.getState().choose({
        title: t("conflict.acceptTitle", { name: side === "ours" ? oursName : theirsName }),
        body: t("conflict.acceptBody", { file }),
        choices: [{ id: "accept", label: t("conflict.acceptConfirm"), danger: true }],
      });
      if (!ok) return;
    }
    setStates(changes.map((c) => acceptAll(c, side)));
  };
  /** Alt+← / Alt+→ : un côté dans le résultat de la modification courante. */
  const applyCurrent = (side: Side) => {
    const c = changes[current];
    const st = states[current];
    if (!c || !st || !changedSides(c).includes(side) || st.applied.includes(side) || st.ignored.includes(side)) return;
    set(current, (x) => applySide(c, x, side));
  };

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

  /** Fichier réglé : le suivant dans l'ordre de la liste (annoncé en haut de sa vue), sinon
   *  retour au graphe. */
  const afterResolved = async () => {
    await useApp.getState().refreshRepo(path);
    await useWork.getState().refresh(path);
    const left = (useWork.getState().repos[path]?.status?.conflicted ?? []).map((f) => f.path).filter((p) => p !== file);
    const next = left.find((p) => files.indexOf(p) > fileIndex) ?? left[0];
    if (next) {
      justSaved = file;
      show(path, next);
    } else {
      useApp.getState().notify(t("conflict.saved", { file }));
      back();
    }
  };
  /** Conflit binaire ou fichier supprimé d'un côté : réglé en entier (une version, ou supprimer). */
  const resolveWhole = async (choice: "ours" | "theirs" | "delete") => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.resolveConflictWith(path, file, choice);
      await afterResolved();
    } catch (e) {
      setSaveError(errorCode(e));
      setSaving(false);
    }
  };
  const whole = error === "conflict_binary" || error === "conflict_deleted";
  const ready = !!data && conflictsLeft + changesLeft === 0 && !saving;
  const save = async () => {
    if (!data || conflictsLeft + changesLeft > 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.resolveConflict(path, file, composeMerged(data.chunks, states, data.eol, data.finalEol));
      await afterResolved();
    } catch (e) {
      setSaveError(errorCode(e));
      setSaving(false);
    }
  };
  const markAsIs = async () => {
    setSaveError(null);
    // `stage` n'échoue pas : l'erreur part dans le toast global. On ne quitte que si le
    // fichier n'est plus en conflit.
    await useWork.getState().stage(path, [{ path: file, oldPath: null, status: "U" }]);
    const still = useWork.getState().repos[path]?.status?.conflicted.some((f) => f.path === file);
    if (!still) back();
  };

  // Raccourcis de la vue : F7, Alt+← / Alt+→, Ctrl+S (pas sous une fenêtre de confirmation, ni
  // quand le focus est ailleurs, dans le message de commit par exemple).
  const viewRef = useRef<HTMLElement>(null);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const target = e.target as Node | null;
    if (target && target !== document.body && !viewRef.current?.contains(target)) return;
    if (e.key === "F7") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1, e.altKey);
    } else if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      applyCurrent(e.key === "ArrowLeft" ? "ours" : "theirs");
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Numéros de ligne de chaque colonne, au fil des morceaux.
  const rows: ReactNode[] = [];
  if (data) {
    let lo = 1;
    let lr = 1;
    let lc = 1;
    let k = -1;
    const num = (n: number) => (
      <span className="ln" aria-hidden="true">
        {n}
      </span>
    );
    // Marge de blame de « notre version » : nom et date sur la première ligne d'un bloc.
    let prevAnn: string | null = null;
    const ann = (n: number | null) => {
      if (!margin) return null;
      const c = n === null ? undefined : margin.at(n);
      const start = !!c && c.sha !== prevAnn;
      prevAnn = c?.sha ?? null;
      return (
        <span
          className={c ? "mann" : "mann empty"}
          aria-hidden="true"
          style={c ? ({ "--age": margin.age(c).toFixed(2) } as React.CSSProperties) : undefined}
          title={c ? margin.title(c) : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (c) margin.pick(c);
          }}
          onDoubleClick={() => c && margin.reveal(c)}
          onContextMenu={(e) => c && openContextMenu(e, margin.menu(c))}
        >
          {start && c ? margin.label(c) : ""}
        </span>
      );
    };
    // Rang de chaque modification parmi celles de son genre (« Conflit 1 / 2 »).
    const ofType = new Map<number, { index: number; count: number }>();
    changes.forEach((c, j) => {
      const same = changes.filter((x) => x.type === c.type);
      ofType.set(j, { index: same.indexOf(c) + 1, count: same.length });
    });
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
                        {col === "ours" && ann(o + e[1])}
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
        const rk = `${n}:${side}`;
        const stop = Math.min(roving[rk] ?? 0, Math.max(0, lines.length - 1));
        const sideName = side === "ours" ? oursName : theirsName;
        return (
          <div className={`mcell mcell-${side}${pickable ? " changed" : ""}${s.ignored.includes(side) ? " ignored" : ""}${s.applied.includes(side) ? " applied" : ""}`}>
            {lines.length === 0 && <div className="mempty" />}
            {lines.map((l, j) => {
              const order = picked.get(`${side}:${j}`);
              const props = pickable
                ? {
                    role: "checkbox",
                    "aria-checked": order !== undefined,
                    "aria-label": t("conflict.lineLabel", { side: sideName, line: start + j, text: l.text || t("conflict.emptyLine") }),
                    tabIndex: j === stop ? 0 : -1,
                    onFocus: () => setRoving((r) => (r[rk] === j ? r : { ...r, [rk]: j })),
                    title: t("conflict.pickHint"),
                    draggable: true,
                    onDragStart: (e: DragEvent) => e.dataTransfer.setData("text/plain", `${l.text}\n`),
                    onClick: () => set(n, (x) => togglePickLine(c, x, side, j)),
                    onKeyDown: (e: KeyEvent) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        set(n, (x) => togglePickLine(c, x, side, j));
                      } else if (margin && side === "ours" && e.key.toLowerCase() === "b" && !e.ctrlKey && !e.altKey) {
                        // B : détails du commit de la ligne (marge de blame) ; Maj+B : ses actions.
                        const commit = margin.at(start + j);
                        if (!commit) return;
                        e.preventDefault();
                        if (!e.shiftKey) margin.pick(commit);
                        else {
                          const box = e.currentTarget.getBoundingClientRect();
                          useContextMenu.getState().open(box.left, box.bottom, margin.menu(commit));
                        }
                      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        // Une seule tabulation par colonne : les flèches passent d'une ligne à l'autre.
                        e.preventDefault();
                        const all = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".ml.pickable");
                        all?.[j + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
                      }
                    },
                  }
                : {};
              return (
                <div key={j} className={`ml${l.changed ? (l.words ? " mchg" : " mchg mwhole") : ""}${order !== undefined ? " picked" : ""}${pickable ? " pickable" : ""}`} {...props}>
                  {side === "ours" && ann(start + j)}
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
                {/* La flèche contre le résultat, X vers l'extérieur (comme IntelliJ). */}
                {side === "ours" && (
                  <button className="mg-btn" onClick={() => set(n, (x) => ignoreSide(x, side))} aria-label={t("conflict.ignore", { side: label })} title={t("conflict.ignore", { side: label })}>
                    <Icon name="close" size={12} />
                  </button>
                )}
                <button
                  className="mg-btn mg-apply"
                  onClick={() => set(n, (x) => applySide(c, x, side))}
                  aria-label={t(s.applied.length ? "conflict.append" : "conflict.apply", { side: label })}
                  title={`${t(s.applied.length ? "conflict.append" : "conflict.apply", { side: label })} (${side === "ours" ? "Alt+←" : "Alt+→"})`}
                >
                  {side === "ours" ? "»" : "«"}
                </button>
                {side === "theirs" && (
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
          tabIndex={-1}
          aria-label={[t(`conflict.kind.${c.type}`, ofType.get(n) ?? { index: n + 1, count: changes.length }), done && t("conflict.resolvedOne")].filter(Boolean).join(" — ")}
          onFocusCapture={() => setCurrent(n)}
        >
          {sideCell("ours", o)}
          {gutter("ours")}
          <div className="mcell mcell-center">
            <div className="mresult">
              {/* Lignes fantômes sous le champ : elles passent à la ligne comme lui, et chaque
                  numéro reste en face de sa ligne (les côtés passent aussi à la ligne). */}
              <div className="mres-lines" aria-hidden="true">
                {(s.result.length ? s.result : [""]).map((line, j) => (
                  <div key={j} className="mres-line">
                    <span className="ln">{s.result.length ? m + j : ""}</span>
                    <span className="mres-ghost">{line || " "}</span>
                  </div>
                ))}
              </div>
              <textarea
                className="mono mres-edit"
                value={value}
                wrap="soft"
                spellCheck={false}
                placeholder={t("conflict.emptyResult")}
                aria-label={t("conflict.resultOf", { index: n + 1 })}
                title={t("conflict.editHint")}
                onChange={(e) => {
                  const v = e.target.value;
                  set(n, (x) => ({ ...x, result: v === "" ? [] : v.split("\n"), edited: true, picks: [] }));
                }}
                onKeyDown={(e) => {
                  // Échap sort du champ (vers la modification) ; un second Échap quitte la vue.
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.currentTarget.closest<HTMLElement>(".mchange")?.focus();
                    return;
                  }
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
                {done && (
                  <span className="mres-done" title={t("conflict.resolvedOne")}>
                    <Icon name="check" size={12} />
                  </span>
                )}
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
    <section ref={viewRef} className="pull-view conflict-view" aria-label={t("conflict.label", { file })}>
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
        <span className="view-toggle">
          <AnnotateToggle />
        </span>
        {data && (
          <span className={conflictsLeft ? "conflict-status conflict-left" : changesLeft ? "conflict-status muted" : "conflict-status conflict-done"} role="status" title={status}>
            {!conflictsLeft && !changesLeft && <Icon name="check" size={13} />}
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
            <button className="mini" disabled={magicCount === 0} onClick={applyMagicAll} title={t("conflict.magicAllHint", { count: magicCount })}>
              <Icon name="wand" size={13} />
              {t("conflict.magicShort", { count: magicCount })}
            </button>
          </span>
        )}
        <span className="conflict-head-gap" />
      </header>
      {whole ? (
        <WholeConflict
          path={path}
          file={file}
          binary={error === "conflict_binary"}
          names={[oursName, theirsName]}
          busy={saving}
          saveError={saveError}
          onChoose={(c) => void resolveWhole(c)}
        />
      ) : error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !data ? (
        <p className="muted pull-pad" role="status">
          {t("details.loading")}
        </p>
      ) : (
        <>
          {saved && (
            <p className="details-note muted conflict-note" role="status">
              <Icon name="check" size={13} /> {t("conflict.saved", { file: saved })}
            </p>
          )}
          {saveError && (
            <p className="notice error conflict-error" role="alert">
              <Icon name="alert" size={14} />
              <span>{errorMessage(t, saveError)}</span>
            </p>
          )}
          {data.noMarkers && (
            <p className="details-note muted conflict-note">
              {t("conflict.noMarkers")}{" "}
              <button className="link" onClick={() => void markAsIs()}>
                {t("conflict.markAsIs")}
              </button>
            </p>
          )}
          <div className="mgrid-head" aria-hidden="true">
            <span title={t(`conflict.sides.${sk}.oursHint`)}>{colTitle(oursName, data.oursLabel)}</span>
            <span />
            <span>{t("conflict.result")}</span>
            <span />
            <span title={t(`conflict.sides.${sk}.theirsHint`)}>{colTitle(theirsName, data.theirsLabel)}</span>
          </div>
          <div className="mgrid mono">
            {rows}
          </div>
        </>
      )}
      {!whole && <footer className="conflict-foot">
        <button className="btn sm" disabled={!data} onClick={() => void acceptSide("ours")} title={t("conflict.acceptHint", { side: oursLabel })}>
          {t(`conflict.sides.${sk}.acceptOurs`)}
        </button>
        <button className="btn sm" disabled={!data} onClick={() => void acceptSide("theirs")} title={t("conflict.acceptHint", { side: theirsLabel })}>
          {t(`conflict.sides.${sk}.acceptTheirs`)}
        </button>
        <span className="conflict-keys muted" title={t("conflict.keys")}>
          {t("conflict.keys")}
        </span>
        <button className="btn sm" onClick={() => void leave(back)}>
          {t("conflict.cancel")}
        </button>
        {/* Grisé tant qu'il reste à régler : le statut en infobulle dit quoi. */}
        <button className="btn sm primary" disabled={!ready} onClick={() => void save()} title={ready ? `${t("conflict.save")} (Ctrl+S)` : status}>
          {t("conflict.save")}
        </button>
      </footer>}

    </section>
  );
}

/** Conflit qu'on ne règle pas ligne à ligne : fichier binaire (aperçu des deux images, ou leur
 *  taille) ou supprimé d'un côté. On garde une version, ou on supprime le fichier. */
function WholeConflict({
  path,
  file,
  binary,
  names,
  busy,
  saveError,
  onChoose,
}: {
  path: string;
  file: string;
  binary: boolean;
  names: [string, string];
  busy: boolean;
  saveError: string | null;
  onChoose: (choice: "ours" | "theirs" | "delete") => void;
}) {
  const { t } = useTranslation();
  const [sides, setSides] = useState<ConflictSides | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.conflictSides(path, file).then(
      (s) => live && setSides(s),
      (e) => live && setError(errorCode(e)),
    );
    return () => {
      live = false;
    };
  }, [path, file]);
  if (error) return <p className="details-note" role="alert">{errorMessage(t, error)}</p>;
  if (!sides) return <p className="muted pull-pad" role="status">{t("details.loading")}</p>;
  const [ours, theirs] = names;
  const what =
    sides.ours === null && sides.theirs !== null
      ? t("conflict.whole.deletedOurs", { ours, theirs })
      : sides.theirs === null && sides.ours !== null
        ? t("conflict.whole.deletedTheirs", { ours, theirs })
        : t("conflict.whole.binary");
  const keepLabel = (side: "ours" | "theirs") => {
    const name = side === "ours" ? ours : theirs;
    return (side === "ours" ? sides.ours : sides.theirs) === null ? t("conflict.whole.takeDeletion", { side: name }) : t("conflict.whole.keep", { side: name });
  };
  return (
    <div className="whole-conflict">
      <p className="details-note">{what}</p>
      {saveError && (
        <p className="notice error conflict-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{errorMessage(t, saveError)}</span>
        </p>
      )}
      {binary && (
        <BinaryPreview
          sides={{ path, old: sides.ours === null ? null : { rev: ":2", file }, new: sides.theirs === null ? null : { rev: ":3", file } }}
          labels={[ours, theirs]}
        />
      )}
      <div className="whole-conflict-actions">
        <button className="btn sm" disabled={busy} onClick={() => onChoose("ours")}>
          {keepLabel("ours")}
        </button>
        <button className="btn sm" disabled={busy} onClick={() => onChoose("theirs")}>
          {keepLabel("theirs")}
        </button>
        {sides.ours !== null && sides.theirs !== null && (
          <button className="btn sm" disabled={busy} onClick={() => onChoose("delete")}>
            {t("conflict.whole.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
