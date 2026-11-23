// Zone de commit : résumé (compteur de caractères), description, amend, « pousser après »,
// bouton. Pendant un merge / rebase arrêté sur des conflits : bandeau Continuer / Annuler.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Operation } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useOps } from "../../store/ops";
import { useProfiles } from "../../store/profiles";
import { useWork } from "../../store/worktree";
import { Icon } from "../Icon";
import { ProfilePill } from "../ProfilePill";
import { DEFAULT_REPO_UI } from "./RefsSidebar";

/** Dernier message de merge proposé, par dépôt. */
const prefilledMerge = new Map<string, string>();

/** Longueur conseillée de la ligne de résumé. */
export const SUMMARY_LIMIT = 72;

/** Opération en cours : un merge se termine par un commit, les autres par « Continuer ». */
function OperationBanner({ path, op }: { path: string; op: Operation }) {
  const { t } = useTranslation();
  const running = useOps((s) => !!s.running[path]);
  const ops = useOps.getState();
  return (
    <div className="op-banner" role="status">
      <div className="op-title">
        <Icon name="alert" size={15} />
        {t(`op.${op}`)}
      </div>
      <p>{t(op === "merge" ? "op.mergeHint" : "op.continueHint")}</p>
      <div className="op-actions">
        <button className="mini" disabled={running} onClick={() => ops.abortOperation(path)}>
          {t("op.abort")}
        </button>
        {op !== "merge" && (
          <button className="mini primary" disabled={running} onClick={() => ops.continueOperation(path)}>
            {t("op.continue")}
          </button>
        )}
      </div>
    </div>
  );
}

/** `onStash` : stash partiel (fenêtre des fichiers à mettre de côté) ; absent : bouton désactivé. */
export function CommitBox({ path, onStash }: { path: string; onStash?: () => void }) {
  const { t } = useTranslation();
  const work = useWork((s) => s.repos[path]);
  const setDraft = useWork((s) => s.setDraft);
  const setAmend = useWork((s) => s.setAmend);
  const commit = useWork((s) => s.commit);
  // Pas de commit à modifier dans un dépôt vide.
  const hasHead = useGraph((s) => !!s.graphs[path]?.refs?.head);
  const detached = useGraph((s) => !!s.graphs[path]?.refs && !s.graphs[path]?.refs?.headBranch);
  const ui = useApp((s) => s.repoUi[path]) ?? DEFAULT_REPO_UI;
  const setUi = useApp((s) => s.setRepoUi);
  const opRunning = useOps((s) => !!s.running[path]);
  const push = useOps((s) => s.push);
  const operation = work?.status?.operation ?? null;
  const mergeMessage = work?.status?.mergeMessage ?? null;
  const pushAfter = !!ui.pushAfterCommit && !detached;

  // Merge en cours : message préparé par git, proposé une seule fois par dépôt (même si le
  // panneau est recréé : un message effacé exprès ne revient pas).
  useEffect(() => {
    if (operation !== "merge" || !mergeMessage || prefilledMerge.get(path) === mergeMessage) return;
    prefilledMerge.set(path, mergeMessage);
    const d = useWork.getState().repos[path]?.draft;
    if (d && !d.summary && !d.body && !d.amend) {
      const [summary, ...rest] = mergeMessage.split("\n");
      setDraft(path, { summary, body: rest.join("\n").trim() });
    }
  }, [operation, mergeMessage, path, setDraft]);

  const draft = work?.draft ?? { summary: "", body: "", amend: false };
  const staged = new Set(work?.status?.staged.map((f) => f.path) ?? []).size;
  const conflicts = work?.status?.conflicted.length ?? 0;
  const busy = !!work?.busy || opRunning;
  // Un merge se termine par un commit même si la résolution ne laisse rien d'indexé
  // (version locale gardée partout).
  const canCommit =
    !busy && draft.summary.trim() !== "" && (draft.amend || staged > 0 || operation === "merge") && conflicts === 0;
  const length = draft.summary.length;

  const submit = async () => {
    if (!canCommit) return;
    // Garde-fou : profil actif qui ne correspond pas au remote.
    if (!(await useProfiles.getState().confirmIdentity(path))) return;
    if ((await commit(path)) && pushAfter) await push(path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  let hint: string | null = null;
  if (conflicts > 0) hint = t("commit.conflicts");
  else if (!draft.amend && staged === 0 && operation !== "merge") hint = t("commit.nothingStaged");

  if (operation && operation !== "merge") {
    return (
      <div className="commit-box">
        <OperationBanner path={path} op={operation} />
      </div>
    );
  }

  return (
    <form
      className="commit-box"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {operation && <OperationBanner path={path} op={operation} />}
      <label htmlFor={`summary-${path}`} className="commit-label">
        {t("commit.message")}
        <span className={length > SUMMARY_LIMIT ? "commit-count over" : "commit-count"}>
          {length} / {SUMMARY_LIMIT}
        </span>
      </label>
      <input
        id={`summary-${path}`}
        className="commit-summary"
        value={draft.summary}
        placeholder={t("commit.summary")}
        onChange={(e) => setDraft(path, { summary: e.target.value })}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck
      />
      <textarea
        className="commit-body"
        aria-label={t("commit.description")}
        placeholder={t("commit.description")}
        value={draft.body}
        onChange={(e) => setDraft(path, { body: e.target.value })}
        onKeyDown={onKeyDown}
        spellCheck
      />
      <div className="commit-options">
        <label title={t("commit.amendHint")}>
          <input type="checkbox" checked={draft.amend} disabled={busy || !hasHead} onChange={(e) => setAmend(path, e.target.checked)} />
          {t("commit.amend")}
        </label>
        <label title={t("commit.pushAfterHint")}>
          <input
            type="checkbox"
            checked={pushAfter}
            disabled={busy || detached}
            onChange={(e) => setUi(path, { ...ui, pushAfterCommit: e.target.checked })}
          />
          {t("commit.pushAfter")}
        </label>
        {hint && <span className="commit-hint">{hint}</span>}
        <ProfilePill path={path} className="commit-profile" />
      </div>
      <div className="commit-actions">
        <button type="submit" className="btn primary commit-btn" disabled={!canCommit} title={t("commit.shortcut")}>
          {draft.amend ? t("commit.amendButton") : t("commit.button", { count: staged })}
        </button>
        <button
          type="button"
          className="btn stash-btn"
          disabled={!onStash}
          onClick={onStash}
          aria-label={t("staging.stashFiles")}
          title={t("staging.stashFilesHint")}
        >
          <Icon name="stash" size={15} />
          {t("staging.stashShort")}
        </button>
      </div>
    </form>
  );
}
