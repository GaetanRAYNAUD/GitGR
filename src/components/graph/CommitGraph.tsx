// Liste des commits, virtualisée : seules les lignes visibles existent dans le DOM,
// et les traits du graphe sont dessinés sur un canvas de la taille de la zone visible.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commitMatches, findQuery, nextMatch } from "../../lib/graphFind";
import { useGraphFind } from "../../store/graphFind";
import { useBisect } from "../../store/bisect";
import { AuthorFilter } from "./AuthorFilter";
import { api, errorCode } from "../../lib/api";
import { useTranslation } from "react-i18next";
import { commitDate, initials } from "../../lib/format";
import { layoutGraph, PALETTE_SIZE, SIDE_COLOR, type GraphLayout } from "../../lib/graph";
import { clamp, colKey, LIMITS, useLayoutValue } from "../../lib/layout";
import { branchColorRules, chipFixedColor, customColors, fixedColorsByCommit, laneCss } from "../../lib/branchColors";
import { chipsByCommit, fitChips, type ChipSize, type RefChip } from "../../lib/refs";
import type { BranchColorRule, Commit, GitRef, GraphColumn, RefsInfo, StashEntry } from "../../lib/types";
import { stashLabel } from "../../lib/stashes";
import { useStashList } from "../../store/stashes";
import { openStash, stashMenu } from "./StashesSection";
import { useDismiss } from "../../lib/useDismiss";
import { parseRemote, remoteProfile } from "../../lib/profiles";
import { remoteAccount, remoteInstance, remoteProvider } from "../../lib/providers";
import { useApp } from "../../store/app";
import { type AuthorContext, useAuthorAvatars, useAvatarImages } from "../../store/avatars";
import { useProfiles } from "../../store/profiles";
import { useGraph, WIP } from "../../store/graph";
import { type MenuItem, openContextMenu, useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { RemoteMark, remoteMarkOf, type RemoteMarkInfo } from "../RemoteMark";
import { checkoutRef, commitDropMenu, commitMenu, pickedDropMenu, pickedMenu, refMenu, startBranchDrag, wipMenu } from "./menus";
import { startCommitDrag } from "./commitDrag";
import { orderPicked } from "../../lib/multiSelect";
import { Splitter } from "../Splitter";
import { errorMessage } from "../../lib/errors";
import { pullOfRef, usePullContexts, usePullList, type PullContext } from "../../store/pullList";
import { pullRef } from "../../lib/pulls";
import type { PullSummary, Worktree } from "../../lib/types";
import { useWorktrees } from "../../store/worktrees";

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
const NO_WORKTREES: Worktree[] = [];

/** Ligne du graphe : un commit, la ligne « en cours » ou un stash (`side`). */
type GraphLine = Commit & { side?: boolean };

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

/** Couleur des lignes de stash (`SIDE_COLOR`). */
function readSideColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#888";
}

/** Composantes RVB (0-255) d'une couleur CSS `#rgb`, `#rrggbb` ou `rgb(…)`. */
export function parseColor(css: string): [number, number, number] | null {
  const c = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Encre des initiales sur un nœud : celle des deux qui contraste le plus avec la couleur de
 *  la voie (initiales blanches illisibles sur les voies jaune ou verte). */
export function inkOn(fill: string, light: string, dark: string): string {
  const f = parseColor(fill);
  const l = parseColor(light);
  const d = parseColor(dark);
  if (!f || !l || !d) return light;
  const lf = luminance(f);
  const ratio = (x: number) => (Math.max(x, lf) + 0.05) / (Math.min(x, lf) + 0.05);
  return ratio(luminance(l)) >= ratio(luminance(d)) ? light : dark;
}

/** Encres claire et sombre des initiales, lues dans les jetons du thème : `--accent-text`
 *  (blanc), et la plus sombre de `--bg` / `--text` (le fond en sombre, le texte en clair). */
function readInks(): { light: string; dark: string } {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  const light = get("--accent-text") || "white";
  const bg = get("--bg");
  const text = get("--text");
  const pb = parseColor(bg);
  const pt = parseColor(text);
  const dark = pb && pt ? (luminance(pb) < luminance(pt) ? bg : text) : bg || "black";
  return { light, dark };
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
  sideColor: string,
  /** Lignes de stash : nœud carré, traits en pointillés. */
  stashes: Set<string>,
  /** Avatars activés : avatar du nœud de la ligne `r` (WIP : `null`). */
  avatarOf: ((r: number) => NodeAvatar | null) | null,
  inks: { light: string; dark: string },
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
  const color = (i: number) => (i === SIDE_COLOR ? sideColor : (palette[i] ?? palette[i % PALETTE_SIZE]));
  const dash = (on: boolean) => ctx.setLineDash(on ? [3, 3] : []);

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
    const stash = stashes.has(shas[r]);
    for (let k = 0; k < row.pass.length; k += 2) {
      if (row.pass[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.pass[k + 1]);
      dash(row.dashed.includes(row.pass[k]));
      curve(laneX(row.pass[k]), y0, laneX(row.pass[k]), y0 + ROW_H);
    }
    ctx.setLineDash([]);
    if (row.col >= MAX_LANES) continue;
    for (let k = 0; k < row.in.length; k += 2) {
      if (row.in[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.in[k + 1]);
      dash(row.dashed.includes(row.in[k]));
      curve(laneX(row.in[k]), y0, xc, mid);
    }
    dash(wip || stash);
    for (let k = 0; k < row.out.length; k += 2) {
      if (row.out[k] >= MAX_LANES) continue;
      ctx.strokeStyle = color(row.out[k + 1]);
      curve(xc, mid, laneX(row.out[k]), y0 + ROW_H);
    }
    ctx.setLineDash([]);

    const c = color(row.color);
    ctx.beginPath();
    const avatar = avatarOf && !wip && !stash ? avatarOf(r) : null;
    if (stash) {
      // Stash : petit carré creux, discret.
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xc - 3.5, mid - 3.5, 7, 7);
      ctx.lineWidth = 2;
    } else if (avatar) {
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
        ctx.fillStyle = inkOn(c, inks.light, inks.dark);
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

/** Message raccourci (« … ») : le texte entier en infobulle au survol, seulement s'il ne tient pas. */
function titleIfCut(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  el.title = el.scrollWidth > el.clientWidth ? (el.textContent ?? "").replace(/^\/\/ /, "") : "";
}

/** Marges de la colonne Branche / tag (`.commit-refs`). */
const REFS_PAD = 16;
/** Pastille « +N » des étiquettes qui ne tiennent pas. */
const MORE_W = 34;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const textWidths = new Map<string, number>();

/** Largeur d'un texte dans la police des étiquettes (mesurée, gardée) ; à défaut de canvas
 *  (tests), une estimation. */
function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const known = textWidths.get(key);
  if (known !== undefined) return known;
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      measureCtx = null;
    }
  }
  let w = text.length * 6.6;
  if (measureCtx) {
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
  }
  // Gardée seulement une fois les polices chargées (sinon mesurée avec celle de secours).
  if (!measureCtx || document.fonts?.status !== "loading") textWidths.set(key, w);
  return w;
}

const CHIP_FONT = '600 11px "Inter Variable", Inter, "Segoe UI", system-ui, sans-serif';
const PULL_FONT = '500 10.5px "JetBrains Mono", ui-monospace, monospace';

/** Largeurs d'une étiquette (cf. `.chip`) : entière, et raccourcie à deux lettres + « … »,
 *  icônes et numéro de PR / MR toujours entiers. */
function chipSize(chip: RefChip, mark: boolean, pull: string | null, checks: boolean, worktree = false): ChipSize {
  const icons = [mark && chip.kind !== "tag" ? 13 : 0, chip.current ? 12 : 0, worktree ? 12 : 0, chip.kind === "tag" || chip.kind === "remote" ? 12 : 0, chip.synced ? 12 : 0, pull ? textWidth(pull, PULL_FONT) + 10 + (checks ? 9 : 0) : 0].filter((w) => w > 0);
  const base = 16 + icons.reduce((a, w) => a + w, 0) + 4 * icons.length + 1;
  const label = textWidth(chip.label, CHIP_FONT);
  const short = chip.label.length > 3 ? textWidth(`${chip.label.slice(0, 2)}…`, CHIP_FONT) : label;
  return { natural: Math.ceil(base + label), min: Math.ceil(base + Math.min(label, short)) };
}

/** Ref représentée par une étiquette (aucune pour « HEAD » détachée). */
function chipRef(chip: RefChip, refs: RefsInfo | null): GitRef | undefined {
  if (chip.kind === "head") return undefined;
  return refs?.refs.find((r) => r.kind === chip.kind && r.short === chip.label);
}

/** Avatars des auteurs : provider et dépôt du remote `origin`, avec le compte de son profil ;
 *  `null` quand les avatars sont désactivés dans les réglages. */
export function useAuthorContext(path: string): AuthorContext | null {
  const avatarsOn = !useApp((s) => s.settings.graphAvatarsOff);
  const remoteUrl = useApp((s) => s.summaries[path]?.data?.remoteUrl ?? null);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  return useMemo((): AuthorContext | null => {
    if (!avatarsOn) return null;
    const parsed = parseRemote(remoteUrl);
    const provider = remoteProvider(profiles, parsed);
    if (!parsed || !provider) return { kind: null, url: null, repo: null, account: null };
    const account = remoteAccount(remoteProfile(profiles, binding, { name: "origin", url: remoteUrl }).profile, parsed);
    return { kind: provider, url: remoteInstance(profiles, parsed, account), repo: parsed.path, account: account?.id ?? null };
  }, [avatarsOn, remoteUrl, profiles, binding]);
}

/** Avatar d'un auteur (colonne Auteur, étiquettes de branches, détails) : son image, sinon ses initiales. */
export function AuthorBadge({ name, avatar, className }: { name: string; avatar: string | null | undefined; className: string }) {
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
  mark,
  pr,
  minWidth,
  worktree,
}: {
  chip: RefChip;
  color: number;
  path: string;
  refs: RefsInfo | null;
  rules: BranchColorRule[];
  /** Branche : icône de son remote (propriétaire du dépôt, provider) ; absente : avatars
   *  désactivés, branche sans remote ou provider inconnu. */
  mark?: RemoteMarkInfo | null;
  /** PR / MR ouverte depuis cette branche. */
  pr?: { ctx: PullContext; pull: PullSummary } | null;
  /** Largeur sous laquelle l'étiquette ne se raccourcit pas (cf. `fitChips`). */
  minWidth?: number;
  /** Branche extraite dans un autre worktree (double-clic : l'ouvrir dans un onglet). */
  worktree?: Worktree;
}) {
  const { t } = useTranslation();
  const r = chipRef(chip, refs);
  color = chipFixedColor(rules, chip.kind, chip.label) ?? color;
  const cls = chip.kind === "tag" ? "chip tag" : chip.kind === "remote" ? "chip remote" : "chip";
  const title = [chip.title, chip.current && t("graph.current"), worktree && t("worktrees.chipTitle", { dir: worktree.path }), chip.synced && t("graph.synced")].filter(Boolean).join(" — ");
  return (
    <span
      className={cls}
      style={{ "--chip": laneCss(color, customColors(rules)), minWidth } as React.CSSProperties}
      title={title}
      onDoubleClick={worktree ? () => useWorktrees.getState().open(worktree) : r ? () => checkoutRef(path, r, refs) : undefined}
      onContextMenu={r ? (e) => openContextMenu(e, refMenu(t, path, r, refs)) : undefined}
      onMouseDown={r && r.kind !== "tag" ? (e) => startBranchDrag(e, t, path, r) : undefined}
      data-drop-ref={r && r.kind !== "tag" ? r.name : undefined}
    >
      {mark && chip.kind !== "tag" && <RemoteMark mark={mark} size={13} className="chip-mark" />}
      {chip.current && <Icon name="check" size={12} />}
      {worktree && <Icon name="folder" size={12} className="chip-worktree" />}
      {chip.kind === "tag" && <Icon name="tag" size={12} />}
      {chip.kind === "remote" && <Icon name="cloud" size={12} />}
      <span className="chip-label">{chip.label}</span>
      {chip.synced && <Icon name="cloud" size={12} className="chip-synced" />}
      {pr && (
        <span
          className={`chip-pull ${pr.pull.state}`}
          title={t("prv.branchPull", { ref: pullRef(pr.ctx.kind, pr.pull.number), title: pr.pull.title })}
          onClick={(e) => {
            e.stopPropagation();
            usePullList.getState().show(path, pr.ctx, pr.pull.number);
          }}
        >
          {pullRef(pr.ctx.kind, pr.pull.number)}
          {pr.pull.checks && <span className={`checks-dot ${pr.pull.checks}`} />}
        </span>
      )}
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
  const pullContexts = usePullContexts(path);
  const pullLists = usePullList((s) => s.lists);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const graph = useGraph((s) => s.graphs[path]);
  const select = useGraph((s) => s.select);
  const loadMore = useGraph((s) => s.loadMore);
  const themeVersion = useThemeVersion();
  // Couleurs relues uniquement quand le thème change.

  const scrollRef = useRef<HTMLDivElement>(null);
  // Largeur réelle de la colonne Branche / tag (celle par défaut dépend de la fenêtre,
  // `--col-refs`), lue sur son en-tête.
  const [refsHead, setRefsHead] = useState<HTMLElement | null>(null);
  const [refsW, setRefsW] = useState(0);
  useEffect(() => {
    if (!refsHead) return;
    const ro = new ResizeObserver(() => setRefsW(refsHead.getBoundingClientRect().width));
    ro.observe(refsHead);
    setRefsW(refsHead.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [refsHead]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTop, setScrollTop] = useState(() => scrollMemory.get(path) ?? 0);
  const [viewH, setViewH] = useState(600);
  const [scrollbarW, setScrollbarW] = useState(0);

  const head = graph?.refs?.head ?? null;
  const { list: stashList } = useStashList(path);
  /** Stashes par SHA : chacun sur une ligne juste au-dessus du commit d'où il part. */
  const stashes = useMemo(() => new Map(stashList.map((s) => [s.sha, s])), [stashList]);
  const commits: GraphLine[] = useMemo(() => {
    let list: GraphLine[] = graph?.commits ?? [];
    if (stashList.length) {
      const byBase = new Map<string, StashEntry[]>();
      for (const s of stashList) byBase.set(s.base, [...(byBase.get(s.base) ?? []), s]);
      const out: GraphLine[] = [];
      for (const c of list) {
        for (const s of byBase.get(c.sha) ?? []) {
          out.push({ sha: s.sha, parents: [s.base], author: "", email: "", time: s.time, subject: stashLabel(s.message).text, side: true });
        }
        out.push(c);
      }
      list = out;
    }
    // Dépôt sans commit (pas de HEAD) : la ligne « en cours » quand même, sans parent.
    if (changes > 0) {
      return [{ sha: WIP, parents: head ? [head] : [], author: "", email: "", time: 0, subject: "" }, ...list];
    }
    return list;
  }, [graph?.commits, changes, head, stashList]);
  const stashShas = useMemo(() => new Set(stashes.keys()), [stashes]);
  const rules = branchColorRules(
    useApp((s) => s.settings.branchColors),
    useApp((s) => s.settings.branchColorsOff),
  );
  const fixed = useMemo(() => fixedColorsByCommit(rules, graph?.refs ?? null), [rules, graph?.refs]);
  const layout = useMemo(() => layoutGraph(commits, fixed), [commits, fixed]);
  const palette = useMemo(() => [...readPalette(), ...customColors(rules)], [themeVersion, rules]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sideColor = useMemo(() => readSideColor(), [themeVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inks = useMemo(() => readInks(), [themeVersion]);
  const shas = useMemo(() => commits.map((c) => c.sha), [commits]);
  const chips = useMemo(() => chipsByCommit(graph?.refs ?? null), [graph?.refs]);
  const avatarsOn = !useApp((s) => s.settings.graphAvatarsOff);
  const laneW = avatarsOn ? LANE_W_AVATARS : LANE_W;
  // Au moins la largeur du titre de la colonne.
  const graphW = Math.max(72, GRAPH_PAD * 2 + Math.max(1, Math.min(layout.width, MAX_LANES)) * laneW);
  const selected = graph?.selected ?? null;
  const selectedIndex = selected ? shas.indexOf(selected) : -1;
  const picked = graph?.picked;
  const pickedSet = useMemo(() => new Set(picked ?? []), [picked]);
  /** Ligne active du clavier : le bout de la plage étendue (Maj+flèches), sinon la sélection. */
  const focusIndex = pickedSet.size > 1 && graph?.focus ? shas.indexOf(graph.focus) : -1;
  const activeIndex = focusIndex >= 0 ? focusIndex : selectedIndex;

  // Recherche (Ctrl+F) parmi les commits chargés : lignes trouvées mises en avant, les
  // autres estompées ; Entrée / Maj+Entrée passent au résultat suivant / précédent.
  const findText = useGraphFind((s) => s.queries[path]);
  const findInput = useRef<HTMLInputElement>(null);
  const givenSet = useGraphFind((s) => s.sets[path]);
  // Filtre par auteurs : leurs commits lus dans git (toutes branches, au-delà des pages chargées).
  const authorEmails = useGraphFind((s) => s.authors[path]);
  const authorKey = authorEmails?.length ? JSON.stringify(authorEmails) : null;
  const [authorShas, setAuthorShas] = useState<{ key: string; shas: string[] } | null>(null);
  const refsSeen = graph?.refs;
  useEffect(() => {
    if (!authorKey) return;
    let live = true;
    api.authorCommits(path, JSON.parse(authorKey) as string[]).then(
      (shas) => live && setAuthorShas({ key: authorKey, shas }),
      (e) => live && useApp.setState({ error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, authorKey, refsSeen]);
  const findSet = givenSet ?? (authorKey && authorShas?.key === authorKey ? { label: authorKey, shas: authorShas.shas } : undefined);
  const query = findText === undefined ? null : findQuery(findText);
  const finding = !!query || !!findSet;
  const matches = useMemo(() => {
    const wanted = findSet ? new Set(findSet.shas) : null;
    if (!query && !wanted) return [];
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (c.sha === WIP || c.side) return;
      if (wanted ? wanted.has(c.sha) : commitMatches(c, query!)) out.push(i);
    });
    return out;
  }, [commits, query, findSet]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const bisect = useBisect((s) => s.states[path]);
  const bisectSet = useMemo(() => (bisect?.candidates.length && !bisect.firstBad ? new Set(bisect.possible.length ? bisect.possible : bisect.candidates) : null), [bisect]);
  /** Marque de bisect d'un commit : à tester, bon, mauvais, passé, premier mauvais. */
  const bisectMark = (sha: string): string | null => {
    if (!bisect) return null;
    if (sha === bisect.firstBad) return "firstBad";
    if (sha === bisect.bad) return "bad";
    if (bisect.good.includes(sha)) return "good";
    if (bisect.skipped.includes(sha)) return "skipped";
    if (sha === bisect.current && bisect.remaining !== null) return "current";
    return null;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      useGraphFind.getState().open(path);
      requestAnimationFrame(() => findInput.current?.select());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  // La liste n'existe qu'une fois l'historique chargé (avant : message de chargement).
  const showList = !!graph && !(graph.commits.length === 0 && graph.loading) && commits.length > 0;

  // Taille de la zone visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = scrollMemory.get(path) ?? 0;
    // Largeur de la barre de défilement verticale : réservée à droite de l'en-tête, pour que
    // ses colonnes tombent sur celles des lignes.
    const measure = () => {
      setViewH(el.clientHeight || 600);
      setScrollbarW(el.offsetWidth - el.clientWidth);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [path, showList]);

  const authorCtx = useAuthorContext(path);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  // Icônes des remotes (étiquettes de branches) : propriétaire du dépôt et provider.
  // Avec un seul remote, l'icône répétée sur chaque étiquette n'apprend rien (le nuage dit
  // déjà « distante ») et prend la place du nom : seulement à partir de deux remotes.
  // Branches extraites dans un autre worktree : marquées sur leur étiquette.
  const worktreeList = useWorktrees((s) => s.lists[path]?.list) ?? NO_WORKTREES;
  useEffect(() => useWorktrees.getState().load(path, graph?.refs ?? null), [path, graph?.refs]);
  const elsewhere = useMemo(() => new Map(worktreeList.filter((w) => !w.current && w.branch && !w.prunable).map((w) => [w.branch!, w])), [worktreeList]);
  const remoteMarks = useMemo(() => {
    const remotes = graph?.refs?.remotes ?? [];
    return new Map(remotes.length > 1 ? remotes.map((r) => [r.name, remoteMarkOf(profiles, binding, r)]) : []);
  }, [graph?.refs?.remotes, profiles, binding]);
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
    drawGraph(canvasRef.current, layout, first, last, graphW, head, shas, palette, sideColor, stashShas, avatarOf, inks);
    // `images.get` lit les images chargées : `images.version` dit quand redessiner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, first, last, graphW, head, shas, palette, sideColor, inks, stashShas, showGraph, avatarsOn, authors, images.version, commits]);

  // Page suivante quand on approche de la fin.
  useEffect(() => {
    if (graph && !graph.done && !graph.loading && !graph.error && !graph.pageError && last > commits.length - PREFETCH_ROWS) {
      loadMore(path);
    }
  }, [graph, last, commits.length, loadMore, path]);

  const headRef = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = scrollRef.current;
    const top = el?.scrollTop ?? 0;
    // L'en-tête est hors de la liste (pas dans le listbox) : il suit le défilement horizontal.
    if (headRef.current) headRef.current.style.transform = `translateX(${-(el?.scrollLeft ?? 0)}px)`;
    scrollMemory.set(path, top);
    setScrollTop(top);
  };

  /** Fait défiler pour que la ligne `i` soit visible. */
  // Dernière ligne de l'historique complet : la marque « Début de l'historique » dessous aussi.
  const tail = useRef({ count: 0, done: false });
  tail.current = { count: commits.length, done: !!graph?.done };
  const ensureVisible = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el || i < 0) return;
    const top = i * ROW_H;
    const bottom = top + (tail.current.done && i === tail.current.count - 1 ? 2 : 1) * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, []);

  // Nouvelle sélection (clavier, barre latérale, parent dans les détails) : on l'amène à l'écran.
  // Pas au montage, pour respecter la position de défilement mémorisée.
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (lastSelected.current === selected) return;
    lastSelected.current = selected;
    ensureVisible(selectedIndex);
  }, [selected, selectedIndex, ensureVisible]);

  // À l'ouverture de l'onglet (ou quand l'historique arrive), le focus va au graphe, l'écran
  // principal, si personne d'autre ne l'a.
  useEffect(() => {
    if (!showList) return;
    const a = document.activeElement;
    if (!a || a === document.body) scrollRef.current?.focus({ preventScroll: true });
  }, [path, showList]);

  /** Sélectionne le résultat suivant (1) ou précédent (-1) de la recherche. */
  const jump = (dir: 1 | -1) => {
    const i = nextMatch(matches, selectedIndex, dir);
    if (i === null) return;
    select(path, shas[i]);
    ensureVisible(i);
  };
  const closeFind = () => {
    useGraphFind.getState().close(path);
    scrollRef.current?.focus();
  };

  /** Menu d'une ligne : la sélection multiple si la ligne en fait partie, la ligne « en
   *  cours », un stash, ou le commit (qui devient alors la sélection). */
  const rowMenu = (i: number): MenuItem[] => {
    const c = commits[i];
    if (!c || !graph) return [];
    if (c.sha === WIP) return wipMenu(t, path, graph.refs?.headBranch ?? null, changes, !!head);
    const stash = stashes.get(c.sha);
    if (stash) return stashMenu(t, path, stash, () => {});
    if (pickedSet.has(c.sha)) return pickedMenu(t, path, orderPicked(graph.commits, picked ?? []), graph.refs);
    select(path, c.sha);
    return [
      { label: t("authorFilter.byAuthor", { name: c.author || c.email }), onClick: () => useGraphFind.getState().showAuthors(path, [c.email]) },
      "sep",
      ...commitMenu(t, path, c.sha, graph.refs),
    ];
  };

  /** Menu de la ligne active au clavier (Maj+F10, touche Menu), ouvert sous son message. */
  const openRowMenu = () => {
    if (activeIndex < 0) return;
    ensureVisible(activeIndex);
    const row = document.getElementById(`commit-${shas[activeIndex]}`);
    const box = (row?.querySelector(".commit-msg") ?? row)?.getBoundingClientRect();
    const items = rowMenu(activeIndex);
    if (box && items.length) useContextMenu.getState().open(box.left, box.bottom, items);
  };

  /** Entrée : le focus passe au panneau de droite (détails du commit ou modifications). */
  const focusPanel = () => {
    const panel = document.querySelector<HTMLElement>("aside.commit-panel");
    // D'abord la liste de fichiers (son arrêt de tabulation), sinon le premier contrôle.
    const target =
      panel?.querySelector<HTMLElement>('[data-fi][tabindex="0"]') ??
      panel?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])');
    target?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Clavier : l'anneau de focus revient (il est masqué après un clic, cf. onMouseDown).
    delete scrollRef.current?.dataset.pointer;
    if (commits.length === 0) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openRowMenu();
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && activeIndex >= 0) {
      e.preventDefault();
      focusPanel();
      return;
    }
    // Recherche en cours : F3 / Maj+F3 passent d'un résultat à l'autre ; Échap ferme la barre.
    if ((finding && e.key === "F3") || ((findText !== undefined || findSet) && e.key === "Escape")) {
      e.preventDefault();
      if (e.key === "F3") jump(e.shiftKey ? -1 : 1);
      else closeFind();
      return;
    }
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
    // Maj+flèche : la plage s'étend depuis son bout (ou le commit sélectionné).
    const extend = e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selected !== null && selected !== WIP;
    const focusIndex = extend && graph?.focus ? shas.indexOf(graph.focus) : -1;
    const from = focusIndex >= 0 ? focusIndex : selectedIndex < 0 ? -1 : selectedIndex;
    let to = Math.max(0, Math.min(commits.length - 1, from + moves[e.key]));
    // Une ligne de stash ne se sélectionne pas : on passe à la suivante dans le même sens,
    // ou dans l'autre en bout de liste (Début sur un stash tout en haut).
    const skip = (i: number, step: number) => {
      while (i >= 0 && i < commits.length && stashShas.has(shas[i])) i += step;
      return i >= 0 && i < commits.length ? i : -1;
    };
    const step = moves[e.key] > 0 ? 1 : -1;
    to = skip(to, step);
    if (to < 0) to = skip(Math.max(0, Math.min(commits.length - 1, from + moves[e.key])), -step);
    if (to < 0) return;
    if (extend) {
      if (shas[to] === WIP) return;
      useGraph.getState().pickRange(path, shas[to]);
      ensureVisible(to);
      return;
    }
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
  /** PR / MR d'une étiquette de branche (locale qui suit, ou distante). */
  const chipPull = (chip: RefChip) => {
    const r = chipRef(chip, graph?.refs ?? null);
    return r ? pullOfRef(pullLists, pullContexts, graph?.refs ?? null, r) : null;
  };

  /** Étiquettes d'un commit : la branche courante d'abord, raccourcie en dernier ; les autres
   *  raccourcies (« … »), puis regroupées en « +N » (liste en infobulle) si elles ne tiennent
   *  pas ; rien ne déborde sur la colonne du graphe. */
  // Avant la première mesure (ou sans mise en page, tests) : tout est montré, comme avant.
  const refsAvailable = (widths.refs ?? (refsW || Infinity)) - REFS_PAD;
  const refsCell = (list: RefChip[], color: number) => {
    const items = list.map((chip) => {
      const mark = avatarsOn && chip.remote ? remoteMarks.get(chip.remote) : undefined;
      const pr = chipPull(chip);
      const worktree = chip.kind === "local" ? elsewhere.get(chip.label) : undefined;
      const size = chipSize(chip, !!mark, pr ? pullRef(pr.ctx.kind, pr.pull.number) : null, !!pr?.pull.checks, !!worktree);
      return { chip, mark, pr, size, worktree };
    });
    const shown = fitChips(items.map((x) => x.size), refsAvailable, MORE_W);
    const hidden = items.slice(shown);
    return (
      <>
        {items.slice(0, shown).map(({ chip, mark, pr, size, worktree }, i) => (
          <Chip
            key={chip.kind + chip.label}
            chip={chip}
            color={color}
            path={path}
            refs={graph?.refs ?? null}
            rules={rules}
            mark={mark}
            pr={pr}
            worktree={worktree}
            // La première, seule à l'étroit : pas plus large que la colonne.
            minWidth={i === 0 ? Math.min(size.min, Math.max(0, refsAvailable)) : size.min}
          />
        ))}
        {hidden.length > 0 && (
          <span className="chip more" title={hidden.map((x) => x.chip.title).join("\n")}>
            +{hidden.length}
          </span>
        )}
      </>
    );
  };

  const cell = (col: Column, c: Commit, color: number, isWip: boolean, isStash: boolean) => {
    switch (col) {
      case "refs":
        return (
          <span key={col} className="commit-refs">
            {refsCell(chips.get(c.sha) ?? [], color)}
          </span>
        );
      case "graph":
        return <span key={col} />;
      case "message":
        return (
          <span key={col} className="commit-msg" onMouseEnter={titleIfCut}>
            {isStash && <Icon name="stash" size={13} className="stash-mark" />}
            {isWip && (
              <span className="wip-mark" aria-hidden="true">
                {t("graph.wipMark")}{" "}
              </span>
            )}
            {!isWip && !isStash && bisectMark(c.sha) && <span className={`bisect-mark ${bisectMark(c.sha)}`}>{t(`bisect.mark.${bisectMark(c.sha)}`)}</span>}
            {isWip ? t("graph.wip", { count: changes }) : c.subject}
          </span>
        );
      case "author":
        return (
          <span key={col} className="commit-author" title={c.email}>
            {avatarsOn && !isWip && !isStash && <AuthorBadge name={c.author} avatar={avatarOfEmail(c.email)} className="author-avatar" />}
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
            {isWip || isStash ? "" : c.sha.slice(0, 7)}
          </span>
        );
    }
  };

  const findPos = matches.indexOf(selectedIndex);
  // Commits de la liste qui ne sont pas (encore) dans les pages chargées.
  const outside = findSet ? findSet.shas.length - matches.length : 0;
  const findBar = (findText !== undefined || findSet || authorEmails) && (
    <div className="graph-find" role="search" aria-label={t("graphFind.label")}>
      <Icon name={authorEmails ? "user" : "search"} size={13} />
      {authorEmails ? (
        <AuthorFilter path={path} selected={authorEmails} />
      ) : findSet ? (
        <span className="graph-find-set" title={findSet.label}>
          {t("graphFind.setLabel", { label: findSet.label })}
        </span>
      ) : (
      <input
        ref={findInput}
        autoFocus
        className="graph-find-input"
        value={findText}
        placeholder={t("graphFind.placeholder")}
        aria-label={t("graphFind.label")}
        spellCheck={false}
        onChange={(e) => useGraphFind.getState().setQuery(path, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            jump(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeFind();
          }
        }}
      />
      )}
      {!givenSet && (
        <button
          className={authorEmails ? "icon-btn sm on" : "icon-btn sm"}
          aria-pressed={!!authorEmails}
          aria-label={t("authorFilter.byAuthorButton")}
          title={authorEmails ? t("authorFilter.byText") : t("authorFilter.byAuthorButton")}
          onClick={() => (authorEmails ? useGraphFind.getState().open(path) : useGraphFind.getState().showAuthors(path, []))}
        >
          <Icon name="user" size={13} />
        </button>
      )}
      <span className="muted graph-find-count" role="status">
        {authorEmails && !authorEmails.length && t("authorFilter.pick")}
        {finding &&
          [
            matches.length === 0
              ? t("graphFind.none")
              : findPos >= 0
                ? t("graphFind.position", { index: findPos + 1, count: matches.length })
                : t("graphFind.count", { count: matches.length }),
            findSet
              ? outside > 0
                ? t("graphFind.outside", { count: outside })
                : null
              : graph.done
                ? null
                : t("graphFind.loaded", { count: graph.commits.length }),
          ]
            .filter(Boolean)
            .join(" · ")}
      </span>
      <button className="icon-btn sm" aria-label={t("graphFind.prev")} title={`${t("graphFind.prev")} (${t("keys.shiftEnter")})`} disabled={!matches.length} onClick={() => jump(-1)}>
        <Icon name="chevron" size={13} className="flip" />
      </button>
      <button className="icon-btn sm" aria-label={t("graphFind.next")} title={`${t("graphFind.next")} (${t("keys.enter")})`} disabled={!matches.length} onClick={() => jump(1)}>
        <Icon name="chevron" size={13} />
      </button>
      <button className="icon-btn sm" aria-label={t("graphFind.close")} title={`${t("graphFind.close")} (${t("keys.escape")})`} onClick={closeFind}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );

  /** Nom d'une ligne pour un lecteur d'écran : message, puis HEAD / fusion, refs, auteur, date, SHA. */
  const rowLabel = (c: GraphLine, isWip: boolean, isStash: boolean) => {
    if (isWip) return t("graph.wip", { count: changes });
    if (isStash) return t("graph.rowStash", { message: c.subject });
    const when = commitDate(c.time * 1000, i18n.language, now);
    const refs = (chips.get(c.sha) ?? []).map((x) => (x.current ? t("graph.rowCurrent", { name: x.label }) : x.label));
    return [
      c.subject,
      c.sha === head && t("graph.rowHead"),
      bisectMark(c.sha) && t(`bisect.mark.${bisectMark(c.sha)}`),
      c.parents.length > 1 && t("graph.rowMerge"),
      refs.length > 0 && refs.join(", "),
      c.author,
      when.key === "date" ? when.text : t(`time.${when.key}`, { count: when.count }),
      c.sha.slice(0, 7),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div className="graph-wrap" style={{ "--cols": cols } as React.CSSProperties}>
      {findBar}
      {/* En-tête hors de la liste : ses boutons et poignées ne sont pas des options. */}
      <div className="graph-head-wrap" style={{ paddingRight: scrollbarW }}>
        <div
          className="graph-head"
          ref={headRef}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          {visible.map((c) => (
            <span key={c} ref={c === "refs" ? setRefsHead : undefined} className={c === "refs" ? "graph-head-cell graph-head-refs" : "graph-head-cell"}>
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
        </div>
        {menuOpen && <ColumnsMenu hidden={hidden} onClose={closeMenu} />}
      </div>
      <div
        className="graph-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        role="listbox"
        aria-label={t("graph.label")}
        aria-multiselectable="true"
        aria-activedescendant={activeIndex >= first && activeIndex < last ? `commit-${shas[activeIndex]}` : undefined}
        onKeyDown={onKeyDown}
        // Après un clic, l'anneau est masqué ; en partant, on le rend pour le prochain retour au clavier.
        onBlur={() => delete scrollRef.current?.dataset.pointer}
        onContextMenu={(e) => {
          // Touche Menu / Maj+F10 : l'événement vise la liste elle-même (un clic droit vise une
          // ligne). Déjà ouvert par le keydown, ou clic droit sur la barre de défilement
          // (bouton 2) : pas de second menu.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          if (e.button === 2 || useContextMenu.getState().menu) return;
          openRowMenu();
        }}
      >
        <div className="graph-body" style={{ height: (commits.length + (graph.done ? 1 : 0)) * ROW_H }}>
          {showGraph && (
            <canvas ref={canvasRef} className="graph-canvas" style={{ top: first * ROW_H, left: canvasLeft }} aria-hidden="true" />
          )}
          {commits.slice(first, last).map((c, k) => {
            const i = first + k;
            const row = layout.rows[i];
            const isWip = c.sha === WIP;
            const stash = stashes.get(c.sha);
            const isStash = !!stash;
            const sel = pickedSet.size > 0 ? !isStash && pickedSet.has(c.sha) : c.sha === selected;
            // Bisect en cours (sans recherche) : hors de la plage restante, estompé.
            const found = finding ? (matchSet.has(i) ? "found" : "dim") : bisectSet && !isWip && !isStash && !bisectSet.has(c.sha) ? "dim" : null;
            const cls = [
              "commit-row",
              isWip && "wip",
              isStash && "stash",
              c.sha === head && "head",
              sel && "sel",
              i === focusIndex && "cursor",
              row.col >= MAX_LANES && "far",
              found,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                key={c.sha}
                id={`commit-${c.sha}`}
                role="option"
                aria-selected={sel}
                aria-setsize={graph.done ? commits.length : -1}
                aria-posinset={i + 1}
                aria-label={rowLabel(c, isWip, isStash)}
                title={stash ? [stash.message, t("stashes.graphHint")].join("\n") : undefined}
                className={cls}
                style={{ top: i * ROW_H }}
                onMouseDown={(e) => {
                  // Garde le focus sur la liste pour la navigation au clavier, sans l'anneau
                  // de focus d'un clic (il revient à la première touche).
                  e.preventDefault();
                  if (scrollRef.current) scrollRef.current.dataset.pointer = "";
                  scrollRef.current?.focus();
                  if (e.button !== 0) return;
                  if (stash) openStash(path, stash);
                  else if (!isWip && (e.ctrlKey || e.metaKey)) useGraph.getState().togglePick(path, c.sha);
                  else if (!isWip && e.shiftKey) useGraph.getState().pickRange(path, c.sha);
                  else if (!isWip && pickedSet.size > 1 && pickedSet.has(c.sha)) {
                    // Dans une sélection multiple : on glisse tout le lot ; un simple clic ne
                    // garde que ce commit, comme avant.
                    const ordered = orderPicked(graph.commits, picked ?? []);
                    startCommitDrag(
                      e,
                      t("multi.dragLabel", { count: ordered.length }),
                      (drop) => {
                        const refs = useGraph.getState().graphs[path]?.refs ?? null;
                        const target = refs?.refs.find((x) => x.name === drop.ref && x.kind === "local");
                        if (target) useContextMenu.getState().open(drop.x, drop.y, pickedDropMenu(t, path, ordered, target, refs));
                      },
                      () => select(path, c.sha),
                    );
                  } else {
                    select(path, c.sha);
                    // Glissé sur une branche locale : menu cherry-pick / reset / déplacer. Pas
                    // depuis l'étiquette d'une branche locale : c'est elle qu'on glisse alors.
                    const fromChip = (e.target as HTMLElement).closest?.(".chip[data-drop-ref]");
                    if (!isWip && !fromChip)
                      startCommitDrag(e, `${c.sha.slice(0, 7)} ${c.subject}`, (drop) => {
                        const refs = useGraph.getState().graphs[path]?.refs ?? null;
                        const target = refs?.refs.find((x) => x.name === drop.ref && x.kind === "local");
                        if (target) useContextMenu.getState().open(drop.x, drop.y, commitDropMenu(t, path, c.sha, target, refs));
                      });
                  }
                }}
                onContextMenu={(e) => openContextMenu(e, rowMenu(i))}
              >
                {visible.map((col) => cell(col, c, row.color, isWip, isStash))}
              </div>
            );
          })}
          {graph.done && (
            <div className="graph-end" style={{ top: commits.length * ROW_H }} aria-hidden="true">
              <span style={{ gridColumn: visible.indexOf("message") + 1 }}>{t("graph.end")}</span>
            </div>
          )}
        </div>
      </div>
      {graph.pageError ? (
        <div className="graph-more error" role="alert">
          <Icon name="alert" size={13} />
          <span>{t("graph.pageError", { error: errorMessage(t, graph.pageError) })}</span>
          <button type="button" className="link notice-action" onClick={() => void useGraph.getState().retryMore(path)}>
            {t("graph.retry")}
          </button>
        </div>
      ) : (
        graph.loading && graph.commits.length > 0 && <div className="graph-more muted" role="status">{t("graph.loadingMore")}</div>
      )}
    </div>
  );
}
