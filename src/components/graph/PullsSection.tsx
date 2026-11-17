// Section « Pull requests » / « Merge requests » de la barre latérale : les PR / MR ouvertes des
// remotes GitHub / GitLab du dépôt (toutes, les miennes, celles à relire), avec leur état.
// Clic : vue de suivi à la place du graphe ; double-clic : checkout de leur branche.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { PROVIDER_NAMES } from "../../lib/providers";
import { pullRef } from "../../lib/pulls";
import type { PullSummary, RepoUi } from "../../lib/types";
import { useApp } from "../../store/app";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { accountLogin, filterPulls, pullCtxKey, usePullList, type PullContext, type PullFilter } from "../../store/pullList";
import { openContextMenu, type MenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { PersonAvatar } from "../PersonAvatar";
import { ResizableBlock } from "../Splitter";
import { sectionKey } from "../../lib/layout";

export const PULLS_SECTION = "pulls";

/** « pr » ou « mr » pour les libellés : MR dès que tous les remotes sont GitLab. */
export const termOf = (contexts: PullContext[]) => (contexts.length && contexts.every((c) => c.kind === "gitlab") ? "mr" : "pr");

/** Petites marques d'état : brouillon, relecture, checks. */
export function PullMarks({ pull }: { pull: PullSummary }) {
  const { t } = useTranslation();
  return (
    <span className="pull-marks">
      {pull.state === "draft" && <span className="pull-draft">{t("prv.state.draft")}</span>}
      {pull.review && (
        <span className={`pull-review ${pull.review}`} title={t(`prv.review.${pull.review}`)} aria-label={t(`prv.review.${pull.review}`)}>
          <Icon name={pull.review === "approved" ? "check" : pull.review === "changes" ? "alert" : "eye"} size={12} />
        </span>
      )}
      {pull.checks && <span className={`checks-dot ${pull.checks}`} title={t(`prv.checks.${pull.checks}`)} aria-label={t(`prv.checks.${pull.checks}`)} />}
    </span>
  );
}

export function pullMenu(t: TFunction, path: string, ctx: PullContext, pull: PullSummary): MenuItem[] {
  return [
    { label: t("prv.menu.view"), onClick: () => usePullList.getState().show(path, ctx, pull.number) },
    { label: t("prv.menu.checkout", { branch: pull.fork ? `${ctx.kind === "gitlab" ? "mr" : "pr"}/${pull.number}` : pull.sourceBranch }), onClick: () => checkoutPull(path, ctx, pull) },
    "sep",
    { label: t("pr.open"), onClick: () => void api.openUrl(pull.url).catch(() => {}) },
    { label: t("pr.copy"), onClick: () => void navigator.clipboard?.writeText(pull.url).catch(() => {}) },
  ];
}

export function checkoutPull(path: string, ctx: PullContext, pull: PullSummary) {
  void useOps.getState().checkoutPull(path, ctx.remote, ctx.kind, pull.number, pull.sourceBranch, pull.fork);
}

const FILTERS: PullFilter[] = ["all", "mine", "review"];

export function PullsSection({ path, contexts, query, ui }: { path: string; contexts: PullContext[]; query: string; ui: RepoUi }) {
  const { t } = useTranslation();
  const setUi = useApp((s) => s.setRepoUi);
  const lists = usePullList((s) => s.lists);
  const ensure = usePullList((s) => s.ensure);
  const opened = usePullList((s) => s.open[path]);
  const [filter, setFilter] = useState<PullFilter>("all");
  const term = termOf(contexts);
  const open = query !== "" || !ui.collapsed.includes(PULLS_SECTION);
  const loading = contexts.some((c) => lists[pullCtxKey(c)]?.loading);

  const q = query.toLowerCase();
  const groups = contexts.map((ctx) => {
    const entry = lists[pullCtxKey(ctx)];
    const me = accountLogin(ctx.account);
    const pulls = filterPulls(entry?.list?.pulls ?? [], filter, me).filter(
      (p) => !q || p.title.toLowerCase().includes(q) || p.sourceBranch.toLowerCase().includes(q) || String(p.number) === q.replace(/^[#!]/, ""),
    );
    return { ctx, entry, pulls };
  });
  const total = groups.reduce((n, g) => n + g.pulls.length, 0);
  if (q && total === 0) return null;
  const several = contexts.length > 1;

  return (
    <div className="side-group pulls-group">
      <div className="section-h pulls-head">
        <button className="section-btn pulls-toggle" aria-expanded={open} onClick={() => setUi(path, { ...ui, collapsed: open ? [...ui.collapsed, PULLS_SECTION] : ui.collapsed.filter((k) => k !== PULLS_SECTION) })}>
          <Icon name="chevron" size={13} className={open ? "chev" : "chev closed"} />
          <span className="section-icon">
            <Icon name="pr" size={15} />
          </span>
          <span className="section-name">{t(`prv.section_${term}`)}</span>
          <span className="section-count">{total}</span>
        </button>
        <button
          className={loading ? "icon-btn pulls-refresh running" : "icon-btn pulls-refresh"}
          aria-label={t("prv.refresh")}
          title={t("prv.refresh")}
          disabled={loading}
          onClick={() => contexts.forEach((c) => void ensure(c, true))}
        >
          <Icon name="fetch" size={13} />
        </button>
      </div>
      {open && (
        <ResizableBlock layoutKey={sectionKey(PULLS_SECTION)} label={t("layout.section", { name: t(`prv.section_${term}`) })} className="side-content">
          <div className="pull-filters" role="group" aria-label={t("prv.filter")}>
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "on" : undefined} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`prv.filters.${f}`)}
              </button>
            ))}
          </div>
          {groups.map(({ ctx, entry, pulls }) => (
            <div key={pullCtxKey(ctx)} className="pull-group">
              {several && <div className="pull-group-h">{ctx.remote}</div>}
              {!ctx.account ? (
                <p className="side-empty">
                  {t("prv.noAccount", { provider: PROVIDER_NAMES[ctx.kind], remote: ctx.remote })}{" "}
                  <button className="link" onClick={() => useProfiles.getState().openPage()}>
                    {t("pr.manageAccounts")}
                  </button>
                </p>
              ) : entry?.error && !entry.list ? (
                <p className="side-empty" role="alert">
                  {errorMessage(t, entry.error)}
                </p>
              ) : !entry?.list ? (
                <p className="side-empty">{t("prv.loading")}</p>
              ) : pulls.length === 0 ? (
                <p className="side-empty">{t(`prv.empty.${filter}_${ctx.kind === "gitlab" ? "mr" : "pr"}`)}</p>
              ) : (
                <ul>
                  {pulls.map((p) => {
                    const sel = opened?.number === p.number && pullCtxKey(opened.ctx) === pullCtxKey(ctx);
                    return (
                      <li key={p.number}>
                        <button
                          className={sel ? "side-item pull-item sel" : "side-item pull-item"}
                          onClick={() => usePullList.getState().show(path, ctx, p.number)}
                          onDoubleClick={() => checkoutPull(path, ctx, p)}
                          onContextMenu={(e) => openContextMenu(e, pullMenu(t, path, ctx, p))}
                          title={`${pullRef(ctx.kind, p.number)} ${p.title}\n${p.sourceBranch} → ${p.targetBranch}${p.author ? `\n${p.author.name ?? p.author.login}` : ""}\n${t("prv.dblClick")}`}
                        >
                          {p.author && <PersonAvatar ctx={{ kind: ctx.kind, url: ctx.url, account: ctx.account }} person={p.author} size={16} />}
                          <span className="pull-num mono">{pullRef(ctx.kind, p.number)}</span>
                          <span className="side-label">{p.title}</span>
                          <PullMarks pull={p} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {entry?.list?.truncated && <p className="side-empty">{t("prv.truncated")}</p>}
            </div>
          ))}
        </ResizableBlock>
      )}
    </div>
  );
}
