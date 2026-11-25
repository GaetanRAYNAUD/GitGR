// Liste de fichiers (commit ou copie de travail), à plat ou en arborescence,
// avec badge de statut et actions optionnelles par fichier.
// Au clavier : une seule tabulation par liste (listbox, ou tree en arborescence), ↑ / ↓ /
// Début / Fin d'un fichier à l'autre (le diff suit), Maj+↑ / ↓ étend la sélection, Ctrl+A la
// prend entière, Espace = l'action du double-clic (indexer / retirer), Suppr = annuler,
// → / ← déplient ou replient un dossier, Maj+F10 = menu.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fileTree, type FileNode } from "../../lib/fileTree";
import type { FileViewSetting } from "../../lib/types";
import { useApp } from "../../store/app";
import { Icon } from "../Icon";

export interface ListFile {
  path: string;
  oldPath: string | null;
  status: string;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  // « ? » (non suivi) n'est pas utilisable tel quel dans un nom de classe.
  const cls = status === "?" ? "st-N" : `st-${status}`;
  // La lettre est décorative pour un lecteur d'écran : le statut est dans la description de la ligne.
  return (
    <span className={`st ${cls}`} aria-hidden="true" title={t(`details.status.${status === "?" ? "N" : status}`, { defaultValue: status })}>
      {status === "?" ? "+" : status}
    </span>
  );
}

/** Catégories de compteurs, dans l'ordre d'affichage, avec leur signe. */
const COUNT_KINDS = [
  { key: "added", sign: "+", cls: "st-A" },
  { key: "modified", sign: "~", cls: "st-M" },
  { key: "renamed", sign: "→", cls: "st-R" },
  { key: "deleted", sign: "−", cls: "st-D" },
  { key: "conflicted", sign: "!", cls: "st-U" },
] as const;

type CountKind = (typeof COUNT_KINDS)[number]["key"];

/** Catégorie d'un statut de fichier (commit ou copie de travail). */
export function countKind(status: string): CountKind {
  switch (status) {
    case "A":
    case "C":
    case "?":
      return "added";
    case "R":
      return "renamed";
    case "D":
      return "deleted";
    case "U":
      return "conflicted";
    default:
      return "modified"; // M, T
  }
}

/** Nombre de fichiers par catégorie : `+2 ~3 →1 −1` (catégories vides omises). */
export function ChangeCounts({ files }: { files: { status: string }[] }) {
  const { t } = useTranslation();
  const counts = new Map<CountKind, number>();
  for (const f of files) {
    const k = countKind(f.status);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const shown = COUNT_KINDS.filter((k) => counts.has(k.key));
  if (shown.length === 0) return null;
  const label = shown.map((k) => t(`details.counts.${k.key}`, { count: counts.get(k.key) })).join(", ");
  return (
    <span className="change-counts" role="img" aria-label={label} title={label}>
      {shown.map((k) => (
        <span key={k.key} className={k.cls}>
          {k.sign}
          {counts.get(k.key)}
        </span>
      ))}
    </span>
  );
}

interface Props<T extends ListFile> {
  files: T[];
  view: FileViewSetting;
  /** Nom accessible de la liste. */
  label: string;
  isActive: (f: T) => boolean;
  onOpen: (f: T) => void;
  onDoubleClick?: (f: T) => void;
  /** Clic droit sur un fichier (menu : ouvrir, montrer dans le dossier, copier le chemin). */
  onContextMenu?: (e: React.MouseEvent, f: T) => void;
  /** Boutons affichés au survol de la ligne. */
  actions?: (f: T) => ReactNode;
  /** Clic droit sur un dossier (arborescence) : ses fichiers, dans l'ordre de la liste. */
  onDirContextMenu?: (e: React.MouseEvent, dir: string, files: T[]) => void;
  /** Sélection multiple (chemins) : Ctrl+clic ajoute ou retire, Maj+clic prend la plage,
   *  Ctrl+clic sur un dossier prend ou laisse tous ses fichiers. */
  selected?: ReadonlySet<string>;
  onSelect?: (next: Set<string>) => void;
  /** Espace : la sélection (ou le fichier) — indexer / retirer. Sans : Espace ouvre le fichier. */
  onSpace?: (files: T[]) => void;
  /** Suppr : la sélection (ou le fichier) — annuler les modifications. */
  onDelete?: (files: T[]) => void;
  /** Précision lue après le statut (« aussi en partie indexé »). */
  describe?: (f: T) => string | null;
}

/** Fichiers d'un nœud de l'arborescence, dans l'ordre d'affichage. */
function nodeFiles<T extends ListFile>(nodes: FileNode<T>[], out: T[] = []): T[] {
  for (const n of nodes) {
    if (n.type === "file") out.push(n.file);
    else nodeFiles(n.children, out);
  }
  return out;
}

export function FileList<T extends ListFile>({
  files,
  view,
  label,
  isActive,
  onOpen,
  onDoubleClick,
  onContextMenu,
  actions,
  onDirContextMenu,
  selected,
  onSelect,
  onSpace,
  onDelete,
  describe,
}: Props<T>) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  /** Clé (`data-fi`) de l'élément qui porte l'arrêt de tabulation. */
  const [stop, setStop] = useState<string | null>(null);
  // Dossiers repliés, par chemin (conservés d'un commit à l'autre).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => (view === "tree" ? fileTree(files) : []), [view, files]);
  /** Ordre d'affichage des fichiers (plage du Maj+clic). */
  const order = useMemo(() => (view === "tree" ? nodeFiles(tree) : files), [view, tree, files]);
  /** Point de départ du Maj+clic : le dernier fichier cliqué. */
  const anchor = useRef<string | null>(null);

  const click = (e: React.MouseEvent, f: T) => {
    if (onSelect && (e.ctrlKey || e.metaKey)) {
      const next = new Set(selected);
      if (!next.delete(f.path)) next.add(f.path);
      anchor.current = f.path;
      onSelect(next);
      return;
    }
    if (onSelect && e.shiftKey && anchor.current) {
      const a = order.findIndex((x) => x.path === anchor.current);
      const b = order.findIndex((x) => x.path === f.path);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        onSelect(new Set(order.slice(from, to + 1).map((x) => x.path)));
        return;
      }
    }
    anchor.current = f.path;
    onSelect?.(new Set([f.path]));
    onOpen(f);
  };

  // Arrêt de tabulation : celui retenu, sinon le fichier ouvert, sinon le premier.
  const fileKey = (f: T) => `f:${f.path}`;
  const stopKey = (() => {
    const keys = view === "tree" ? null : files.map(fileKey);
    if (stop && (keys ? keys.includes(stop) : true)) return stop;
    const open = order.find((f) => isActive(f));
    return open ? fileKey(open) : order[0] ? fileKey(order[0]) : null;
  })();
  // En arborescence, l'arrêt retenu peut être un dossier replié depuis : on le vérifie au DOM.
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const items = [...ul.querySelectorAll<HTMLElement>("[data-fi]")];
    const keep = items.find((i) => i.dataset.fi === stopKey) ?? items[0];
    for (const i of items) i.tabIndex = i === keep ? 0 : -1;
    // Les boutons d'une ligne (Indexer, poubelle…) : à la souris et au survol ; au clavier,
    // Espace / Suppr / Maj+F10 les remplacent (pas d'arrêt de tabulation par fichier).
    ul.querySelectorAll<HTMLElement>(".file-actions button").forEach((b) => (b.tabIndex = -1));
  });

  /** Fichiers visés par une touche : la sélection si la ligne en fait partie, sinon elle seule. */
  const targets = (f: T) => (selected && selected.size > 1 && selected.has(f.path) ? order.filter((x) => selected.has(x.path)) : [f]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ul = listRef.current;
    const cur = (e.target as HTMLElement).closest<HTMLElement>("[data-fi]");
    if (!ul || !cur || e.target !== cur) return;
    const items = [...ul.querySelectorAll<HTMLElement>("[data-fi]")];
    const i = items.indexOf(cur);
    const file = order.find((f) => fileKey(f) === cur.dataset.fi);
    const goTo = (j: number, extend: boolean) => {
      const next = items[Math.max(0, Math.min(items.length - 1, j))];
      if (!next) return;
      next.focus();
      next.scrollIntoView({ block: "nearest" });
      const f = order.find((x) => fileKey(x) === next.dataset.fi);
      if (!f) return;
      if (extend && onSelect && anchor.current) {
        const a = order.findIndex((x) => x.path === anchor.current);
        const b = order.indexOf(f);
        const [from, to] = a < b ? [a, b] : [b, a];
        onSelect(new Set(order.slice(from, to + 1).map((x) => x.path)));
      } else {
        // Comme un clic : le fichier choisi, son diff à côté.
        anchor.current = f.path;
        onSelect?.(new Set([f.path]));
        onOpen(f);
      }
    };
    const moves: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 };
    if (e.key in moves && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!anchor.current && file) anchor.current = file.path;
      return goTo(moves[e.key], e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && onSelect) {
      // La liste entière, pas le texte de la page.
      e.preventDefault();
      onSelect(new Set(order.map((x) => x.path)));
      return;
    }
    const expanded = cur.getAttribute("aria-expanded");
    if (e.key === "ArrowRight" && expanded !== null) {
      e.preventDefault();
      if (expanded === "false") cur.click();
      else goTo(i + 1, false);
      return;
    }
    if (e.key === "ArrowLeft" && view === "tree") {
      e.preventDefault();
      if (expanded === "true") return cur.click();
      const parent = cur.dataset.fiParent && items.find((x) => x.dataset.fi === cur.dataset.fiParent);
      if (parent) parent.focus();
      return;
    }
    if (!file) return;
    if (e.key === " " && onSpace) {
      e.preventDefault();
      onSpace(targets(file));
    } else if (e.key === "Delete" && onDelete) {
      e.preventDefault();
      onDelete(targets(file));
    }
  };

  const row = (f: T, depth?: number, parent?: string) => {
    const slash = f.path.lastIndexOf("/");
    const inTree = depth !== undefined;
    const picked = !!selected?.has(f.path) && selected.size > 1;
    const status = t(`details.status.${f.status === "?" ? "N" : f.status}`, { defaultValue: f.status });
    const description = [status, f.oldPath ? t("fileHistory.renamedFrom", { path: f.oldPath }) : slash > 0 && f.path.slice(0, slash), describe?.(f)].filter(Boolean).join(", ");
    return (
      <li key={f.path} className="file-item" role="none">
        <button
          className={["file-row", isActive(f) && "on", picked && "picked"].filter(Boolean).join(" ")}
          role={inTree ? "treeitem" : "option"}
          aria-selected={isActive(f) || !!selected?.has(f.path)}
          aria-label={f.path.slice(slash + 1)}
          aria-description={description}
          aria-level={inTree ? depth + 1 : undefined}
          data-fi={fileKey(f)}
          data-fi-parent={parent}
          onFocus={() => setStop(fileKey(f))}
          style={inTree ? ({ "--depth": depth } as React.CSSProperties) : undefined}
          onClick={(e) => click(e, f)}
          onDoubleClick={onDoubleClick && (() => onDoubleClick(f))}
          onContextMenu={onContextMenu && ((e) => onContextMenu(e, f))}
          title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
        >
          <StatusBadge status={f.status} />
          <span className="file-name">{f.path.slice(slash + 1)}</span>
          {!inTree && slash > 0 && <span className="file-dir">{f.path.slice(0, slash)}</span>}
        </button>
        {actions && <span className="file-actions">{actions(f)}</span>}
      </li>
    );
  };

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(dir)) next.add(dir);
      return next;
    });

  const renderNodes = (nodes: FileNode<T>[], depth: number, parent?: string): ReactNode =>
    nodes.map((n) => {
      if (n.type === "file") return row(n.file, depth, parent);
      const open = !collapsed.has(n.path);
      const inside = nodeFiles(n.children);
      const all = inside.length > 0 && inside.every((f) => selected?.has(f.path));
      const key = `d:${n.path}`;
      return (
        <li key={`dir:${n.path}`} role="none">
          <button
            className={all && selected!.size > 1 ? "file-row file-dir-row picked" : "file-row file-dir-row"}
            style={{ "--depth": depth } as React.CSSProperties}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={all}
            data-fi={key}
            data-fi-parent={parent}
            onFocus={() => setStop(key)}
            aria-expanded={open}
            onClick={(e) => {
              if (onSelect && (e.ctrlKey || e.metaKey)) {
                const next = new Set(selected);
                for (const f of inside) {
                  if (all) next.delete(f.path);
                  else next.add(f.path);
                }
                onSelect(next);
              } else toggle(n.path);
            }}
            onContextMenu={onDirContextMenu && ((e) => onDirContextMenu(e, n.path, inside))}
            title={n.path}
          >
            <Icon name="chevron" size={12} className={open ? "chev" : "chev closed"} />
            <Icon name="folder" size={14} />
            <span className="file-dir-name">{n.name}</span>
            <span className="side-meta">{n.count}</span>
          </button>
          {open && <ul role="group">{renderNodes(n.children, depth + 1, key)}</ul>}
        </li>
      );
    });

  return (
    <ul
      ref={listRef}
      className={view === "tree" ? "file-list tree" : "file-list"}
      role={view === "tree" ? "tree" : "listbox"}
      aria-multiselectable={onSelect ? true : undefined}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {view === "tree" ? renderNodes(tree, 0) : files.map((f) => row(f))}
    </ul>
  );
}

export function FileViewToggle() {
  const { t } = useTranslation();
  const view = useApp((s) => s.settings.fileView ?? "list");
  const update = useApp((s) => s.updateSettings);
  const options: FileViewSetting[] = ["list", "tree"];
  return (
    <div className="view-toggle" role="group" aria-label={t("details.fileView")}>
      {options.map((o) => (
        <button
          key={o}
          className={view === o ? "on" : undefined}
          aria-pressed={view === o}
          aria-label={t(`details.view.${o}`)}
          title={t(`details.view.${o}`)}
          onClick={() => update({ fileView: o })}
        >
          <Icon name={o} size={14} />
        </button>
      ))}
    </div>
  );
}
