// Modifier une PR / MR après sa création : titre, description, relecteurs, assignés, étiquettes
// (listes du dépôt en cache, cf. store/pullOptions). Enregistré d'un bloc.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Label, Person, PullDetail } from "../../lib/types";
import { optionsKey, usePullOptions } from "../../store/pullOptions";
import { detailEntry, usePullList, type PullContext } from "../../store/pullList";
import { MultiPicker, type PickOption } from "../MultiPicker";
import { PersonAvatar } from "../PersonAvatar";

const key = (x: Person) => x.login.toLowerCase();

export function PullEdit({ ctx, d, onDone }: { ctx: PullContext; d: PullDetail; onDone: () => void }) {
  const { t } = useTranslation();
  const act = usePullList((s) => s.act);
  const busy = usePullList((s) => detailEntry(s, ctx, d.number)?.busy ?? null);
  const options = usePullOptions((s) => s.entries[optionsKey(ctx)]?.options ?? null);
  const ensure = usePullOptions((s) => s.ensure);
  useEffect(() => {
    void ensure({ kind: ctx.kind, url: ctx.url, repo: ctx.repo, account: ctx.account });
  }, [ensure, ctx.kind, ctx.url, ctx.repo, ctx.account]);

  const [title, setTitle] = useState(d.title);
  const [body, setBody] = useState(d.body);
  const [reviewers, setReviewers] = useState(() => d.reviewers.map(key));
  const [assignees, setAssignees] = useState(() => d.assignees.map(key));
  const [labels, setLabels] = useState(() => d.labels.map((l) => l.name));

  /** Personnes connues : la liste du dépôt, plus celles déjà sur la PR / MR. */
  const people = useMemo(() => {
    const m = new Map<string, Person>();
    for (const x of [...d.reviewers, ...d.assignees, ...(options?.people ?? [])]) if (!m.has(key(x))) m.set(key(x), x);
    return m;
  }, [d.reviewers, d.assignees, options]);
  const avatarCtx = { kind: ctx.kind, url: ctx.url, account: ctx.account };
  const personOptions = useMemo(
    (): PickOption[] =>
      [...people.values()].map((x) => ({ id: key(x), label: x.login, detail: x.name && x.name !== x.login ? x.name : null, icon: <PersonAvatar ctx={avatarCtx} person={x} size={18} /> })),
    // `avatarCtx` est rendu par ses champs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, ctx.kind, ctx.url, ctx.account],
  );
  const labelOptions = useMemo((): PickOption[] => {
    const m = new Map<string, Label>();
    for (const l of [...d.labels, ...(options?.labels ?? [])]) if (!m.has(l.name)) m.set(l.name, l);
    return [...m.values()].map((l) => ({ id: l.name, label: l.name, detail: l.description, color: l.color }));
  }, [d.labels, options]);
  const persons = (ids: string[]) => ids.map((id) => people.get(id)).filter((x): x is Person => !!x);

  const save = async () => {
    const ok = await act(ctx, d.number, { type: "edit", title, body, reviewers: persons(reviewers), assignees: persons(assignees), labels });
    if (ok) onDone();
  };

  return (
    <form
      className="pull-card pull-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="input-field">
        <span>{t("pr.titleField")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!busy} autoFocus autoComplete="off" />
      </label>
      <label className="input-field">
        <span>{t("pr.body")}</span>
        <textarea className="pf-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} disabled={!!busy} />
      </label>
      <MultiPicker label={t("pr.reviewers")} options={personOptions} selected={reviewers} onChange={setReviewers} disabled={!!busy} placeholder={t("pr.searchPeople")} />
      <MultiPicker label={t("pr.assignees")} options={personOptions} selected={assignees} onChange={setAssignees} disabled={!!busy} placeholder={t("pr.searchPeople")} />
      <MultiPicker label={t("pr.labels")} options={labelOptions} selected={labels} onChange={setLabels} disabled={!!busy} placeholder={t("pr.searchLabels")} />
      <div className="pull-compose-actions">
        <span className="status-spacer" />
        <button type="button" className="btn" onClick={onDone} disabled={!!busy}>
          {t("confirm.cancel")}
        </button>
        <button type="submit" className="btn primary" disabled={!!busy || !title.trim()}>
          {busy === "edit" ? t("prv.saving") : t("prv.save")}
        </button>
      </div>
    </form>
  );
}
