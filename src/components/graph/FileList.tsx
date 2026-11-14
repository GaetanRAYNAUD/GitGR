// Liste de fichiers (commit ou copie de travail), à plat ou en arborescence,
// avec badge de statut et actions optionnelles par fichier.

import { useMemo, useState, type ReactNode } from "react";
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
  return (
    <span className={`st ${cls}`} title={t(`details.status.${status === "?" ? "N" : status}`, { defaultValue: status })}>
      {status === "?" ? "+" : status}
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
  /** Boutons affichés au survol de la ligne. */
  actions?: (f: T) => ReactNode;
}

export function FileList<T extends ListFile>({ files, view, label, isActive, onOpen, onDoubleClick, actions }: Props<T>) {
  // Dossiers repliés, par chemin (conservés d'un commit à l'autre).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => (view === "tree" ? fileTree(files) : []), [view, files]);

  const row = (f: T, depth?: number) => {
    const slash = f.path.lastIndexOf("/");
    const inTree = depth !== undefined;
    return (
      <li key={f.path} className="file-item">
        <button
          className={isActive(f) ? "file-row on" : "file-row"}
          style={inTree ? ({ "--depth": depth } as React.CSSProperties) : undefined}
          onClick={() => onOpen(f)}
          onDoubleClick={onDoubleClick && (() => onDoubleClick(f))}
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

  const renderNodes = (nodes: FileNode<T>[], depth: number): ReactNode =>
    nodes.map((n) => {
      if (n.type === "file") return row(n.file, depth);
      const open = !collapsed.has(n.path);
      return (
        <li key={`dir:${n.path}`}>
          <button
            className="file-row file-dir-row"
            style={{ "--depth": depth } as React.CSSProperties}
            aria-expanded={open}
            onClick={() => toggle(n.path)}
            title={n.path}
          >
            <Icon name="chevron" size={12} className={open ? "chev" : "chev closed"} />
            <Icon name="folder" size={14} />
            <span className="file-dir-name">{n.name}</span>
            <span className="side-meta">{n.count}</span>
          </button>
          {open && <ul>{renderNodes(n.children, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <ul className={view === "tree" ? "file-list tree" : "file-list"} aria-label={label}>
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
