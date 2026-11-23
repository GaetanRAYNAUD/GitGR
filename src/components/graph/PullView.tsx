// Vue de suivi d'une PR / MR, à la place du graphe (Échap ou « Retour » pour revenir) :
// description, relectures, fils de discussion, checks / pipelines, fichiers modifiés avec le diff
// de GitGR, et les actions (commenter, répondre, résoudre, relire, merger, fermer…).
//
// Toute action visible des autres (commentaire, relecture, merge, fermeture) part d'un clic
// explicite ; merge et fermeture demandent en plus une confirmation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import { pullRef } from "../../lib/pulls";
import type { FileChange, FileDiff, MergeMethod, PullAction, PullCheck, PullDetail, PullThread } from "../../lib/types";
import type { PersonContext } from "../../store/avatars";
import { useDialogs } from "../../store/dialogs";
import { useOps } from "../../store/ops";
import { useGraph } from "../../store/graph";
import { detailEntry, usePullList, type PullContext } from "../../store/pullList";
import { Icon, type IconName } from "../Icon";
import { PersonAvatar } from "../PersonAvatar";
import { PullEdit } from "./PullEdit";
import { DiffBody, DiffViewToggle, useEscape } from "./DiffBody";
import { DiffStats } from "./DiffStats";
import { BackButton } from "./DiffView";
import { ChangeCounts, FileList, FileViewToggle, StatusBadge } from "./FileList";
import { useApp } from "../../store/app";
import { checkoutPull } from "./PullsSection";

type Tab = "conversation" | "files" | "checks";

function useAgo() {
  const { t } = useTranslation();
  return (seconds: number | null | undefined) => {
    if (!seconds) return "";
    const r = relativeTime(seconds * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
}

export function PullView({ path, ctx, number }: { path: string; ctx: PullContext; number: number }) {
  const { t } = useTranslation();
  const entry = usePullList((s) => detailEntry(s, ctx, number));
  const close = usePullList((s) => s.close);
  const load = usePullList((s) => s.loadDetail);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const [tab, setTab] = useState<Tab>("conversation");
  const ago = useAgo();
  const d = entry?.detail ?? null;
  const term = ctx.kind === "gitlab" ? "mr" : "pr";
  const people: PersonContext = { kind: ctx.kind, url: ctx.url, account: ctx.account };
  const number_ = pullRef(ctx.kind, number);

  if (!d) {
    return (
      <section className="pull-view" aria-label={number_}>
        <header className="diff-head">
          <BackButton onClick={back} />
          <span className="mono">{number_}</span>
          <span className="pull-view-title">{entry?.error ? errorMessage(t, entry.error) : t("prv.loading")}</span>
          {entry?.error && (
            <button className="mini" onClick={() => void load(ctx, number)}>
              {t("prv.retry")}
            </button>
          )}
        </header>
      </section>
    );
  }

  const unresolved = d.threads.filter((th) => th.resolvable && !th.resolved).length;
  const passed = d.checksList.filter((c) => c.state === "success").length;
  return (
    <section className="pull-view" aria-label={`${number_} ${d.title}`}>
      <header className="diff-head pull-view-head">
        <BackButton onClick={back} />
        <span className={`pull-state ${d.state}`}>
          <Icon name={d.state === "merged" ? "merge" : "pr"} size={13} />
          {t(`prv.state.${d.state}`)}
        </span>
        <span className="mono muted">{number_}</span>
        <span className="pull-view-title" title={d.title}>
          {d.title}
        </span>
        <button className={entry?.loading ? "icon-btn running" : "icon-btn"} aria-label={t("prv.refresh")} title={t("prv.refresh")} onClick={() => void load(ctx, number)}>
          <Icon name="fetch" size={15} />
        </button>
        <button className="mini" onClick={() => checkoutPull(path, ctx, d)} title={t("prv.checkoutHint")}>
          <Icon name="branch" size={13} />
          {t("prv.checkout")}
        </button>
        <button className="icon-btn" aria-label={t("pr.copy")} title={t("pr.copy")} onClick={() => void navigator.clipboard?.writeText(d.url).catch(() => {})}>
          <Icon name="link" size={15} />
        </button>
        <button className="icon-btn" aria-label={t("pr.open")} title={t("pr.open")} onClick={() => void api.openUrl(d.url).catch(() => {})}>
          <Icon name="external" size={15} />
        </button>
      </header>
      <div className="pull-view-meta">
        {d.author && <PersonAvatar ctx={people} person={d.author} size={18} />}
        <span>{t("prv.openedBy", { name: d.author?.name ?? d.author?.login ?? "?", ago: ago(d.createdAt) })}</span>
        <span className="mono pull-route">
          {d.fork && <span className="pull-fork">{t("prv.fork")}</span>}
          {d.sourceBranch}
          <Icon name="arrow" size={12} />
          {d.targetBranch}
        </span>
        {d.labels.map((l) => (
          <span key={l.name} className="pull-label" style={l.color ? ({ "--label": `#${l.color}` } as React.CSSProperties) : undefined}>
            {l.name}
          </span>
        ))}
      </div>
      <div className="pull-tabs" role="tablist">
        {(["conversation", "files", "checks"] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : undefined} onClick={() => setTab(x)}>
            {t(`prv.tab.${x}`)}
            {x === "conversation" && unresolved > 0 && <span className="badge">{unresolved}</span>}
            {x === "checks" && d.checks && <span className={`checks-dot ${d.checks}`} />}
            {x === "checks" && d.checksList.length > 0 && (
              <span className="tab-count mono" title={t("prv.checksCount", { ok: passed, total: d.checksList.length })}>
                {passed}/{d.checksList.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="pull-view-body">
        {tab === "conversation" && <Conversation path={path} ctx={ctx} d={d} people={people} term={term} />}
        {tab === "files" && <Files path={path} ctx={ctx} d={d} />}
        {tab === "checks" && <Checks ctx={ctx} d={d} />}
      </div>
    </section>
  );
}

function Body({ text }: { text: string }) {
  return <div className="pull-text">{text}</div>;
}

function Conversation({ path, ctx, d, people, term }: { path: string; ctx: PullContext; d: PullDetail; people: PersonContext; term: "pr" | "mr" }) {
  const { t } = useTranslation();
  const ago = useAgo();
  const entry = usePullList((s) => detailEntry(s, ctx, d.number));
  const act = usePullList((s) => s.act);
  const busy = entry?.busy ?? null;
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const run = async (action: PullAction) => {
    const ok = await act(ctx, d.number, action);
    if (ok && (action.type === "comment" || action.type === "review")) setText("");
    return ok;
  };
  const open = d.state === "open" || d.state === "draft";

  return (
    <div className="pull-conv">
      {editing ? (
        <PullEdit ctx={ctx} d={d} onDone={() => setEditing(false)} />
      ) : (
        <div className="pull-card pull-desc">
          {d.canUpdate && (
            <button className="link pull-edit-btn" onClick={() => setEditing(true)}>
              {t("prv.edit")}
            </button>
          )}
          {d.body.trim() ? <Body text={d.body} /> : <p className="muted">{t("prv.noBody")}</p>}
          {d.assignees.length > 0 && (
            <p className="pull-assignees muted">
              {t("pr.assignees")} :
              {d.assignees.map((a) => (
                <span key={a.login} className="pull-person">
                  <PersonAvatar ctx={people} person={a} size={16} />
                  {a.name ?? a.login}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {d.reviews.length > 0 && (
        <div className="pull-card">
          <div className="eyebrow">{t("prv.reviews")}</div>
          <ul className="pull-reviews">
            {d.reviews.map((r) => (
              <li key={r.author.login}>
                <PersonAvatar ctx={people} person={r.author} size={18} />
                <span>{r.author.name ?? r.author.login}</span>
                <span className={`review-state ${r.state}`}>{t(`prv.reviewState.${r.state}`)}</span>
                {r.at && <span className="muted">{ago(r.at)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.threads.map((th) => (
        <ThreadCard key={th.id} ctx={ctx} d={d} th={th} people={people} />
      ))}

      {entry?.actionError && (
        <p className="input-error" role="alert">
          {errorMessage(t, entry.actionError)}
        </p>
      )}

      {open && (
        <div className="pull-card pull-compose">
          <textarea className="pf-input" rows={4} value={text} placeholder={t("prv.commentPlaceholder")} onChange={(e) => setText(e.target.value)} disabled={!!busy} aria-label={t("prv.comment")} />
          <div className="pull-compose-actions">
            <button className="btn" disabled={!!busy || !text.trim()} onClick={() => void run({ type: "comment", body: text })}>
              {busy === "comment" ? t("prv.sending") : t("prv.comment")}
            </button>
            <span className="status-spacer" />
            {ctx.kind === "github" && (
              <button className="btn" disabled={!!busy || !text.trim()} title={t("prv.changesHint")} onClick={() => void run({ type: "review", event: "changes", body: text })}>
                {t("prv.requestChanges")}
              </button>
            )}
            <button className="btn primary" disabled={!!busy} onClick={() => void run({ type: "review", event: "approve", body: text })}>
              {busy === "review" ? t("prv.sending") : t("prv.approve")}
            </button>
            {ctx.kind === "gitlab" && d.reviews.some((r) => r.state === "approved" && r.author.login.toLowerCase() === ctx.account?.split("|").pop()?.toLowerCase()) && (
              <button className="btn" disabled={!!busy} onClick={() => void run({ type: "unapprove" })}>
                {t("prv.unapprove")}
              </button>
            )}
          </div>
        </div>
      )}

      <MergeBox path={path} ctx={ctx} d={d} term={term} />
    </div>
  );
}

function ThreadCard({ ctx, d, th, people }: { ctx: PullContext; d: PullDetail; th: PullThread; people: PersonContext }) {
  const { t } = useTranslation();
  const ago = useAgo();
  const act = usePullList((s) => s.act);
  const busy = usePullList((s) => detailEntry(s, ctx, d.number)?.busy ?? null);
  const [reply, setReply] = useState<string | null>(null);
  const [folded, setFolded] = useState(th.resolved);
  return (
    <div className={th.resolved ? "pull-card pull-thread resolved" : "pull-card pull-thread"}>
      {th.path && (
        <button className="pull-thread-path mono" onClick={() => setFolded((f) => !f)} aria-expanded={!folded}>
          <Icon name="file" size={13} />
          {th.path}
          {th.line != null && `:${th.line}`}
          {th.resolved && <span className="pull-resolved">{t("prv.resolved")}</span>}
        </button>
      )}
      {!folded &&
        th.comments.map((c) => (
          <div key={c.id} className="pull-comment">
            <div className="pull-comment-head">
              {c.author && <PersonAvatar ctx={people} person={c.author} size={18} />}
              <strong>{c.author?.name ?? c.author?.login ?? "?"}</strong>
              <span className="muted">{ago(c.at)}</span>
            </div>
            <Body text={c.body} />
          </div>
        ))}
      {!folded && (th.replyable || th.resolvable) && (
        <div className="pull-thread-actions">
          {reply === null ? (
            th.replyable && (
              <button className="link" onClick={() => setReply("")}>
                {t("prv.reply")}
              </button>
            )
          ) : (
            <div className="pull-reply">
              <textarea className="pf-input" rows={3} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} aria-label={t("prv.reply")} disabled={!!busy} />
              <div className="pull-compose-actions">
                <button className="btn" onClick={() => setReply(null)} disabled={!!busy}>
                  {t("confirm.cancel")}
                </button>
                <button
                  className="btn primary"
                  disabled={!!busy || !reply.trim()}
                  onClick={async () => {
                    if (await act(ctx, d.number, { type: "reply", thread: th.id, body: reply })) setReply(null);
                  }}
                >
                  {t("prv.reply")}
                </button>
              </div>
            </div>
          )}
          {th.resolvable && (
            <button className="link" disabled={!!busy} onClick={() => void act(ctx, d.number, { type: "resolve", thread: th.id, resolved: !th.resolved })}>
              {th.resolved ? t("prv.unresolve") : t("prv.resolve")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MergeBox({ path, ctx, d, term }: { path: string; ctx: PullContext; d: PullDetail; term: "pr" | "mr" }) {
  const { t } = useTranslation();
  const act = usePullList((s) => s.act);
  const busy = usePullList((s) => detailEntry(s, ctx, d.number)?.busy ?? null);
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [deleteBranch, setDeleteBranch] = useState<boolean | null>(null);
  const m = d.merge;
  const chosen = method && m.methods.includes(method) ? method : (m.methods[0] ?? "merge");
  const del = deleteBranch ?? m.deleteBranch;
  const open = d.state === "open" || d.state === "draft";
  // Merge automatique : il ne reste que des checks en cours (ou une relecture attendue chez GitHub).
  const waitable = m.blockers.length > 0 && m.blockers.every((b) => b === "checks_pending" || (ctx.kind === "github" && (b === "approvals" || b === "checks")));

  const confirm = async (title: string, body: string, label: string, danger = false) =>
    (await useDialogs.getState().choose({ title, body, choices: [{ id: "ok", label, danger }] })) === "ok";

  const merge = async (auto: boolean) => {
    const label = auto ? t("prv.autoMerge") : t(`prv.method.${chosen}`);
    const ok = await confirm(
      t(`prv.mergeConfirm_${term}`, { ref: pullRef(ctx.kind, d.number) }),
      t(auto ? "prv.autoMergeBody" : "prv.mergeBody", { source: d.sourceBranch, target: d.targetBranch, method: t(`prv.method.${chosen}`) }),
      label,
    );
    if (!ok) return;
    if (!(await act(ctx, d.number, { type: "merge", method: chosen, deleteBranch: del && !d.fork, auto })) || auto) return;
    // Fusionnée : récupérer la cible, et proposer d'y revenir si on était sur la branche de la PR.
    const ops = useOps.getState();
    await ops.fetch(path, true);
    const refs = useGraph.getState().graphs[path]?.refs;
    const local = refs?.refs.find((r) => r.kind === "local" && r.short === refs.headBranch);
    if (!d.fork && local?.upstream === `${ctx.remote}/${d.sourceBranch}`) {
      const back = await confirm(t("prv.backTitle", { target: d.targetBranch }), t("prv.backBody", { source: d.sourceBranch, target: d.targetBranch }), t("prv.backOk"));
      // La locale de la cible, si elle existe déjà, est mise à jour par le checkout lui-même.
      if (back) await ops.checkoutRemote(path, `${ctx.remote}/${d.targetBranch}`);
    }
  };

  const setOpen = async (value: boolean) => {
    if (!value && !(await confirm(t(`prv.closeConfirm_${term}`, { ref: pullRef(ctx.kind, d.number) }), t("prv.closeBody"), t(`prv.close_${term}`), true))) return;
    await act(ctx, d.number, { type: "setOpen", open: value });
  };

  return (
    <div className="pull-card pull-merge">
      {open && (
        <>
          <div className="pull-merge-status">
            <Icon name={m.canMerge ? "check" : "alert"} size={16} className={m.canMerge ? "ok" : "warn"} />
            <div>
              {m.canMerge ? (
                <strong>{t("prv.ready")}</strong>
              ) : (
                <ul className="pull-blockers">
                  {m.blockers.map((b) => (
                    <li key={b}>{t(`prv.blocker.${b}`)}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="pull-merge-actions">
            {m.methods.length > 1 && (
              <select className="pf-input" value={chosen} onChange={(e) => setMethod(e.target.value as MergeMethod)} aria-label={t("prv.methodLabel")} disabled={!!busy}>
                {m.methods.map((x) => (
                  <option key={x} value={x}>
                    {t(`prv.method.${x}`)}
                  </option>
                ))}
              </select>
            )}
            {!d.fork && (
              <label className="menu-check">
                <input type="checkbox" checked={del} onChange={(e) => setDeleteBranch(e.target.checked)} disabled={!!busy} />
                {t("prv.deleteBranch", { branch: d.sourceBranch })}
              </label>
            )}
            <span className="status-spacer" />
            {m.blockers.includes("behind") && (
              <button className="btn" disabled={!!busy || !d.canUpdate} onClick={() => void act(ctx, d.number, { type: "updateBranch" })}>
                {ctx.kind === "gitlab" ? t("prv.rebase") : t("prv.updateBranch")}
              </button>
            )}
            {m.autoMerge === true ? (
              <span className="muted">{t("prv.autoMergeOn")}</span>
            ) : (
              m.autoMerge === false &&
              waitable && (
                <button className="btn" disabled={!!busy} onClick={() => void merge(true)}>
                  {t("prv.autoMerge")}
                </button>
              )
            )}
            <button className="btn primary" disabled={!!busy || !m.canMerge} title={m.canMerge ? undefined : m.blockers.map((b) => t(`prv.blocker.${b}`)).join("\n")} onClick={() => void merge(false)}>
              <Icon name="merge" size={14} />
              {busy === "merge" ? t("prv.merging") : t(`prv.method.${chosen}`)}
            </button>
          </div>
        </>
      )}
      {d.state === "merged" && (
        <p className="pull-merged">
          <Icon name="merge" size={15} /> {t(`prv.merged_${term}`)}
        </p>
      )}
      {d.canUpdate && (
        <div className="pull-merge-actions secondary">
          {open && (
            <button className="link" disabled={!!busy} onClick={() => void act(ctx, d.number, { type: "setDraft", draft: d.state !== "draft" })}>
              {d.state === "draft" ? t("prv.markReady") : t("prv.markDraft")}
            </button>
          )}
          {d.state !== "merged" && (
            <button className="link" disabled={!!busy} onClick={() => void setOpen(!open)}>
              {open ? t(`prv.close_${term}`) : t(`prv.reopen_${term}`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Files({ path, ctx, d }: { path: string; ctx: PullContext; d: PullDetail }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState<{ data: FileDiff | null; error: string | null } | null>(null);
  const fileView = useApp((s) => s.settings.fileView ?? "list");
  const target = `${ctx.remote}/${d.targetBranch}`;
  const head = d.headSha;

  useEffect(() => {
    let live = true;
    setFiles(null);
    setError(null);
    if (!head) {
      setError("pull_head_missing");
      return;
    }
    (async () => {
      try {
        await api.ensurePullHead(path, ctx.remote, ctx.kind, d.number, head);
        const list = await api.pullFiles(path, target, head);
        if (live) setFiles(list);
      } catch (e) {
        if (live) setError(errorCode(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [path, ctx.remote, ctx.kind, d.number, head, target]);

  useEffect(() => {
    if (!file || !head) return;
    let live = true;
    setDiff(null);
    api.pullFileDiff(path, target, head, file.path, file.oldPath).then(
      (data) => live && setDiff({ data, error: null }),
      (e) => live && setDiff({ data: null, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, target, head, file]);

  /** Fils sur le code, par fichier. */
  const comments = useMemo(() => {
    const m = new Map<string, number>();
    for (const th of d.threads) if (th.path) m.set(th.path, (m.get(th.path) ?? 0) + 1);
    return m;
  }, [d.threads]);

  if (error) return <p className="notice error">{errorMessage(t, error)}</p>;
  if (!files) return <p className="muted pull-pad">{t("prv.loading")}</p>;
  return (
    <div className="pull-files">
      <div className="pull-file-list">
        <div className="section-h">
          <span>{t("details.files", { count: files.length })}</span>
          <ChangeCounts files={files} />
          {files.length > 0 && <FileViewToggle />}
        </div>
        {files.length === 0 ? (
          <p className="details-note muted">{t("prv.noFiles")}</p>
        ) : (
          <FileList
            files={files}
            view={fileView}
            label={t("details.files", { count: files.length })}
            isActive={(f) => file?.path === f.path}
            onOpen={setFile}
            // Fils de discussion sur le fichier : toujours visibles (cf. .pull-file-list .file-actions).
            actions={(f) =>
              comments.get(f.path) ? (
                <span className="side-meta" title={t("prv.threadsOnFile", { count: comments.get(f.path) })}>
                  <Icon name="comment" size={12} /> {comments.get(f.path)}
                </span>
              ) : null
            }
          />
        )}
      </div>
      <div className="pull-file-diff">
        {file ? (
          <>
            <header className="diff-head">
              <StatusBadge status={file.status} />
              <span className="diff-path mono">{file.path}</span>
              {diff?.data && <DiffStats diff={diff.data} />}
              <DiffViewToggle />
            </header>
            <div className="diff-body">
              <DiffBody data={diff?.data ?? undefined} error={diff?.error ?? undefined} />
            </div>
          </>
        ) : (
          <p className="muted pull-pad">{t("prv.pickFile")}</p>
        )}
      </div>
    </div>
  );
}

/** Ordre des groupes : ce qui demande de l'attention d'abord ; les réussis et les ignorés /
 *  annulés repliés d'office. */
const CHECK_GROUPS: PullCheck["state"][] = ["failure", "pending", "neutral", "success"];
const CHECK_ICON: Record<PullCheck["state"], IconName> = { failure: "close", pending: "fetch", neutral: "minimize", success: "check" };

function Checks({ ctx, d }: { ctx: PullContext; d: PullDetail }) {
  const { t } = useTranslation();
  const act = usePullList((s) => s.act);
  const busy = usePullList((s) => detailEntry(s, ctx, d.number)?.busy ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["failure", "pending"]));
  if (d.checksList.length === 0) return <p className="muted pull-pad">{t("prv.noChecks")}</p>;
  const total = d.checksList.length;
  const count = (s: PullCheck["state"]) => d.checksList.filter((c) => c.state === s).length;
  const others = CHECK_GROUPS.filter((s) => s !== "success" && count(s) > 0).map((s) => t(`prv.checkGroup.${s}`, { count: count(s) }));
  return (
    <div className="pull-checks">
      <div className="checks-summary">
        <span className="checks-total">{t("prv.checksPassed", { ok: count("success"), total })}</span>
        {others.length > 0 && <span className="muted">{others.join(" · ")}</span>}
        {d.canUpdate && d.retry.length > 0 && count("failure") > 0 && (
          <button className="mini checks-retry" disabled={!!busy} onClick={() => void act(ctx, d.number, { type: "retryFailed", runs: d.retry })}>
            <Icon name="fetch" size={13} />
            {busy === "retryFailed" ? t("prv.retrying") : t("prv.retryFailed")}
          </button>
        )}
      </div>
      <div className="checks-bar" role="img" aria-label={t("prv.checksCount", { ok: count("success"), total })}>
        {(["success", "pending", "neutral", "failure"] as const).map((s) => count(s) > 0 && <span key={s} className={`checks-seg ${s}`} style={{ flex: count(s) }} />)}
      </div>
      {CHECK_GROUPS.filter((s) => count(s) > 0).map((s) => {
        const shown = open.has(s);
        return (
          <section key={s} className="checks-group">
            <button
              className="checks-group-h"
              aria-expanded={shown}
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(s)) next.add(s);
                  return next;
                })
              }
            >
              <Icon name="chevron" size={12} className={shown ? "chev" : "chev closed"} />
              {t(`prv.checkGroupTitle.${s}`, { count: count(s) })}
            </button>
            {shown && (
              <ul>
                {d.checksList
                  .filter((c) => c.state === s)
                  .map((c, i) => (
                    <li key={`${c.name}-${i}`} className="checks-row">
                      <span className={`check-icon ${c.state}`}>
                        {c.state === "pending" ? <span className="check-spinner" role="img" aria-label={t("prv.checks.pending")} /> : <Icon name={CHECK_ICON[c.state]} size={14} />}
                      </span>
                      <span className="pull-check-name">{c.name}</span>
                      {c.url && (
                        <button className="mini" onClick={() => void api.openUrl(c.url!).catch(() => {})}>
                          {t("prv.logs")}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
