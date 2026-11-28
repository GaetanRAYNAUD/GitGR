// Fenêtre « Créer la release » d'un tag (clic droit sur un tag) : forge du remote, nom, notes
// tirées des commits depuis le tag précédent (modifiables), brouillon / pré-version (GitHub),
// tag poussé d'abord. Créée avec le compte du profil du remote.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { trapTab } from "../lib/focusTrap";
import { releaseNotes } from "../lib/releases";
import { useDismiss } from "../lib/useDismiss";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { useApp } from "../store/app";
import { useOps } from "../store/ops";
import { accountLogin, type PullContext, usePullContexts } from "../store/pullList";
import { useDialogs } from "../store/dialogs";
import { Icon } from "./Icon";
import { Picker } from "./Picker";

export const useReleaseDialog = create<{ open: { path: string; tag: string } | null; show(path: string, tag: string): void; hide(): void }>((set) => ({
  open: null,
  show: (path, tag) => set({ open: { path, tag } }),
  hide: () => set({ open: null }),
}));

export function ReleaseDialogHost() {
  const open = useReleaseDialog((s) => s.open);
  return open ? <ReleaseDialog key={`${open.path}|${open.tag}`} path={open.path} tag={open.tag} /> : null;
}

const FORGE = { github: "GitHub", gitlab: "GitLab" } as const;

function ReleaseDialog({ path, tag }: { path: string; tag: string }) {
  const { t } = useTranslation();
  const hide = useReleaseDialog((s) => s.hide);
  const ref = useRef<HTMLFormElement>(null);
  const contexts = usePullContexts(path);
  const [ctxKey, setCtxKey] = useState<string | null>(null);
  const ctx: PullContext | undefined = contexts.find((c) => c.remote === ctxKey) ?? contexts.find((c) => c.remote === "origin") ?? contexts[0];
  const [name, setName] = useState(tag);
  const [notes, setNotes] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [prerelease, setPrerelease] = useState(false);
  const [pushFirst, setPushFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);

  // Une saisie commencée n'est pas jetée par un clic à côté : Échap demande d'abord.
  const cancel = async () => {
    if (busy) return;
    if (touched.current) {
      const ok = await useDialogs.getState().choose({
        title: t("release.discardTitle"),
        body: t("release.discardBody"),
        choices: [{ id: "discard", label: t("release.discard"), danger: true }],
      });
      if (ok !== "discard") return;
    }
    hide();
  };
  useDismiss(ref, true, () => void cancel(), () => {});
  useRestoreFocus();

  useEffect(() => {
    let live = true;
    api.releaseDraft(path, tag).then(
      (d) => {
        if (!live) return;
        setPrevious(d.previous);
        setNotes(releaseNotes(d.commits, { feat: t("release.notes.feat"), fix: t("release.notes.fix"), other: t("release.notes.other"), breaking: t("release.notes.breaking") }));
      },
      (e) => live && (setNotes(""), setError(errorCode(e))),
    );
    return () => {
      live = false;
    };
  }, [path, tag, t]);

  const why = !ctx ? t("release.noForge") : !ctx.account ? t("release.noAccount", { remote: ctx.remote }) : notes === null ? t("release.loading") : null;
  const ready = !why && !busy;

  const submit = async () => {
    if (!ready || !ctx) return;
    setBusy(true);
    setError(null);
    if (pushFirst && !(await useOps.getState().pushTag(path, tag, ctx.remote))) {
      setBusy(false);
      return;
    }
    try {
      const r = await api.createRelease(ctx.kind, ctx.url, ctx.account, { repo: ctx.repo, tag, name, body: notes ?? "", draft, prerelease });
      hide();
      const warn = r.warnings.map((w) => t(`release.warnings.${w}`)).join(" ");
      useApp.getState().notify([t("release.created", { tag }), warn].filter(Boolean).join(" "), !!warn, r.url ? [{ label: t("release.open"), onClick: () => void api.openUrl(r.url) }] : undefined);
    } catch (e) {
      setError(errorCode(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <form
        ref={ref}
        className="dialog input-dialog release-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-title"
        onKeyDown={(e) => {
          trapTab(e, ref.current);
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="release-title">{t("release.title", { tag })}</h2>
        <p className="muted dialog-sub">{previous ? t("release.since", { previous }) : notes === null ? t("release.loading") : t("release.first")}</p>

        {contexts.length > 1 && ctx && (
          <div className="input-field">
            <span>{t("release.forge")}</span>
            <Picker
              label={t("release.forge")}
              disabled={busy}
              items={() => contexts.map((c) => ({ label: `${c.remote} · ${FORGE[c.kind]} · ${c.repo}`, checked: c.remote === ctx.remote, onClick: () => setCtxKey(c.remote) }))}
            >
              <Icon name={ctx.kind} size={15} />
              <span className="picker-text">{`${ctx.remote} · ${ctx.repo}`}</span>
            </Picker>
          </div>
        )}
        {contexts.length === 1 && ctx && (
          <p className="account-hint dialog-as">
            <Icon name={ctx.kind} size={14} /> {t("release.on", { forge: FORGE[ctx.kind], repo: ctx.repo })}
            {ctx.account && <span className="muted"> · {t("release.as", { login: accountLogin(ctx.account) })}</span>}
          </p>
        )}

        <label className="input-field">
          <span>{t("release.name")}</span>
          <input
            autoFocus
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              touched.current = true;
            }}
          />
        </label>
        <label className="input-field">
          <span>{t("release.notesLabel")}</span>
          <textarea
            className="release-notes mono"
            rows={12}
            value={notes ?? ""}
            disabled={busy || notes === null}
            placeholder={t("release.notesEmpty")}
            onChange={(e) => {
              setNotes(e.target.value);
              touched.current = true;
            }}
          />
        </label>
        {ctx?.kind === "github" && (
          <div className="release-checks">
            <label className="menu-check">
              <input type="checkbox" checked={draft} disabled={busy} onChange={(e) => setDraft(e.target.checked)} />
              {t("release.draft")}
            </label>
            <label className="menu-check">
              <input type="checkbox" checked={prerelease} disabled={busy} onChange={(e) => setPrerelease(e.target.checked)} />
              {t("release.prerelease")}
            </label>
          </div>
        )}
        {ctx && (
          <label className="menu-check">
            <input type="checkbox" checked={pushFirst} disabled={busy} onChange={(e) => setPushFirst(e.target.checked)} />
            {t("release.pushFirst", { tag, remote: ctx.remote })}
          </label>
        )}
        {error && (
          <p className="input-error" role="alert">
            {errorMessage(t, error)}
          </p>
        )}
        <div className="dialog-actions">
          {why && (
            <span id="release-why" className="dialog-why">
              {why}
            </span>
          )}
          <button type="button" className="btn" onClick={() => void cancel()} disabled={busy}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={!ready} aria-describedby={why ? "release-why" : undefined} title="Ctrl+Entrée">
            {busy ? t("release.creating") : t("release.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
