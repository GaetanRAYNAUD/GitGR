// Liste des commits, virtualisée : seules les lignes visibles existent dans le DOM,
// et les traits du graphe sont dessinés sur un canvas de la taille de la zone visible.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commitDate, initials } from "../../lib/format";
import { layoutGraph, PALETTE_SIZE, type GraphLayout } from "../../lib/graph";
import { clamp, colKey, LIMITS, useLayoutValue } from "../../lib/layout";
import { branchColorRules, chipFixedColor, customColors, fixedColorsByCommit, laneCss } from "../../lib/branchColors";
import { chipsByCommit, type RefChip } from "../../lib/refs";
import type { BranchColorRule, Commit, GitRef, GraphColumn, RefsInfo } from "../../lib/types";
import { useDismiss } from "../../lib/useDismiss";
import { parseRemote, remoteProfile } from "../../lib/profiles";
import { remoteAccount, remoteInstance, remoteProvider } from "../../lib/providers";
import { useApp } from "../../store/app";
import { type AuthorContext, useAuthorAvatars, useAvatarImages } from "../../store/avatars";
import { useProfiles } from "../../store/profiles";
import { useGraph, WIP } from "../../store/graph";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { checkoutRef, commitMenu, refMenu } from "./menus";
import { Splitter } from "../Splitter";

export const ROW_H = 28;
const LANE_W = 14;
/** Avec les avatars, des colonnes plus larges : un nœud fait 18 px. */
const LANE_W_AVATARS = 22;
const AVATAR_R = 9;
const GRAPH_PAD = 8;
/** Au-delà, les colonnes ne sont plus dessinées (graphe illisible de toute façon). */
const MAX_LANES = 24;
const OVERSCAN = 10;
/** Quand on approche de la fin de l'historique chargé, on demande la page suivante. */
const PREFETCH_ROWS = 200;

/** Colonnes dans l'ordre d'affichage ; le message est toujours là et prend la place restante. */
const COLUMNS = ["refs", "graph", "message", "author", "date", "sha"] as const;
type Column = (typeof COLUMNS)[number];
/** Colonnes dont on règle la largeur (celle du graphe suit le nombre de branches). */
const RESIZABLE: readonly Column[] = ["refs", "author", "date", "sha"];

/** Position de défilement par dépôt, retrouvée en revenant sur l'onglet. */
const scrollMemory = new Map<string, number>();

const NO_COLUMNS: GraphColumn[] = [];

interface Props {
  path: string;
  /** Nombre de fichiers modifiés (ligne « en cours » si > 0). */
  changes: number;
}

/** Avatar d'un nœud : l'image (chargée) de l'auteur, sinon ses initiales. */
interface NodeAvatar {
  img: HTMLImageElement | null;
  initials: string;
}

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
  /** Avatars activés : avatar du nœud de la ligne `r` (WIP : `null`). */
  avatarOf: ((r: number) => NodeAvatar | null) | null,
) {
  const laneW = avatarOf ? LANE_W_AVATARS : LANE_W;
  const laneX = (col: number) => GRAPH_PAD + col * laneW + laneW / 2;
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
  // Au-delà de la palette : couleurs libres des règles de branches (cf. lib/branchColors).
  const color = (i: number) => palette[i] ?? palette[i % PALETTE_SIZE];

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
    const avatar = avatarOf && !wip ? avatarOf(r) : null;
    if (avatar) {
      // Nœud avatar : disque de la couleur de la branche, image (ou initiales) au milieu ;
      // HEAD : un anneau autour.
      ctx.arc(xc, mid, AVATAR_R, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      if (avatar.img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(xc, mid, AVATAR_R - 1.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar.img, xc - AVATAR_R + 1.5, mid - AVATAR_R + 1.5, (AVATAR_R - 1.5) * 2, (AVATAR_R - 1.5) * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = "#fff";
        ctx.font = "600 8.5px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(avatar.initials, xc, mid + 0.5);
      }
      if (shas[r] === head) {
        ctx.beginPath();
        ctx.arc(xc, mid, AVATAR_R + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = c;
        ctx.stroke();
      }
    } else if (wip && avatarOf) {
      ctx.setLineDash([2.5, 2]);
      ctx.arc(xc, mid, AVATAR_R - 1, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (wip) {
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

/** Ref représentée par une étiquette (aucune pour « HEAD » détachée). */
function chipRef(chip: RefChip, refs: RefsInfo | null): GitRef | undefined {
  if (chip.kind === "head") return undefined;
  return refs?.refs.find((r) => r.kind === chip.kind && r.short === chip.label);
}

/** Avatar d'un auteur (colonne Auteur, étiquettes de branches) : son image, sinon ses initiales. */
function AuthorBadge({ name, avatar, className }: { name: string; avatar: string | null | undefined; className: string }) {
  if (avatar) return <img className={className} src={avatar} alt="" draggable={false} />;
  return (
    <span className={`${className} initials`} aria-hidden="true">
      {initials(name || "?").slice(0, 2)}
    </span>
  );
}

function Chip({
  chip,
  color,
  path,
  refs,
  rules,
  avatar,
}: {
  chip: RefChip;
  color: number;
  path: string;
  refs: RefsInfo | null;
  rules: BranchColorRule[];
  /** Branche : avatar de l'auteur de son dernier commit (`undefined` : avatars désactivés). */
  avatar?: { name: string; url: string | null };
}) {
  const { t } = useTranslation();
  const r = chipRef(chip, refs);
  color = chipFixedColor(rules, chip.kind, chip.label) ?? color;
  const cls = chip.kind === "tag" ? "chip tag" : chip.kind === "remote" ? "chip remote" : "chip";
  const title = [chip.title, chip.current && t("graph.current"), chip.synced && t("graph.synced")].filter(Boolean).join(" — ");
  return (
    <span
      className={cls}
      style={{ "--chip": laneCss(color, customColors(rules)) } as React.CSSProperties}
      title={title}
      onDoubleClick={r ? () => checkoutRef(path, r, refs) : undefined}
      onContextMenu={r ? (e) => openContextMenu(e, refMenu(t, path, r, refs)) : undefined}
    >
      {avatar && chip.kind !== "tag" && <AuthorBadge name={avatar.name} avatar={avatar.url} className="chip-avatar" />}
      {chip.current && <Icon name="check" size={12} />}
      {chip.kind === "tag" && <Icon name="tag" size={12} />}
      {chip.kind === "remote" && <Icon name="cloud" size={12} />}
      <span className="chip-label">{chip.label}</span>
      {chip.synced && <Icon name="cloud" size={12} className="chip-synced" />}
    </span>
  );
}

/** Choix des colonnes affichées (clic droit sur l'en-tête, ou bouton à droite). */
function ColumnsMenu({ hidden, onClose }: { hidden: GraphColumn[]; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useApp((s) => s.updateSettings);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, onClose);
  return (
    <div className="popover columns-menu" role="dialog" aria-label={t("graph.columns")} ref={ref}>
      <div className="eyebrow">{t("graph.columns")}</div>
      {COLUMNS.map((c) => (
        <label key={c} className="menu-check">
          <input
            type="checkbox"
            disabled={c === "message"}
            checked={c === "message" || !hidden.includes(c)}
            onChange={() => {
              if (c === "message") return;
              update({ hiddenColumns: hidden.includes(c) ? hidden.filter((h) => h !== c) : [...hidden, c] });
            }}
          />
          {t(`graph.${c}`)}
        </label>
      ))}
      <div className="menu-hint">{t("graph.columnsHint")}</div>
    </div>
  );
}

export function CommitGraph({ path, changes }: Props) {
  const { t, i18n } = useTranslation();
  const hidden = useApp((s) => s.settings.hiddenColumns) ?? NO_COLUMNS;
  // Une valeur par colonne : glisser une autre poignée (panneaux, sections) ne redessine pas le graphe.
  const widths: Partial<Record<Column, number>> = {
    refs: useLayoutValue(colKey("refs")),
    author: useLayoutValue(colKey("author")),
    date: useLayoutValue(colKey("date")),
    sha: useLayoutValue(colKey("sha")),
  };
  const setLayout = useApp((s) => s.setLayout);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const graph = useGraph((s) => s.graphs[path]);
  const select = useGraph((s) => s.select);
  const loadMore = useGraph((s) => s.loadMore);
  const themeVersion = useThemeVersion();
  // Couleurs relues uniquement quand le thème change.

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
  const rules = branchColorRules(
    useApp((s) => s.settings.branchColors),
    useApp((s) => s.settings.branchColorsOff),
  );
  const fixed = useMemo(() => fixedColorsByCommit(rules, graph?.refs ?? null), [rules, graph?.refs]);
  const layout = useMemo(() => layoutGraph(commits, fixed), [commits, fixed]);
  const palette = useMemo(() => [...readPalette(), ...customColors(rules)], [themeVersion, rules]);
  const shas = useMemo(() => commits.map((c) => c.sha), [commits]);
  const chips = useMemo(() => chipsByCommit(graph?.refs ?? null), [graph?.refs]);
  const avatarsOn = !useApp((s) => s.settings.graphAvatarsOff);
  const laneW = avatarsOn ? LANE_W_AVATARS : LANE_W;
  // Au moins la largeur du titre de la colonne.
  const graphW = Math.max(72, GRAPH_PAD * 2 + Math.max(1, Math.min(layout.width, MAX_LANES)) * laneW);
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

  // Avatars des auteurs : provider et dépôt du remote `origin`, avec le compte de son profil.
  const remoteUrl = useApp((s) => s.summaries[path]?.data?.remoteUrl ?? null);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  const authorCtx = useMemo((): AuthorContext | null => {
    if (!avatarsOn) return null;
    const parsed = parseRemote(remoteUrl);
    const provider = remoteProvider(profiles, parsed);
    if (!parsed || !provider) return { kind: null, url: null, repo: null, account: null };
    const account = remoteAccount(remoteProfile(profiles, binding, { name: "origin", url: remoteUrl }).profile, parsed);
    return { kind: provider, url: remoteInstance(profiles, parsed, account), repo: parsed.path, account: account?.id ?? null };
  }, [avatarsOn, remoteUrl, profiles, binding]);
  const visibleEmails = useMemo(
    () => [...new Set(commits.slice(first, last).filter((c) => c.sha !== WIP && c.email).map((c) => c.email.toLowerCase()))],
    [commits, first, last],
  );
  const authors = useAuthorAvatars(authorCtx, visibleEmails);
  const avatarOfEmail = (email: string) => authors[email.toLowerCase()];
  const images = useAvatarImages(visibleEmails.map((e) => authors[e]));

  const showGraph = !hidden.includes("graph");
  useEffect(() => {
    if (!canvasRef.current) return;
    const avatarOf = avatarsOn
      ? (r: number) => ({ img: images.get(authors[commits[r].email.toLowerCase()]), initials: initials(commits[r].author || "?").slice(0, 2) })
      : null;
    drawGraph(canvasRef.current, layout, first, last, graphW, head, shas, palette, avatarOf);
    // `images.get` lit les images chargées : `images.version` dit quand redessiner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, first, last, graphW, head, shas, palette, showGraph, avatarsOn, authors, images.version, commits]);

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

  const visible = COLUMNS.filter((c) => c === "message" || !hidden.includes(c));
  const colWidth = (c: Column) => {
    if (c === "graph") return `${graphW}px`;
    if (c === "message") return "minmax(0, 1fr)";
    const w = widths[c];
    return w !== undefined ? `${w}px` : `var(--col-${c})`;
  };
  const cols = visible.map(colWidth).join(" ");
  const canvasLeft = visible.includes("refs") ? colWidth("refs") : "0px";
  const now = Date.now();

  const cell = (col: Column, c: Commit, color: number, isWip: boolean) => {
    switch (col) {
      case "refs":
        return (
          <span key={col} className="commit-refs">
            {(chips.get(c.sha) ?? []).map((chip) => (
              <Chip
                key={chip.kind + chip.label}
                chip={chip}
                color={color}
                path={path}
                refs={graph?.refs ?? null}
                rules={rules}
                avatar={avatarsOn && !isWip ? { name: c.author, url: avatarOfEmail(c.email) ?? null } : undefined}
              />
            ))}
          </span>
        );
      case "graph":
        return <span key={col} />;
      case "message":
        return (
          <span key={col} className="commit-msg">
            {isWip ? t("graph.wip", { count: changes }) : c.subject}
          </span>
        );
      case "author":
        return (
          <span key={col} className="commit-author" title={c.email}>
            {avatarsOn && !isWip && <AuthorBadge name={c.author} avatar={avatarOfEmail(c.email)} className="author-avatar" />}
            <span className="commit-author-name">{c.author}</span>
          </span>
        );
      case "date": {
        const when = isWip ? null : commitDate(c.time * 1000, i18n.language, now);
        return (
          <span key={col} className="commit-date" title={isWip ? undefined : new Date(c.time * 1000).toLocaleString(i18n.language)}>
            {when && (when.key === "date" ? when.text : t(`time.${when.key}`, { count: when.count }))}
          </span>
        );
      }
      case "sha":
        return (
          <span key={col} className="commit-sha">
            {isWip ? "" : c.sha.slice(0, 7)}
          </span>
        );
    }
  };

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
      <div
        className="graph-head"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        {visible.map((c) => (
          <span key={c} className={c === "refs" ? "graph-head-cell graph-head-refs" : "graph-head-cell"}>
            <span className="graph-head-label">{t(`graph.${c}`)}</span>
            {RESIZABLE.includes(c) && (
              <Splitter
                dir="x"
                label={t("layout.column", { name: t(`graph.${c}`) })}
                measure={(el) => el.parentElement!.getBoundingClientRect().width}
                onChange={(v, final) => setLayout({ [colKey(c as GraphColumn)]: clamp(v, LIMITS.column) }, final)}
                onReset={() => setLayout({ [colKey(c as GraphColumn)]: null })}
              />
            )}
          </span>
        ))}
        <button
          className="icon-btn sm columns-btn"
          aria-label={t("graph.columns")}
          aria-expanded={menuOpen}
          title={t("graph.columns")}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="sliders" size={13} />
        </button>
        {menuOpen && <ColumnsMenu hidden={hidden} onClose={closeMenu} />}
      </div>
      <div className="graph-body" style={{ height: commits.length * ROW_H }}>
        {showGraph && (
          <canvas ref={canvasRef} className="graph-canvas" style={{ top: first * ROW_H, left: canvasLeft }} aria-hidden="true" />
        )}
        {commits.slice(first, last).map((c, k) => {
          const i = first + k;
          const row = layout.rows[i];
          const isWip = c.sha === WIP;
          const cls = ["commit-row", isWip && "wip", c.sha === selected && "sel", row.col < MAX_LANES || "far"]
            .filter(Boolean)
            .join(" ");
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
                if (e.button === 0) select(path, c.sha);
              }}
              onContextMenu={(e) => {
                if (isWip) return e.preventDefault();
                select(path, c.sha);
                openContextMenu(e, commitMenu(t, path, c.sha, graph.refs));
              }}
            >
              {visible.map((col) => cell(col, c, row.color, isWip))}
            </div>
          );
        })}
      </div>
      {graph.loading && graph.commits.length > 0 && <div className="graph-more muted">{t("graph.loadingMore")}</div>}
    </div>
  );
}
