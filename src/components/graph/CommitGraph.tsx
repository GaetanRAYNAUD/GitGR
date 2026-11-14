// Liste des commits, virtualisée : seules les lignes visibles existent dans le DOM,
// et les traits du graphe sont dessinés sur un canvas de la taille de la zone visible.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commitDate } from "../../lib/format";
import { layoutGraph, PALETTE_SIZE, type GraphLayout } from "../../lib/graph";
import { chipsByCommit, type RefChip } from "../../lib/refs";
import type { Commit } from "../../lib/types";
import { useGraph, WIP } from "../../store/graph";
import { Icon } from "../Icon";

export const ROW_H = 28;
const LANE_W = 14;
const GRAPH_PAD = 8;
/** Au-delà, les colonnes ne sont plus dessinées (graphe illisible de toute façon). */
const MAX_LANES = 24;
const OVERSCAN = 10;
/** Quand on approche de la fin de l'historique chargé, on demande la page suivante. */
const PREFETCH_ROWS = 200;

/** Position de défilement par dépôt, retrouvée en revenant sur l'onglet. */
const scrollMemory = new Map<string, number>();

interface Props {
  path: string;
  /** Nombre de fichiers modifiés (ligne « en cours » si > 0). */
  changes: number;
}

const laneX = (col: number) => GRAPH_PAD + col * LANE_W + LANE_W / 2;

function readPalette(): string[] {
  const css = getComputedStyle(document.documentElement);
  return Array.from({ length: PALETTE_SIZE }, (_, i) => css.getPropertyValue(`--g${i}`).trim() || "#888");
}

/** Redessine quand le thème change (attribut `data-theme` de <html>). */
function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((x) => x + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return v;
}

function drawGraph(
  canvas: HTMLCanvasElement,
  layout: GraphLayout,
  first: number,
  last: number,
  width: number,
  head: string | null,
  shas: string[],
  palette: string[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom, ou canvas indisponible
  const dpr = window.devicePixelRatio || 1;
  const height = (last - first) * ROW_H;
  // Ne réalloue le canvas que si sa taille change (pas à chaque pas de défilement).
  const w = Math.ceil(width * dpr);
  const h = Math.ceil(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  const color = (i: number) => palette[i % PALETTE_SIZE];

  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (x1 === x2) ctx.lineTo(x2, y2);
    else {
      const my = (y1 + y2) / 2;
      ctx.bezierCurveTo(x1, my, x2, my, x2, y2);
    }
    ctx.stroke();
  };

  for (let r = first; r < last; r++) {
    const row = layout.rows[r];
    const y0 = (r - first) * ROW_H;
    const mid = y0 + ROW_H / 2;
    const xc = laneX(row.col);
    const wip = shas[r] === WIP;
    for (let k = 0; k < row.pass.length; k += 2) {
      if (row.pass[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.pass[k + 1]);
      curve(laneX(row.pass[k]), y0, laneX(row.pass[k]), y0 + ROW_H);
    }
    if (row.col >= MAX_LANES) continue;
    for (let k = 0; k < row.in.length; k += 2) {
      if (row.in[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.in[k + 1]);
      curve(laneX(row.in[k]), y0, xc, mid);
    }
    if (wip) ctx.setLineDash([3, 3]);
    for (let k = 0; k < row.out.length; k += 2) {
      if (row.out[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.out[k + 1]);
      curve(xc, mid, laneX(row.out[k]), y0 + ROW_H);
    }
    ctx.setLineDash([]);

    const c = color(row.color);
    ctx.beginPath();
    if (wip) {
      ctx.setLineDash([2.5, 2]);
      ctx.arc(xc, mid, 5, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (shas[r] === head) {
      // HEAD : anneau autour du point.
      ctx.arc(xc, mid, 6.5, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(xc, mid, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    } else {
      ctx.arc(xc, mid, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
  }
}

function Chip({ chip, color }: { chip: RefChip; color: number }) {
  const { t } = useTranslation();
  const cls = chip.kind === "tag" ? "chip tag" : chip.kind === "remote" ? "chip remote" : "chip";
  const title = [chip.title, chip.current && t("graph.current"), chip.synced && t("graph.synced")].filter(Boolean).join(" — ");
  return (
    <span className={cls} style={{ "--chip": `var(--g${color % PALETTE_SIZE})` } as React.CSSProperties} title={title}>
      {chip.current && <Icon name="check" size={12} />}
      {chip.kind === "tag" && <Icon name="tag" size={12} />}
      {chip.kind === "remote" && <Icon name="cloud" size={12} />}
      <span className="chip-label">{chip.label}</span>
      {chip.synced && <Icon name="cloud" size={12} className="chip-synced" />}
    </span>
  );
}

export function CommitGraph({ path, changes }: Props) {
  const { t, i18n } = useTranslation();
  const graph = useGraph((s) => s.graphs[path]);
  const select = useGraph((s) => s.select);
  const loadMore = useGraph((s) => s.loadMore);
  const themeVersion = useThemeVersion();
  // Couleurs relues uniquement quand le thème change.
  const palette = useMemo(() => readPalette(), [themeVersion]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(() => scrollMemory.get(path) ?? 0);
  const [viewH, setViewH] = useState(600);

  const head = graph?.refs?.head ?? null;
  const commits: Commit[] = useMemo(() => {
    const list = graph?.commits ?? [];
    if (changes > 0 && head) {
      return [{ sha: WIP, parents: [head], author: "", email: "", time: 0, subject: "" }, ...list];
    }
    return list;
  }, [graph?.commits, changes, head]);
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const shas = useMemo(() => commits.map((c) => c.sha), [commits]);
  const chips = useMemo(() => chipsByCommit(graph?.refs ?? null), [graph?.refs]);
  // Au moins la largeur du titre de la colonne.
  const graphW = Math.max(72, GRAPH_PAD * 2 + Math.max(1, Math.min(layout.width, MAX_LANES)) * LANE_W);
  const selected = graph?.selected ?? null;
  const selectedIndex = selected ? shas.indexOf(selected) : -1;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  // La liste n'existe qu'une fois l'historique chargé (avant : message de chargement).
  const showList = !!graph && !(graph.commits.length === 0 && graph.loading) && commits.length > 0;

  // Taille de la zone visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = scrollMemory.get(path) ?? 0;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight || 600));
    ro.observe(el);
    setViewH(el.clientHeight || 600);
    return () => ro.disconnect();
  }, [path, showList]);

  useEffect(() => {
    if (canvasRef.current) drawGraph(canvasRef.current, layout, first, last, graphW, head, shas, palette);
  }, [layout, first, last, graphW, head, shas, palette]);

  // Page suivante quand on approche de la fin.
  useEffect(() => {
    if (graph && !graph.done && !graph.loading && !graph.error && last > commits.length - PREFETCH_ROWS) {
      loadMore(path);
    }
  }, [graph, last, commits.length, loadMore, path]);

  const onScroll = () => {
    const top = scrollRef.current?.scrollTop ?? 0;
    scrollMemory.set(path, top);
    setScrollTop(top);
  };

  /** Fait défiler pour que la ligne `i` soit visible. */
  const ensureVisible = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el || i < 0) return;
    const header = ROW_H; // en-tête collant
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - header) el.scrollTop = top + ROW_H - el.clientHeight + header;
  }, []);

  // Nouvelle sélection (clavier, barre latérale, parent dans les détails) : on l'amène à l'écran.
  // Pas au montage, pour respecter la position de défilement mémorisée.
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;
    ensureVisible(selectedIndex);
  }, [selected, selectedIndex, ensureVisible]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (commits.length === 0) return;
    const page = Math.max(1, Math.floor(viewH / ROW_H) - 1);
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
      Home: -Infinity,
      End: Infinity,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const from = selectedIndex < 0 ? -1 : selectedIndex;
    const to = Math.max(0, Math.min(commits.length - 1, from + moves[e.key]));
    select(path, shas[to]);
  };

  if (!graph || (graph.commits.length === 0 && graph.loading)) {
    return <p className="graph-state muted">{t("graph.loading")}</p>;
  }
  if (commits.length === 0) {
    return <p className="graph-state muted">{t("graph.empty")}</p>;
  }

  const cols = `var(--col-refs) ${graphW}px minmax(0, 1fr) var(--col-author) var(--col-date) var(--col-sha)`;
  const now = Date.now();

  return (
    <div
      className="graph-scroll"
      ref={scrollRef}
      onScroll={onScroll}
      tabIndex={0}
      role="listbox"
      aria-label={t("graph.label")}
      aria-activedescendant={selectedIndex >= first && selectedIndex < last ? `commit-${shas[selectedIndex]}` : undefined}
      onKeyDown={onKeyDown}
      style={{ "--cols": cols } as React.CSSProperties}
    >
      <div className="graph-head" aria-hidden="true">
        <span className="graph-head-refs">{t("graph.refs")}</span>
        <span>{t("graph.graph")}</span>
        <span>{t("graph.message")}</span>
        <span>{t("graph.author")}</span>
        <span>{t("graph.date")}</span>
        <span>{t("graph.sha")}</span>
      </div>
      <div className="graph-body" style={{ height: commits.length * ROW_H }}>
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          style={{ top: first * ROW_H, left: "var(--col-refs)" }}
          aria-hidden="true"
        />
        {commits.slice(first, last).map((c, k) => {
          const i = first + k;
          const row = layout.rows[i];
          const isWip = c.sha === WIP;
          const cls = ["commit-row", isWip && "wip", c.sha === selected && "sel", row.col < MAX_LANES || "far"]
            .filter(Boolean)
            .join(" ");
          const when = isWip ? null : commitDate(c.time * 1000, i18n.language, now);
          return (
            <div
              key={c.sha}
              id={`commit-${c.sha}`}
              role="option"
              aria-selected={c.sha === selected}
              className={cls}
              style={{ top: i * ROW_H }}
              onMouseDown={(e) => {
                // Garde le focus sur la liste pour la navigation au clavier.
                e.preventDefault();
                scrollRef.current?.focus();
                select(path, c.sha);
              }}
            >
              <span className="commit-refs">
                {(chips.get(c.sha) ?? []).map((chip) => (
                  <Chip key={chip.kind + chip.label} chip={chip} color={row.color} />
                ))}
              </span>
              <span />
              <span className="commit-msg">
                {isWip ? t("graph.wip", { count: changes }) : c.subject}
              </span>
              <span className="commit-author" title={c.email}>
                {c.author}
              </span>
              <span className="commit-date" title={isWip ? undefined : new Date(c.time * 1000).toLocaleString(i18n.language)}>
                {when && (when.key === "date" ? when.text : t(`time.${when.key}`, { count: when.count }))}
              </span>
              <span className="commit-sha">{isWip ? "" : c.sha.slice(0, 7)}</span>
            </div>
          );
        })}
      </div>
      {graph.loading && graph.commits.length > 0 && <div className="graph-more muted">{t("graph.loadingMore")}</div>}
    </div>
  );
}
