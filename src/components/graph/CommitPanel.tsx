// Panneau de droite : détails du commit sélectionné et liste de ses fichiers.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { fileTree, type FileNode } from "../../lib/fileTree";
import { initials } from "../../lib/format";
import type { CommitDetails, FileChange, FileViewSetting } from "../../lib/types";
import { useApp } from "../../store/app";
import { detailsKey, useGraph, WIP } from "../../store/graph";
import { Icon } from "../Icon";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`st st-${status}`} title={t(`details.status.${status}`, { defaultValue: status })}>
      {status}
    </span>
  );
}

interface FileRowProps {
  file: FileChange;
  active: boolean;
  onOpen: () => void;
  /** Profondeur dans l'arborescence ; absente en vue liste (le dossier est alors affiché). */
  depth?: number;
}

function FileRow({ file, active, onOpen, depth }: FileRowProps) {
  const slash = file.path.lastIndexOf("/");
  const tree = depth !== undefined;
  return (
    <li>
      <button
        className={active ? "file-row on" : "file-row"}
        style={tree ? ({ "--depth": depth } as React.CSSProperties) : undefined}
        onClick={onOpen}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <StatusBadge status={file.status} />
        <span className="file-name">{file.path.slice(slash + 1)}</span>
        {!tree && slash > 0 && <span className="file-dir">{file.path.slice(0, slash)}</span>}
      </button>
    </li>
  );
}

/** Fichiers d'un commit, en liste à plat ou en arborescence (choix mémorisé dans les réglages). */
function FileList({ path, d, view }: { path: string; d: CommitDetails; view: FileViewSetting }) {
  const { t } = useTranslation();
  const openDiff = useGraph((s) => s.openDiff);
  const diff = useGraph((s) => s.diffs[path]);
  // Dossiers repliés, par chemin (conservés d'un commit à l'autre).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => (view === "tree" ? fileTree(d.files) : []), [view, d.files]);

  const row = (f: FileChange, depth?: number) => (
    <FileRow
      key={f.path}
      file={f}
      depth={depth}
      active={diff?.sha === d.sha && diff.file.path === f.path}
      onOpen={() => openDiff(path, d.sha, f)}
    />
  );

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(dir)) next.add(dir);
      return next;
    });

  const renderNodes = (nodes: FileNode[], depth: number): React.ReactNode =>
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
    <ul className={view === "tree" ? "file-list tree" : "file-list"} aria-label={t("details.files", { count: d.files.length })}>
      {view === "tree" ? renderNodes(tree, 0) : d.files.map((f) => row(f))}
    </ul>
  );
}

function FileViewToggle() {
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

function CopySha({ sha }: { sha: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      className="icon-btn sm"
      aria-label={t("details.copy")}
      title={copied ? t("details.copied") : t("details.copy")}
      onClick={() => {
        navigator.clipboard?.writeText(sha).then(() => setCopied(true), () => {});
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

function Details({ path, d }: { path: string; d: CommitDetails }) {
  const { t, i18n } = useTranslation();
  const reveal = useGraph((s) => s.reveal);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const date = (s: number) => new Date(s * 1000).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const committedBySomeoneElse = d.committer !== d.author || d.committerEmail !== d.email;

  return (
    <>
      <div className="details-head">
        <h2 className="details-subject">{d.subject}</h2>
        {d.body && <p className="details-body">{d.body}</p>}
      </div>

      <div className="details-meta">
        <div className="person">
          <span className="avatar" aria-hidden="true">
            {initials(d.author)}
          </span>
          <span className="person-text">
            <span className="person-name">{d.author}</span>
            <span className="person-mail">{d.email}</span>
          </span>
        </div>
        <dl>
          <dt>{t("details.date")}</dt>
          <dd>{date(d.time)}</dd>
          {committedBySomeoneElse && (
            <>
              <dt>{t("details.committer")}</dt>
              <dd>
                {d.committer} · {date(d.commitTime)}
              </dd>
            </>
          )}
          <dt>{t("details.sha")}</dt>
          <dd className="sha-line">
            <span className="mono">{d.sha}</span>
            <CopySha sha={d.sha} />
          </dd>
          {d.parents.length > 0 && (
            <>
              <dt>{t("details.parents", { count: d.parents.length })}</dt>
              <dd className="parents">
                {d.parents.map((p) => (
                  <button key={p} className="link mono" onClick={() => reveal(path, p)}>
                    {p.slice(0, 7)}
                  </button>
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>

      <div className="section-h">
        <span>{t("details.files", { count: d.files.length })}</span>
        {d.files.length > 0 && <FileViewToggle />}
      </div>
      {d.parents.length > 1 && <p className="details-note muted">{t("details.merge")}</p>}
      {d.files.length === 0 ? (
        <p className="details-note muted">{t("details.noFiles")}</p>
      ) : (
        <FileList path={path} d={d} view={fileView} />
      )}
    </>
  );
}

export function CommitPanel({ path, changes }: { path: string; changes: number }) {
  const { t } = useTranslation();
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const entry = useGraph((s) => (selected && selected !== WIP ? s.details[detailsKey(path, selected)] : undefined));

  let content;
  if (!selected) {
    content = <p className="panel-empty muted">{t("details.none")}</p>;
  } else if (selected === WIP) {
    content = (
      <div className="details-head">
        <h2 className="details-subject">{t("details.wipTitle")}</h2>
        <p className="details-body">{t("details.wipBody", { count: changes })}</p>
        <p className="details-note muted">{t("details.wipSoon")}</p>
      </div>
    );
  } else if (entry?.error) {
    content = (
      <div className="notice error" role="alert">
        <Icon name="alert" />
        {errorMessage(t, entry.error)}
      </div>
    );
  } else if (!entry?.data) {
    content = <p className="panel-empty muted">{t("details.loading")}</p>;
  } else {
    content = <Details path={path} d={entry.data} />;
  }

  return (
    <aside className="commit-panel" aria-label={t("details.label")}>
      {content}
    </aside>
  );
}
