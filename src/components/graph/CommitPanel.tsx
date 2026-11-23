// Panneau de droite : détails du commit sélectionné et liste de ses fichiers.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openContextMenu } from "../ContextMenu";
import { fileMenu } from "./menus";
import { CommitText } from "./CommitText";
import { errorMessage } from "../../lib/errors";
import { LAYOUT, useWidthStyle } from "../../lib/layout";
import { initials } from "../../lib/format";
import type { CommitDetails } from "../../lib/types";
import { useApp } from "../../store/app";
import { detailsKey, useGraph, WIP } from "../../store/graph";
import { Icon } from "../Icon";
import { ResizableBlock } from "../Splitter";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";
import { PickedPanel } from "./PickedPanel";
import { StagingPanel } from "./StagingPanel";

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
  const openDiff = useGraph((s) => s.openDiff);
  const diff = useGraph((s) => s.diffs[path]);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const date = (s: number) => new Date(s * 1000).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const committedBySomeoneElse = d.committer !== d.author || d.committerEmail !== d.email;

  // Auteur et date sur une ligne (déjà visibles dans le graphe) ; e-mail et committer en infobulle.
  const authorTitle = [
    `${d.author} <${d.email}>`,
    committedBySomeoneElse && t("details.committedBy", { name: `${d.committer} <${d.committerEmail}>`, date: date(d.commitTime) }),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <ResizableBlock layoutKey={LAYOUT.details} label={t("layout.details")} className="details-top">
        <div className="details-head">
          <h2 className="details-subject">
            <CommitText path={path} text={d.subject} />
          </h2>
          {d.body && (
            <p className="details-body">
              <CommitText path={path} text={d.body} />
            </p>
          )}
        </div>

        <div className="details-meta">
          <div className="person" title={authorTitle}>
            <span className="avatar" aria-hidden="true">
              {initials(d.author)}
            </span>
            <span className="person-name">{d.author}</span>
            <span className="person-date">· {date(d.time)}</span>
          </div>
          <div className="meta-line">
            <span className="sha-line" title={d.sha}>
              <span className="mono">{d.sha.slice(0, 10)}</span>
              <CopySha sha={d.sha} />
            </span>
            {d.parents.length > 0 && (
              <span className="parents">
                <span className="meta-label">{t("details.parents", { count: d.parents.length })}</span>
                {d.parents.map((p) => (
                  <button key={p} className="link mono" onClick={() => reveal(path, p)}>
                    {p.slice(0, 7)}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
      </ResizableBlock>

      <div className="section-h">
        <span>{t("details.files", { count: d.files.length })}</span>
        <ChangeCounts files={d.files} />
        {d.files.length > 0 && <FileViewToggle />}
      </div>
      {d.parents.length > 1 && <p className="details-note muted">{t("details.merge")}</p>}
      {d.files.length === 0 ? (
        <p className="details-note muted">{t("details.noFiles")}</p>
      ) : (
        <FileList
          files={d.files}
          view={fileView}
          label={t("details.files", { count: d.files.length })}
          isActive={(f) => diff?.sha === d.sha && diff.file.path === f.path}
          onOpen={(f) => openDiff(path, d.sha, f)}
          onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path))}
        />
      )}
    </>
  );
}

export function CommitPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const entry = useGraph((s) => (selected && selected !== WIP ? s.details[detailsKey(path, selected)] : undefined));
  const multi = useGraph((s) => (s.graphs[path]?.picked.length ?? 0) > 1);
  const widthStyle = useWidthStyle(LAYOUT.panel);
  if (multi) return <PickedPanel path={path} />;

  let content;
  if (!selected) {
    content = <p className="panel-empty muted">{t("details.none")}</p>;
  } else if (selected === WIP) {
    return <StagingPanel path={path} />;
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
    <aside className="commit-panel" aria-label={t("details.label")} style={widthStyle}>
      {content}
    </aside>
  );
}
