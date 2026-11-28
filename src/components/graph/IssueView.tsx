// Une issue, ouverte à la place du graphe : titre, état, auteur, assignés, étiquettes, jalon,
// description et commentaires (Markdown) ; commenter (Ctrl+Entrée), fermer / rouvrir,
// s'assigner, créer une branche pour elle, ouvrir sur la forge.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { IssueAction } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { detailKey, useIssues } from "../../store/issues";
import { useOps } from "../../store/ops";
import { accountLogin, type PullContext } from "../../store/pullList";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";
import { PersonAvatar } from "../PersonAvatar";
import { useEscape, useReturnFocus } from "./DiffBody";
import { BackButton } from "./DiffView";
import { RetryNotice, useCommitWhen } from "./viewKit";

export function IssueView({ path, ctx, number }: { path: string; ctx: PullContext; number: number }) {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(sectionRef);
  const close = useIssues((s) => s.close);
  const back = useCallback(() => {
    returnFocus();
    close(path);
  }, [close, path, returnFocus]);
  useEscape(back);
  const entry = useIssues((s) => s.details[detailKey(ctx, number)]);
  const d = entry?.detail;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { when, full } = useCommitWhen();
  const people = { kind: ctx.kind, url: ctx.url, account: ctx.account };
  const me = accountLogin(ctx.account);

  const act = async (name: string, action: IssueAction) => {
    setBusy(name);
    setError(null);
    try {
      await api.issueAction(ctx.kind, ctx.url, ctx.account, ctx.repo, number, action);
      if (action.type === "comment") setDraft("");
      await useIssues.getState().loadDetail(ctx, number);
      void useIssues.getState().ensure(ctx, "all", true);
      void useIssues.getState().ensure(ctx, "mine", true);
    } catch (e) {
      setError(errorCode(e));
    } finally {
      setBusy(null);
    }
  };

  const createBranch = async () => {
    if (!d) return;
    const name = await api.issueBranchName(d.number, d.title, "").catch(() => `${d.number}`);
    const head = useGraph.getState().graphs[path]?.refs?.headBranch ?? "HEAD";
    await useOps.getState().newBranch(path, null, head, name);
  };

  return (
    <section ref={sectionRef} className="pull-view issue-view" aria-label={t("issues.label", { number })}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <span className="pull-view-title">{d ? `#${d.number} ${d.title}` : `#${number}`}</span>
        {d && (
          <span className={`pull-state ${d.state === "open" ? "open" : "closed"}`}>
            <Icon name={d.state === "open" ? "comment" : "check"} size={12} />
            {t(`issues.state.${d.state}`)}
          </span>
        )}
        {d && (
          <button className="icon-btn" aria-label={t("issues.openForge")} title={t("issues.openForge")} onClick={() => void api.openUrl(d.url).catch(() => {})}>
            <Icon name="external" size={14} />
          </button>
        )}
      </header>
      {entry?.error && <RetryNotice error={entry.error} onRetry={() => void useIssues.getState().loadDetail(ctx, number)} />}
      {!d ? (
        !entry?.error && <p className="muted pull-pad">{t("details.loading")}</p>
      ) : (
        <div className="issue-body">
          <div className="pull-view-meta">
            {d.author && <PersonAvatar ctx={people} person={d.author} size={18} />}
            <span>{t("issues.openedBy", { name: d.author?.name ?? d.author?.login ?? "?", when: when(d.created) })}</span>
            {d.milestone && <span className="issue-milestone">{t("issues.milestone", { name: d.milestone })}</span>}
            {d.labels.map((l) => (
              <span key={l.name} className="issue-label" style={l.color ? ({ "--label": `#${l.color}` } as React.CSSProperties) : undefined}>
                {l.name}
              </span>
            ))}
            <span className="issue-assignees">
              {d.assignees.length ? t("issues.assignedTo", { names: d.assignees.map((a) => a.name ?? a.login).join(", ") }) : t("issues.unassigned")}
            </span>
          </div>
          <div className="issue-actions">
            {me && !d.assignees.some((a) => a.login === me) && (
              <button className="btn sm" disabled={!!busy} onClick={() => void act("assign", { type: "assign", login: me, id: 0 })}>
                {t("issues.assignMe")}
              </button>
            )}
            <button className="btn sm" disabled={!!busy} onClick={() => void createBranch()}>
              {t("issues.branch")}
            </button>
            <button className="btn sm" disabled={!!busy} onClick={() => void act("state", { type: d.state === "open" ? "close" : "reopen" })}>
              {t(d.state === "open" ? "issues.close" : "issues.reopen")}
            </button>
          </div>
          {error && (
            <p className="notice error conflict-error" role="alert">
              <Icon name="alert" size={14} />
              <span>{errorMessage(t, error)}</span>
            </p>
          )}
          <Markdown text={d.body} className="pull-text issue-text" empty={<p className="muted">{t("issues.noBody")}</p>} />
          <ol className="issue-comments" aria-label={t("issues.commentsLabel", { count: d.commentsList.length })}>
            {d.commentsList.map((c) => (
              <li key={c.id} className="issue-comment">
                <div className="issue-comment-head">
                  {c.author && <PersonAvatar ctx={people} person={c.author} size={16} />}
                  <strong>{c.author?.name ?? c.author?.login}</strong>
                  <span className="muted" title={full(c.at)}>
                    {when(c.at)}
                  </span>
                </div>
                <Markdown text={c.body} className="pull-text" />
              </li>
            ))}
          </ol>
          <div className="issue-reply">
            <textarea
              className="pf-input"
              rows={3}
              value={draft}
              placeholder={t("issues.commentPlaceholder")}
              aria-label={t("issues.comment")}
              disabled={busy === "comment"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim()) {
                  e.preventDefault();
                  void act("comment", { type: "comment", body: draft });
                }
              }}
            />
            <button className="btn sm primary" disabled={!draft.trim() || !!busy} title="Ctrl+Entrée" onClick={() => void act("comment", { type: "comment", body: draft })}>
              {t("issues.comment")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
