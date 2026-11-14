// Panneau de droite : détails du commit sélectionné et liste de ses fichiers.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { initials } from "../../lib/format";
import type { CommitDetails } from "../../lib/types";
import { useApp } from "../../store/app";
import { detailsKey, useGraph, WIP } from "../../store/graph";
import { Icon } from "../Icon";
import { FileList, FileViewToggle } from "./FileList";
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
        <FileList
          files={d.files}
          view={fileView}
          label={t("details.files", { count: d.files.length })}
          isActive={(f) => diff?.sha === d.sha && diff.file.path === f.path}
          onOpen={(f) => openDiff(path, d.sha, f)}
        />
      )}
    </>
  );
}

export function CommitPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const entry = useGraph((s) => (selected && selected !== WIP ? s.details[detailsKey(path, selected)] : undefined));

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
    <aside className="commit-panel" aria-label={t("details.label")}>
      {content}
    </aside>
  );
}
