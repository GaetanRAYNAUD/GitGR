// Fenêtre « Créer une pull request » (GitHub) / « Créer une merge request » (GitLab) : de la
// branche courante vers une branche d'un remote. La branche est poussée d'abord si besoin ; le
// titre et la description sont pré-remplis d'après ses commits et le modèle du dépôt.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { parseRemote, remoteProfile } from "../lib/profiles";
import { PROVIDER_NAMES, remoteAccount, remoteInstance, remoteProvider } from "../lib/providers";
import { draftText, pullSource, type PullTarget } from "../lib/pulls";
import type { Pull, ProviderKind, RefsInfo } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useGraph } from "../store/graph";
import { useOps } from "../store/ops";
import { useProfiles } from "../store/profiles";
import { usePullDialog } from "../store/pulls";
import { Icon } from "./Icon";

/** « pr » (GitHub) ou « mr » (GitLab) : suffixe des libellés. */
export const pullTerm = (kind: ProviderKind | null) => (kind === "gitlab" ? "mr" : "pr");

/** Numéro tel que le provider l'affiche : `#12` (GitHub), `!12` (GitLab). */
const pullRef = (kind: ProviderKind | null, n: number) => (kind === "gitlab" ? `!${n}` : `#${n}`);

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
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState<"push" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Pull | null>(null);
  const [copied, setCopied] = useState(false);

  const cancel = useCallback(() => {
    if (!busy) close();
  }, [busy, close]);
  useDismiss(ref, true, cancel);

  /** Provider, instance, dépôt et compte d'un remote. */
  const side = useCallback(
    (name: string | null) => {
      const remote = remotes.find((r) => r.name === name);
      const parsed = parseRemote(remote?.url ?? null);
      const provider = remoteProvider(profiles, parsed);
      if (!remote || !parsed || !provider) return null;
      const account = remoteAccount(remoteProfile(profiles, binding, remote).profile, parsed);
      return { provider, parsed, account, url: remoteInstance(profiles, parsed, account) ?? "" };
    },
    [remotes, profiles, binding],
  );
  const tgt = side(targetRemote);
  const src = side(source?.remote ?? null);
  const kind = tgt?.provider ?? null;
  const term = pullTerm(kind);
  const branches = useMemo(() => remoteBranches(refs, targetRemote), [refs, targetRemote]);

  // Branche cible proposée : la branche par défaut du dépôt distant (API), sinon main / master.
  const tgtKey = tgt ? `${tgt.provider}|${tgt.url}|${tgt.parsed.path}|${tgt.account?.id ?? ""}` : "";
  useEffect(() => {
    if (branchTouched || !tgt) return;
    let live = true;
    const fallback = () => branches.find((b) => b === "main") ?? branches.find((b) => b === "master") ?? branches[0] ?? "";
    if (!tgt.account) {
      setTargetBranch(fallback());
      return;
    }
    api.remoteDefaultBranch(tgt.provider, tgt.url, tgt.parsed.path, tgt.account.id).then(
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
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [path, sourceBranch, targetRemote, targetBranch, kind, textTouched]);

  // Ce qui empêche la création, dans l'ordre où il faut le régler.
  const blocker = !head
    ? t("pr.detached")
    : !source?.remote
      ? t("pr.noRemote")
      : !tgt
        ? t("pr.unknownProvider", { remote: targetRemote })
        : !tgt.account
          ? t("pr.noAccount", { provider: PROVIDER_NAMES[tgt.provider], remote: targetRemote })
          : !src || src.provider !== tgt.provider || src.parsed.host !== tgt.parsed.host
            ? t("pr.otherInstance", { source: source.remote, target: targetRemote })
            : targetRemote === source.remote && targetBranch === source.remoteBranch
              ? t("pr.sameBranch")
              : null;
  const ready = !blocker && !!targetBranch.trim() && !!title.trim() && !busy;

  const submit = async () => {
    if (!ready || !source || !tgt?.account || !src) return;
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
      const pull = await api.createPull(tgt.provider, tgt.url, tgt.account.id, {
        sourceRepo: src.parsed.path,
        sourceBranch: source.remoteBranch,
        targetRepo: tgt.parsed.path,
        targetBranch: targetBranch.trim(),
        title: title.trim(),
        body,
        draft,
      });
      setDone(pull);
    } catch (e) {
      setError(errorCode(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = () => {
    if (!done) return;
    navigator.clipboard?.writeText(done.url).then(
      () => setCopied(true),
      () => {},
    );
  };

  if (done) {
    return (
      <div className="overlay">
        <form className="dialog input-dialog pull-dialog" role="dialog" aria-modal="true" aria-labelledby="pull-title" ref={ref} onSubmit={(e) => e.preventDefault()}>
          <h2 id="pull-title">
            {done.existing ? t(`pr.exists_${term}`, { ref: pullRef(kind, done.number) }) : t(`pr.created_${term}`, { ref: pullRef(kind, done.number) })}
          </h2>
          <p className="pull-done-title">{done.title}</p>
          <p className="account-hint mono pull-url" title={done.url}>
            {done.url}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>
              {t("pr.close")}
            </button>
            <button type="button" className="btn" onClick={copy}>
              {copied ? t("pr.copied") : t("pr.copy")}
            </button>
            <button type="button" className="btn primary" autoFocus onClick={() => api.openUrl(done.url).catch(() => {})}>
              {t("pr.open")}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="overlay">
      <form
        className="dialog input-dialog pull-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-title"
        ref={ref}
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
            <span>{targetBranch ? `${targetRemote}/${targetBranch}` : targetRemote}</span>
          </p>
        )}

        <div className="pf-row pull-target">
          {remotes.length > 1 && (
            <label className="input-field pull-remote">
              <span>{t("pr.remote")}</span>
              <select
                className="pf-input"
                value={targetRemote}
                disabled={!!busy}
                onChange={(e) => {
                  setTargetRemote(e.target.value);
                  setBranchTouched(false);
                }}
              >
                {remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="input-field pull-branch">
            <span>{t("pr.target")}</span>
            <input
              className="pf-input mono"
              list="pull-branches"
              value={targetBranch}
              disabled={!!busy}
              onChange={(e) => {
                setTargetBranch(e.target.value);
                setBranchTouched(true);
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <datalist id="pull-branches">
              {branches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
        </div>

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
            }}
          />
        </label>
        <label className="menu-check">
          <input type="checkbox" checked={draft} disabled={!!busy} onChange={(e) => setDraft(e.target.checked)} />
          {t("pr.draft")}
        </label>

        {source?.needsPush && !blocker && <p className="account-hint">{t("pr.willPush", { branch: source.branch, remote: source.remote })}</p>}
        {blocker && (
          <div className="pull-blocker" role="alert">
            <p>{blocker}</p>
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
        {error && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel} disabled={!!busy}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!ready}>
            {busy === "push" ? t("pr.pushing") : busy === "create" ? t("pr.creating") : t(`pr.submit_${term}`)}
          </button>
        </div>
      </form>
    </div>
  );
}
