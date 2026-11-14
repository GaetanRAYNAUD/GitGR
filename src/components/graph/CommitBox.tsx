// Zone de commit : résumé (compteur de caractères), description, amend, bouton.

import { useTranslation } from "react-i18next";
import { useGraph } from "../../store/graph";
import { useWork } from "../../store/worktree";

/** Longueur conseillée de la ligne de résumé. */
export const SUMMARY_LIMIT = 72;

export function CommitBox({ path }: { path: string }) {
  const { t } = useTranslation();
  const work = useWork((s) => s.repos[path]);
  const setDraft = useWork((s) => s.setDraft);
  const setAmend = useWork((s) => s.setAmend);
  const commit = useWork((s) => s.commit);
  // Pas de commit à modifier dans un dépôt vide.
  const hasHead = useGraph((s) => !!s.graphs[path]?.refs?.head);

  const draft = work?.draft ?? { summary: "", body: "", amend: false };
  const staged = new Set(work?.status?.staged.map((f) => f.path) ?? []).size;
  const conflicts = work?.status?.conflicted.length ?? 0;
  const busy = !!work?.busy;
  const canCommit = !busy && draft.summary.trim() !== "" && (draft.amend || staged > 0) && conflicts === 0;
  const length = draft.summary.length;

  const submit = () => {
    if (canCommit) commit(path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  let hint: string | null = null;
  if (conflicts > 0) hint = t("commit.conflicts");
  else if (!draft.amend && staged === 0) hint = t("commit.nothingStaged");

  return (
    <form
      className="commit-box"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
        {hint && <span className="commit-hint">{hint}</span>}
      </div>
      <button type="submit" className="btn primary commit-btn" disabled={!canCommit} title={t("commit.shortcut")}>
        {draft.amend ? t("commit.amendButton") : t("commit.button", { count: staged })}
      </button>
    </form>
  );
}
