// Fenêtre « Créer une pull request » (GitHub) / « Créer une merge request » (GitLab) : de la
// branche courante vers une branche d'un remote. La branche est poussée d'abord si besoin ; le
// titre et la description sont pré-remplis d'après ses commits et le modèle du dépôt ; relecteurs,
// assignés et étiquettes sont choisis dans les listes du dépôt (en cache, cf. store/pullOptions).
//
// Ce qui empêche la création s'affiche en tête, sous la route. Une saisie en cours n'est pas
// perdue par mégarde : un clic à côté ne ferme plus, Échap demande d'abord confirmation.
// Ctrl+Entrée crée, Tab reste dans la fenêtre.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDialogs } from "../store/dialogs";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { trapTab } from "../lib/focusTrap";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { linkedAccounts, PROVIDER_NAMES } from "../lib/providers";
import { draftText, pullRef, pullSource, type PullTarget } from "../lib/pulls";
import { relativeTime } from "../lib/format";
import type { Person, Pull, ProviderKind, RefsInfo } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useGraph } from "../store/graph";
import { useOps } from "../store/ops";
import { useProfiles } from "../store/profiles";
import { usePullDialog } from "../store/pulls";
import { usePullList } from "../store/pullList";
import { useApp } from "../store/app";
import { optionsKey, ownerKey, usePullOptions, type OptionsContext } from "../store/pullOptions";
import { ComboField } from "./ComboField";
import { Icon } from "./Icon";
import { Picker } from "./Picker";
import { isTeam } from "../lib/pulls";
import { MultiPicker, type PickOption } from "./MultiPicker";
import { PersonAvatar } from "./PersonAvatar";
import { remoteMarkOf } from "./RemoteMark";

/** Hôte d'une URL d'instance (`https://gitlab.exemple.fr` → `gitlab.exemple.fr`). */
const urlHost = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};

/** « pr » (GitHub) ou « mr » (GitLab) : suffixe des libellés. */
export const pullTerm = (kind: ProviderKind | null) => (kind === "gitlab" ? "mr" : "pr");

export function PullDialogHost() {
  const open = usePullDialog((s) => s.open);
  return open ? <PullDialog key={open.id} path={open.path} initial={open.target} /> : null;
}

/** Branches d'un remote, d'après les refs (pour la liste de la branche cible). */
function remoteBranches(refs: RefsInfo | null, remote: string): string[] {
  const prefix = `${remote}/`;
  return (refs?.refs ?? [])
    .filter((r) => r.kind === "remote" && r.short.startsWith(prefix) && r.short !== `${prefix}HEAD`)
    .map((r) => r.short.slice(prefix.length));
}

function PullDialog({ path, initial }: { path: string; initial?: PullTarget }) {
  const { t } = useTranslation();
  const close = usePullDialog((s) => s.close);
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  const ref = useRef<HTMLFormElement>(null);

  const head = refs?.headBranch ?? null;
  const source = useMemo(() => (refs && head ? pullSource(refs, head) : null), [refs, head]);
  const remotes = refs?.remotes ?? [];

  const [targetRemote, setTargetRemote] = useState(initial?.remote ?? source?.remote ?? remotes[0]?.name ?? "");
  const [targetBranch, setTargetBranch] = useState(initial?.branch ?? "");
  const [branchTouched, setBranchTouched] = useState(!!initial?.branch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [textTouched, setTextTouched] = useState(false);
  // Modèles nommés du dépôt : on peut en prendre un à la place de la description proposée.
  const [templates, setTemplates] = useState<{ name: string; body: string }[]>([]);
  const [templateName, setTemplateName] = useState<string | null>(null);
  /** La description a été écrite à la main (pas seulement proposée ou tirée d'un modèle). */
  const bodyEdited = useRef(false);
  const useTemplate = async (tpl: { name: string; body: string }) => {
    if (bodyEdited.current && body.trim()) {
      const ok = await useDialogs.getState().choose({
        title: t("pr.templateReplaceTitle"),
        body: t("pr.templateReplaceBody", { name: tpl.name }),
        choices: [{ id: "replace", label: t("pr.templateReplace"), danger: true }],
      });
      if (ok !== "replace") return;
    }
    setBody(tpl.body);
    setTemplateName(tpl.name);
    setTextTouched(true);
    bodyEdited.current = false;
  };
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState<"push" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);

  /** Saisie en cours (texte modifié, personnes ou étiquettes choisies) : rien ne la jette sans
   *  confirmation. */
  const dirty = textTouched || assignees.length > 0 || reviewers.length > 0 || labels.length > 0;
  /** Confirmation « Abandonner ? » affichée à la place des boutons. */
  const [leaving, setLeaving] = useState(false);
  const cancel = useCallback(() => {
    if (busy) return;
    if (!dirty) return close();
    // Échap une seconde fois : retour à la saisie.
    setLeaving((v) => !v);
  }, [busy, close, dirty]);
  const outside = useCallback(() => {
    if (!busy && !dirty) close();
  }, [busy, close, dirty]);
  useDismiss(ref, true, cancel, outside);
  useRestoreFocus();
  const leaveRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // La confirmation prend le focus ; refermée, elle le rend au bouton « Retour ».
  const wasLeaving = useRef(false);
  useEffect(() => {
    if (leaving) leaveRef.current?.focus();
    else if (wasLeaving.current) backRef.current?.focus();
    wasLeaving.current = leaving;
  }, [leaving]);

  /** Provider, instance, dépôt et compte d'un remote. */
  const side = useCallback(
    (name: string | null) => {
      const remote = remotes.find((r) => r.name === name);
      return remote ? remoteMarkOf(profiles, binding, remote) : null;
    },
    [remotes, profiles, binding],
  );
  const tgt = side(targetRemote);
  /** Pas de compte pour le remote cible, mais un autre profil en a un sur cette forge : de quoi
   *  l'associer au remote d'un clic (au lieu d'aller dans les profils). */
  const otherAccounts = useMemo(
    () =>
      tgt && !tgt.account
        ? linkedAccounts(profiles).filter((l) => l.account.kind === tgt.provider && urlHost(l.account.url) === tgt.host.toLowerCase())
        : [],
    [profiles, tgt],
  );
  /** Compte (et son profil) qui crée la PR / MR sur la forge. */
  const creator = useMemo(() => (tgt?.account ? (linkedAccounts(profiles).find((l) => l.account.id === tgt.account) ?? null) : null), [profiles, tgt?.account]);
  const src = side(source?.remote ?? null);
  const kind = tgt?.provider ?? null;
  const term = pullTerm(kind);
  const branches = useMemo(() => remoteBranches(refs, targetRemote), [refs, targetRemote]);

  // Branche cible proposée : la branche par défaut du dépôt distant (API), sinon main / master.
  const tgtKey = tgt ? `${tgt.provider}|${tgt.url}|${tgt.repo}|${tgt.account ?? ""}` : "";
  useEffect(() => {
    if (branchTouched || !tgt) return;
    let live = true;
    const fallback = () => branches.find((b) => b === "main") ?? branches.find((b) => b === "master") ?? branches[0] ?? "";
    if (!tgt.account) {
      setTargetBranch(fallback());
      return;
    }
    api.remoteDefaultBranch(tgt.provider, tgt.url ?? "", tgt.repo, tgt.account).then(
      (b) => live && setTargetBranch(b),
      () => live && setTargetBranch(fallback()),
    );
    return () => {
      live = false;
    };
    // `tgt` et `branches` sont rendus par leurs clés : un rafraîchissement des refs (fetch
    // automatique) ne redemande rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgtKey, branchTouched, branches.join("\n")]);

  // Titre et description d'après les commits de la branche absents de la cible (tant qu'ils
  // n'ont pas été modifiés à la main).
  const sourceBranch = source?.branch ?? null;
  useEffect(() => {
    if (textTouched || !sourceBranch || !targetBranch) return;
    let live = true;
    api.pullDraft(path, sourceBranch, `${targetRemote}/${targetBranch}`, kind).then(
      (d) => {
        if (!live) return;
        const text = draftText(d.commits, sourceBranch, d.template);
        setTitle(text.title);
        setBody(text.body);
        setTemplates(d.templates ?? []);
        setTemplateName(null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [path, sourceBranch, targetRemote, targetBranch, kind, textTouched]);

  // Personnes et étiquettes du dépôt cible : le cache tout de suite, relu en arrière-plan.
  const ctx: OptionsContext | null = tgt?.url ? { kind: tgt.provider, url: tgt.url, repo: tgt.repo, account: tgt.account } : null;
  const ctxKey = ctx ? `${optionsKey(ctx)}|${ctx.account ?? ""}` : "";
  const ensure = usePullOptions((s) => s.ensure);
  useEffect(() => {
    if (ctx) void ensure(ctx);
    // `ctx` est rendu par sa clé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, ensure]);
  const entry = usePullOptions((s) => (ctx ? s.entries[optionsKey(ctx)] : undefined));
  const last = usePullOptions((s) => (ctx ? s.last[ownerKey(ctx)] : undefined));
  const options = entry?.options ?? null;
  const avatarCtx = tgt?.url ? { kind: tgt.provider, url: tgt.url, account: tgt.account } : null;
  /** Login du compte (`<kind>|<url>|<login>`) : pas relecteur de sa propre PR chez GitHub. */
  const me = tgt?.account?.split("|").pop() ?? null;
  /** Personnes connues : celles de la liste, plus celles déjà choisies (liste changée entre-temps). */
  const [chosen, setChosen] = useState<Record<string, Person>>({});
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const x of options?.people ?? []) map.set(x.login.toLowerCase(), x);
    for (const x of Object.values(chosen)) if (!map.has(x.login.toLowerCase())) map.set(x.login.toLowerCase(), x);
    return map;
  }, [options, chosen]);
  const personOptions = useMemo(
    (): PickOption[] =>
      [...people.values()].map((x) => ({
        id: x.login.toLowerCase(),
        label: x.login,
        detail: isTeam(x.login) ? [t("pr.team"), x.name].filter(Boolean).join(" · ") : x.name && x.name !== x.login ? x.name : null,
        icon: isTeam(x.login) ? <Icon name="user" size={16} /> : <PersonAvatar ctx={avatarCtx} person={x} size={18} />,
      })),
    // `avatarCtx` est rendu par `ctxKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, ctxKey],
  );
  // Une équipe relit, mais ne s'assigne pas.
  const assigneeOptions = useMemo(() => personOptions.filter((o) => !isTeam(o.id)), [personOptions]);
  const reviewerOptions = useMemo(() => (kind === "github" && me ? personOptions.filter((o) => o.id !== me.toLowerCase()) : personOptions), [personOptions, kind, me]);
  const labelOptions = useMemo(
    (): PickOption[] => (options?.labels ?? []).map((l) => ({ id: l.name, label: l.name, detail: l.description, color: l.color })),
    [options],
  );
  const pick = (setter: (ids: string[]) => void) => (ids: string[]) => {
    setChosen((c) => {
      const next = { ...c };
      for (const id of ids) {
        const x = people.get(id);
        if (x) next[id] = x;
      }
      return next;
    });
    setter(ids);
  };
  const persons = (ids: string[]) => ids.map((id) => people.get(id)).filter((x): x is Person => !!x);
  const reuseLast = () => {
    if (!last) return;
    const all = [...last.assignees, ...last.reviewers];
    setChosen((c) => Object.fromEntries([...Object.entries(c), ...all.map((x) => [x.login.toLowerCase(), x] as const)]));
    setAssignees(last.assignees.map((x) => x.login.toLowerCase()));
    // Une équipe n'a accès qu'à certains dépôts : reprise seulement si elle est proposée ici.
    const teamsHere = new Set((options?.people ?? []).filter((x) => isTeam(x.login)).map((x) => x.login.toLowerCase()));
    setReviewers(
      last.reviewers
        .map((x) => x.login.toLowerCase())
        .filter((id) => !(kind === "github" && id === me?.toLowerCase()) && (!isTeam(id) || teamsHere.has(id))),
    );
    setLabels(last.labels);
  };
  const age = options && !options.fromOwner ? relativeTime(options.fetchedAt * 1000) : null;
  // Autre dépôt cible : les choix faits pour le précédent n'y ont pas cours.
  const repoKey = ctx ? optionsKey(ctx) : "";
  const shownRepo = useRef(repoKey);
  useEffect(() => {
    if (shownRepo.current === repoKey) return;
    shownRepo.current = repoKey;
    setChosen({});
    setAssignees([]);
    setReviewers([]);
    setLabels([]);
  }, [repoKey]);

  // Ce qui empêche la création, dans l'ordre où il faut le régler.
  const blocker = !head
    ? t("pr.detached")
    : !source?.remote
      ? t("pr.noRemote")
      : !tgt
        ? t("pr.unknownProvider", { remote: targetRemote })
        : !tgt.account
          ? t("pr.noAccount", { provider: PROVIDER_NAMES[tgt.provider], remote: targetRemote })
          : !src || src.provider !== tgt.provider || src.host !== tgt.host
            ? t("pr.otherInstance", { source: source.remote, target: targetRemote })
            : targetRemote === source.remote && targetBranch === source.remoteBranch
              ? t("pr.sameBranch")
              : null;
  const ready = !blocker && !!targetBranch.trim() && !!title.trim() && !busy;
  // Ce qui manque encore (hors `blocker`, dit en tête), à côté du bouton grisé.
  const why = busy || blocker ? null : !targetBranch.trim() ? t("pr.whyTarget") : !title.trim() ? t("pr.whyTitle") : null;

  /** Fenêtre fermée ; la PR / MR annoncée dans un message, avec de quoi l'ouvrir (dans GitGR ou
   *  dans le navigateur) et copier son lien. */
  const announce = (pull: Pull) => {
    close();
    const number = pullRef(kind, pull.number);
    const head = pull.existing ? t(`pr.exists_${term}`, { ref: number }) : t(`pr.created_${term}`, { ref: number });
    const text = [`${head} — ${pull.title}`, ...pull.warnings.map((w) => errorMessage(t, w))].join(" ");
    const pctx = tgt?.url ? { remote: targetRemote, kind: tgt.provider, url: tgt.url, repo: tgt.repo, account: tgt.account } : null;
    if (pctx) void usePullList.getState().ensure(pctx, true);
    useApp.getState().notify(text, pull.warnings.length > 0, [
      ...(pctx ? [{ label: t("pr.view"), onClick: () => usePullList.getState().show(path, pctx, pull.number) }] : []),
      { label: t("pr.open"), onClick: () => void api.openUrl(pull.url).catch(() => {}) },
      { label: t("pr.copy"), keep: true, onClick: () => void navigator.clipboard?.writeText(pull.url).catch(() => {}) },
    ]);
  };

  const submit = async () => {    if (!ready || !source || !tgt?.account || !src) return;
    setError(null);
    if (source.needsPush) {
      setBusy("push");
      // Sans suivi : vers le remote choisi, suivi configuré au passage ; avec (même disparu) :
      // vers sa branche suivie.
      const tracked = !!refs?.refs.find((r) => r.kind === "local" && r.short === source.branch && r.upstream);
      const ok = await useOps.getState().push(path, false, tracked ? undefined : source.remote!);
      if (!ok) {
        setBusy(null);
        return;
      }
    }
    setBusy("create");
    try {
      const choice = { assignees: persons(assignees), reviewers: persons(reviewers), labels };
      const pull = await api.createPull(tgt.provider, tgt.url ?? "", tgt.account, {
        sourceRepo: src.repo,
        sourceBranch: source.remoteBranch,
        targetRepo: tgt.repo,
        targetBranch: targetBranch.trim(),
        title: title.trim(),
        body,
        draft,
        ...choice,
      });
      if (ctx) usePullOptions.getState().remember(ctx, choice);
      announce(pull);
    } catch (e) {
      setError(errorCode(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog pull-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-title"
        ref={ref}
        onKeyDown={(e) => {
          trapTab(e, ref.current);
          // Ctrl+Entrée crée, depuis n'importe quel champ (la description comprise).
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) {
            e.preventDefault();
            void submit();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="pull-title">{t(`pr.title_${term}`)}</h2>
        {source && (
          <p className="pull-route mono">
            <span title={t("pr.sourceHint")}>{source.branch}</span>
            <Icon name="arrow" size={13} />
            <span className="visually-hidden">{t("pr.into")}</span>
            <span title={targetBranch ? `${targetRemote}/${targetBranch}` : targetRemote}>{targetBranch ? `${targetRemote}/${targetBranch}` : targetRemote}</span>
          </p>
        )}
        {/* Ce qui bloque, en tête : à régler avant de remplir le reste. */}
        {blocker && (
          <div className="pull-blocker" role="status">
            <p>{blocker}</p>
            {otherAccounts.map((l) => (
              <button
                key={l.account.id}
                type="button"
                className="btn sm"
                title={t("pr.useProfileHint", { remote: targetRemote })}
                onClick={() => void useProfiles.getState().setRemoteProfile(path, targetRemote, l.profile.id)}
              >
                {t("pr.useProfile", { remote: targetRemote, profile: l.profile.name, login: l.account.login })}
              </button>
            ))}
            {tgt && !tgt.account && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  close();
                  useProfiles.getState().openPage();
                }}
              >
                {t("pr.manageAccounts")}
              </button>
            )}
          </div>
        )}

        {/* Deux colonnes : le texte à gauche ; la cible, qui crée la PR / MR et les personnes à droite. */}
        <div className="dialog-cols">
          <div className="dialog-col">
            <label className="input-field">
              <span>{t("pr.titleField")}</span>
              <input
                autoFocus
                value={title}
                disabled={!!busy}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTextTouched(true);
                }}
                autoComplete="off"
              />
            </label>
            {templates.length > 0 && (
              <div className="input-field">
                <span>{t("pr.template")}</span>
                <Picker
                  label={t("pr.template")}
                  disabled={!!busy}
                  items={() => templates.map((tpl) => ({ label: tpl.name, checked: tpl.name === templateName, onClick: () => void useTemplate(tpl) }))}
                >
                  <Icon name="file" size={14} />
                  <span className="picker-text">{templateName ?? t("pr.templateNone")}</span>
                </Picker>
              </div>
            )}
            <label className="input-field">
              <span>{t("pr.body")}</span>
              <textarea
                className="pf-input pull-body"
                value={body}
                disabled={!!busy}
                rows={8}
                onChange={(e) => {
                  setBody(e.target.value);
                  setTextTouched(true);
                  bodyEdited.current = true;
                }}
              />
            </label>
            <label className="menu-check">
              <input type="checkbox" checked={draft} disabled={!!busy} onChange={(e) => setDraft(e.target.checked)} />
              {t("pr.draft")}
            </label>
          </div>
          <div className="dialog-col">
            <div className="pf-row pull-target">
              {/* Choix maison (thèmes de l'app) plutôt que <select> / <datalist> du système. */}
              {remotes.length > 1 && (
                <div className="input-field pull-remote">
                  <span>{t("pr.remote")}</span>
                  <Picker
                    label={t("pr.remote")}
                    disabled={!!busy}
                    items={() =>
                      remotes.map((r) => ({
                        label: r.name,
                        checked: r.name === targetRemote,
                        onClick: () => {
                          setTargetRemote(r.name);
                          setBranchTouched(false);
                        },
                      }))
                    }
                  >
                    <span className="picker-text mono">{targetRemote}</span>
                  </Picker>
                </div>
              )}
              <ComboField
                className="pull-branch"
                label={t("pr.target")}
                value={targetBranch}
                options={branches}
                disabled={!!busy}
                mono
                onChange={(v) => {
                  setTargetBranch(v);
                  setBranchTouched(true);
                }}
              />
            </div>
            {creator && (
              <p className="account-hint dialog-as">
                {t(`pr.createdBy_${term}`)} <strong>{creator.account.login}</strong>{" "}
                <span className="muted">{t("pr.createdByProfile", { provider: PROVIDER_NAMES[creator.account.kind], profile: creator.profile.name })}</span>
              </p>
            )}
            {ctx && (
              <div className="pull-people">
                <div className="pull-people-head">
                  <span className="eyebrow pull-people-title">{t("pr.people")}</span>
                  <span className="pull-people-status" role="status">
                    {entry?.loading
                      ? options
                        ? options.fromOwner
                          ? t("pr.loadingOwner", { owner: tgt?.owner })
                          : t("pr.refreshing")
                        : t("pr.loading")
                      : entry?.error
                        ? errorMessage(t, entry.error)
                        : age
                          ? t("pr.listAge", { age: t(`time.${age.key}`, { count: age.count }) })
                          : null}
                    {options?.truncated && ` · ${t("pr.truncated")}`}
                  </span>
                  {last && (
                    <button type="button" className="link" disabled={!!busy} onClick={reuseLast}>
                      {t("pr.reuseLast")}
                    </button>
                  )}
                  <button type="button" className="link" disabled={!!busy || !!entry?.loading || !ctx.account} onClick={() => void ensure(ctx, true)}>
                    {t("pr.refresh")}
                  </button>
                </div>
                <MultiPicker label={t("pr.reviewers")} options={reviewerOptions} selected={reviewers} onChange={pick(setReviewers)} disabled={!!busy} placeholder={t("pr.searchPeople")} />
                <div className="pull-assign-field">
                  <MultiPicker label={t("pr.assignees")} options={assigneeOptions} selected={assignees} onChange={pick(setAssignees)} disabled={!!busy} placeholder={t("pr.searchPeople")} />
                  {/* Seulement si le compte est dans la liste (GitLab a besoin de son identifiant). */}
                  {me && people.has(me.toLowerCase()) && !assignees.includes(me.toLowerCase()) && (
                    <button type="button" className="link pull-assign-me" disabled={!!busy} onClick={() => pick(setAssignees)([...assignees, me.toLowerCase()])}>
                      {t("pr.assignMe")}
                    </button>
                  )}
                </div>
                <MultiPicker label={t("pr.labels")} options={labelOptions} selected={labels} onChange={setLabels} disabled={!!busy} placeholder={t("pr.searchLabels")} />
              </div>
            )}
          </div>
        </div>
        {source?.needsPush && !blocker && <p className="account-hint">{t("pr.willPush", { branch: source.branch, remote: source.remote })}</p>}
        {error && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        {busy && (
          <p className="visually-hidden" role="status">
            {busy === "push" ? t("pr.pushing") : t("pr.creating")}
          </p>
        )}
        {leaving ? (
          <div className="dialog-actions pull-leave" role="group" aria-labelledby="pull-leave">
            <span id="pull-leave" className="dialog-why">
              {t(`pr.leave_${term}`)}
            </span>
            <button ref={leaveRef} type="button" className="btn" onClick={() => setLeaving(false)}>
              {t("pr.keepEditing")}
            </button>
            <button type="button" className="btn danger" onClick={close}>
              {t("pr.discard")}
            </button>
          </div>
        ) : (
          <div className="dialog-actions">
            {why && (
              <span id="pull-why" className="dialog-why">
                {why}
              </span>
            )}
            <button ref={backRef} type="button" className="btn" onClick={cancel} disabled={!!busy}>
              {t("confirm.cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={!ready} aria-describedby={why ? "pull-why" : undefined} title={t("pr.submitKeys")}>
              {busy === "push" ? t("pr.pushing") : busy === "create" ? t("pr.creating") : t(`pr.submit_${term}`)}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
