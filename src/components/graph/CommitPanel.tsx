// Panneau de droite : détails du commit sélectionné et liste de ses fichiers.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openContextMenu } from "../ContextMenu";
import { AuthorBadge, useAuthorContext } from "./CommitGraph";
import { fileMenu } from "./menus";
import { CommitText, jumpBack, jumpTo, panelNav } from "./CommitText";
import { errorMessage } from "../../lib/errors";
import { LAYOUT, useWidthStyle } from "../../lib/layout";
import type { CommitDetails } from "../../lib/types";
import { useApp } from "../../store/app";
import { useAuthorAvatars } from "../../store/avatars";
import { detailsKey, useGraph, WIP } from "../../store/graph";
import { Icon } from "../Icon";
import { ResizableBlock } from "../Splitter";
import { ChangeCounts, FileList, FileViewToggle } from "./FileList";
import { PickedPanel } from "./PickedPanel";
import { StagingPanel } from "./StagingPanel";

/** Longueur d'un SHA abrégé, comme dans le graphe. */
const SHORT = 7;

function CopySha({ sha }: { sha: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const id = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(id);
  }, [state]);
  const title = state === "copied" ? t("details.copied") : state === "failed" ? t("details.copyFailed") : t("details.copy");
  return (
    <>
      <button
        type="button"
        className="icon-btn sm"
        aria-label={t("details.copy")}
        title={title}
        onClick={() => {
          const done = navigator.clipboard?.writeText(sha);
          if (!done) return setState("failed");
          done.then(
            () => setState("copied"),
            () => setState("failed"),
          );
        }}
      >
        <Icon name={state === "copied" ? "check" : state === "failed" ? "alert" : "copy"} size={14} />
      </button>
      {/* Résultat de la copie annoncé aux lecteurs d'écran. */}
      <span className="visually-hidden" role="status">
        {state === "idle" ? "" : title}
      </span>
    </>
  );
}

function Details({ path, d }: { path: string; d: CommitDetails }) {
  const { t, i18n } = useTranslation();
  const openDiff = useGraph((s) => s.openDiff);
  const diff = useGraph((s) => s.diffs[path]);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const email = d.email.toLowerCase();
  const avatar = useAuthorAvatars(useAuthorContext(path), email ? [email] : [])[email];
  const subjectRef = useRef<HTMLHeadingElement>(null);
  const date = (s: number) => new Date(s * 1000).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const otherCommitter = d.committer !== d.author || d.committerEmail !== d.email;
  // Rebase, amend, cherry-pick : même personne, autre date (à la minute près, comme affichée).
  const otherDate = date(d.commitTime) !== date(d.time);

  // Arrivé ici depuis un parent, un SHA cité ou Alt+← : le focus va au titre du commit (lu
  // par les lecteurs d'écran), d'où l'on continue au clavier.
  useEffect(() => {
    if (panelNav.focus !== d.sha) return;
    panelNav.focus = null;
    subjectRef.current?.focus();
  }, [d.sha]);

  return (
    <>
      <ResizableBlock layoutKey={LAYOUT.details} label={t("layout.details")} className="details-top">
        <div className="details-head">
          <h2 className="details-subject" tabIndex={-1} ref={subjectRef}>
            <CommitText path={path} sha={d.sha} text={d.subject} />
          </h2>
          {d.body && (
            <p className="details-body">
              <CommitText path={path} sha={d.sha} text={d.body} />
            </p>
          )}
        </div>

        <div className="details-meta">
          <div className="person">
            <AuthorBadge name={d.author} avatar={avatar} className="author-avatar details-avatar" />
            <div className="person-text">
              <div className="person-id" title={`${d.author} <${d.email}>`}>
                <span className="person-name">{d.author}</span> <span className="person-email">{d.email}</span>
              </div>
              <time className="person-date" dateTime={new Date(d.time * 1000).toISOString()}>
                {date(d.time)}
              </time>
              {(otherCommitter || otherDate) && (
                <div className="person-committer">
                  {otherCommitter
                    ? t("details.committedBy", { name: `${d.committer} <${d.committerEmail}>`, date: date(d.commitTime) })
                    : t("details.committedOn", { date: date(d.commitTime) })}
                </div>
              )}
            </div>
          </div>
          <div className="meta-line">
            <span className="sha-line">
              <span className="mono" title={d.sha}>
                {d.sha}
              </span>
              <CopySha sha={d.sha} />
            </span>
            {d.parents.length > 0 && (
              <span className="parents">
                <span className="meta-label">{t("details.parents", { count: d.parents.length })}</span>
                {d.parents.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="link mono"
                    title={t("details.selectCommit")}
                    aria-label={t("details.parentLabel", { sha: p.slice(0, SHORT) })}
                    onClick={() => void jumpTo(path, d.sha, p)}
                  >
                    {p.slice(0, SHORT)}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
      </ResizableBlock>

      <div className="section-h">
        <span className="section-h-label">{t("details.files", { count: d.files.length })}</span>
        <ChangeCounts files={d.files} />
        {d.files.length > 0 && <FileViewToggle />}
      </div>
      {d.parents.length > 1 && <p className="details-note muted">{t("details.merge", { sha: d.parents[0].slice(0, SHORT) })}</p>}
      {d.files.length === 0 ? (
        <p className="details-note muted">{t("details.noFiles")}</p>
      ) : (
        <FileList
          files={d.files}
          view={fileView}
          label={t("details.files", { count: d.files.length })}
          isActive={(f) => diff?.sha === d.sha && diff.file.path === f.path}
          onOpen={(f) => openDiff(path, d.sha, f)}
          onContextMenu={(e, f) => openContextMenu(e, fileMenu(t, path, f.path, { rev: d.sha, deleted: f.status === "D", change: f }))}
        />
      )}
    </>
  );
}

/** Vrai seulement si `on` dure plus de `ms` : pas de « Chargement… » qui clignote en
 *  parcourant le graphe. */
function useLate(on: boolean, ms = 150): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) return setLate(false);
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [on, ms]);
  return on && late;
}

export function CommitPanel({ path }: { path: string }) {
  const { t } = useTranslation();
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const entry = useGraph((s) => (selected && selected !== WIP ? s.details[detailsKey(path, selected)] : undefined));
  const loadDetails = useGraph((s) => s.loadDetails);
  const multi = useGraph((s) => (s.graphs[path]?.picked.length ?? 0) > 1);
  const widthStyle = useWidthStyle(LAYOUT.panel);
  const showLoading = useLate(!!selected && selected !== WIP && !entry?.data && !entry?.error);
  // Sélection changée ailleurs (graphe, barre latérale) : Alt+← ne remonte plus ce chemin.
  useEffect(() => {
    if (selected !== panelNav.target) {
      panelNav.back.delete(path);
      panelNav.focus = null;
      panelNav.seq++;
    }
    panelNav.target = null;
  }, [path, selected]);
  if (multi) return <PickedPanel path={path} />;
  if (selected === WIP) return <StagingPanel path={path} />;

  let content;
  if (!selected) {
    content = (
      <div className="panel-empty">
        <p className="muted">{t("details.none")}</p>
        <p className="faint">{t("details.noneHint")}</p>
      </div>
    );
  } else if (entry?.error) {
    content = (
      <div className="details-error" role="alert">
        <p>
          <Icon name="alert" size={14} />
          {errorMessage(t, entry.error)}
        </p>
        <button type="button" className="btn sm" onClick={() => void loadDetails(path, selected)}>
          {t("details.retry")}
        </button>
      </div>
    );
  } else if (!entry?.data) {
    content = showLoading ? (
      <p className="panel-empty muted" role="status">
        {t("details.loading")}
      </p>
    ) : null;
  } else {
    content = <Details path={path} d={entry.data} />;
  }

  return (
    <aside
      className="commit-panel"
      aria-label={t("details.label")}
      style={widthStyle}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && jumpBack(path)) e.preventDefault();
      }}
    >
      {content}
    </aside>
  );
}
