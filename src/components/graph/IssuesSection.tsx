// Section « Issues » de la barre latérale : les issues ouvertes des remotes GitHub / GitLab du
// dépôt (toutes, ou les miennes). Clic : vue de l'issue à la place du graphe. Rien n'est lu tant
// que la section est masquée (le parent ne la monte pas).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { sectionKey } from "../../lib/layout";
import type { IssueSummary, RepoUi } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { type IssueFilter, listKey, useIssues } from "../../store/issues";
import { pullCtxKey, type PullContext } from "../../store/pullList";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { PersonAvatar } from "../PersonAvatar";
import { ResizableBlock } from "../Splitter";

export const ISSUES_SECTION = "issues";
const FILTERS: IssueFilter[] = ["all", "mine"];

export function issueMenu(t: TFunction, path: string, ctx: PullContext, issue: IssueSummary): MenuItem[] {
  return [
    { header: `#${issue.number}` },
    { label: t("issues.view"), onClick: () => useIssues.getState().show(path, ctx, issue.number) },
    { label: t("issues.openForge"), onClick: () => void api.openUrl(issue.url).catch(() => {}) },
    { label: t("pr.copy"), onClick: () => void navigator.clipboard?.writeText(issue.url).catch(() => {}) },
  ];
}

export function IssuesSection({ path, contexts, query, ui }: { path: string; contexts: PullContext[]; query: string; ui: RepoUi }) {
  const { t } = useTranslation();
  const setUi = useApp((s) => s.setRepoUi);
  const lists = useIssues((s) => s.lists);
  const ensure = useIssues((s) => s.ensure);
  const opened = useIssues((s) => s.open[path]);
  const [filter, setFilter] = useState<IssueFilter>("all");
  const withAccount = contexts.filter((c) => c.account);
  const keys = withAccount.map((c) => listKey(c, filter)).join("\n");
  // Relue aussi à chaque nouvel état des refs (fetch, fetch automatique), au plus toutes les
  // deux minutes (cf. store/issues).
  const refs = useGraph((s) => s.graphs[path]?.refs);
  useEffect(() => {
    for (const c of withAccount) void ensure(c, filter);
    // `keys` résume les contextes et le filtre.
  }, [keys, refs]);

  if (!withAccount.length) return null;
  const open = query !== "" || !ui.collapsed.includes(ISSUES_SECTION);
  const q = query.toLowerCase();
  const groups = withAccount.map((ctx) => {
    const entry = lists[listKey(ctx, filter)];
    const issues = (entry?.list ?? []).filter((i) => !q || i.title.toLowerCase().includes(q) || String(i.number) === q.replace(/^#/, ""));
    return { ctx, entry, issues };
  });
  const total = groups.reduce((n, g) => n + g.issues.length, 0);
  if (q && total === 0) return null;
  const loading = groups.some((g) => g.entry?.loading);
  const name = t("issues.section");
  const toggleOpen = () => setUi(path, { ...ui, collapsed: open ? [...ui.collapsed, ISSUES_SECTION] : ui.collapsed.filter((k) => k !== ISSUES_SECTION) });

  return (
    <div className="side-group issues-group">
      <div className="section-h pulls-head">
        <button
          className="section-btn pulls-toggle"
          role="treeitem"
          aria-level={1}
          aria-expanded={open}
          data-ti={`section:${ISSUES_SECTION}`}
          onClick={toggleOpen}
          onContextMenu={(e) =>
            openContextMenu(e, [
              { label: t(open ? "sidebar.collapse" : "sidebar.expand"), onClick: toggleOpen },
              { label: t("sidebar.hideSection"), onClick: () => setUi(path, { ...ui, hidden: [...ui.hidden, ISSUES_SECTION] }) },
            ])
          }
        >
          <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
          <span className="section-icon">
            <Icon name="comment" size={15} />
          </span>
          <span className="section-name">{name}</span>
          <span className="section-count">{total}</span>
        </button>
        <button
          className={loading ? "icon-btn pulls-refresh running" : "icon-btn pulls-refresh"}
          aria-label={t("issues.refresh")}
          title={t("issues.refresh")}
          disabled={loading}
          onClick={() => withAccount.forEach((c) => void ensure(c, filter, true))}
        >
          <Icon name="fetch" size={13} />
        </button>
      </div>
      {open && (
        <ResizableBlock layoutKey={sectionKey(ISSUES_SECTION)} label={t("layout.section", { name })} className="side-content">
          <div className="pull-filters" role="group" aria-label={t("issues.filter")}>
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "on" : undefined} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`issues.filters.${f}`)}
              </button>
            ))}
          </div>
          {groups.map(({ ctx, entry, issues }) => (
            <div key={pullCtxKey(ctx)} className="pull-group">
              {withAccount.length > 1 && <div className="pull-group-h">{ctx.remote}</div>}
              {entry?.error && !entry.list ? (
                <p className="side-empty" role="alert">
                  {errorMessage(t, entry.error)}
                </p>
              ) : !entry?.list ? (
                <p className="side-empty">{t("issues.loading")}</p>
              ) : issues.length === 0 ? (
                <p className="side-empty">{t(`issues.empty.${filter}`)}</p>
              ) : (
                <ul role="group">
                  {issues.map((i) => {
                    const sel = opened?.number === i.number && pullCtxKey(opened.ctx) === pullCtxKey(ctx);
                    return (
                      <li key={i.number}>
                        <button
                          className={sel ? "side-item pull-item sel" : "side-item pull-item"}
                          role="treeitem"
                          aria-level={2}
                          aria-selected={sel}
                          data-ti={`issue:${pullCtxKey(ctx)}#${i.number}`}
                          data-ti-parent={`section:${ISSUES_SECTION}`}
                          onClick={() => useIssues.getState().show(path, ctx, i.number)}
                          onContextMenu={(e) => openContextMenu(e, issueMenu(t, path, ctx, i))}
                          title={`#${i.number} ${i.title}${i.author ? `\n${i.author.name ?? i.author.login}` : ""}`}
                        >
                          {i.author && <PersonAvatar ctx={{ kind: ctx.kind, url: ctx.url, account: ctx.account }} person={i.author} size={16} />}
                          <span className="pull-num mono">#{i.number}</span>
                          <span className="side-label">{i.title}</span>
                          {i.comments > 0 && (
                            <span className="side-meta" aria-label={t("issues.comments", { count: i.comments })}>
                              {i.comments}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </ResizableBlock>
      )}
    </div>
  );
}
