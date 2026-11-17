// Cloche de la barre de titre : notifications des comptes connectés (relectures demandées,
// mentions, pipelines en échec…), groupées par dépôt. Un clic ouvre la PR / MR dans GitGR si le
// dépôt est ouvert ou connu (d'après ses remotes), sinon dans le navigateur.

import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { relativeTime } from "../lib/format";
import { parseRemote } from "../lib/profiles";
import { PROVIDER_NAMES } from "../lib/providers";
import type { Notification } from "../lib/types";
import { useDismiss } from "../lib/useDismiss";
import { useApp } from "../store/app";
import { useGraph } from "../store/graph";
import { notificationKey, useNotifications } from "../store/notifications";
import { usePullList } from "../store/pullList";
import { Icon, type IconName } from "./Icon";

const REASON_ICON: Record<Notification["reason"], IconName> = {
  review_requested: "eye",
  mention: "comment",
  comment: "comment",
  assigned: "user",
  approval: "check",
  ci_failed: "alert",
  author: "pr",
  state: "merge",
  other: "pr",
};

const hostOf = (url: string) => url.replace(/^[a-z]+:\/\//i, "").split(/[/:]/)[0].toLowerCase();

/** Dépôt local (onglet ouvert ou récent déjà lu) dont un remote pointe vers ce dépôt distant. */
function localRepo(n: Notification): { path: string; remote: string } | null {
  const host = hostOf(n.url);
  const want = n.repo.toLowerCase();
  const matches = (url: string | null) => {
    const r = parseRemote(url);
    return !!r && r.host === host && r.path === want;
  };
  for (const [path, g] of Object.entries(useGraph.getState().graphs)) {
    const remote = g?.refs?.remotes.find((r) => matches(r.url));
    if (remote) return { path, remote: remote.name };
  }
  for (const [path, s] of Object.entries(useApp.getState().summaries)) if (matches(s?.data?.remoteUrl ?? null)) return { path, remote: "origin" };
  return null;
}

export async function openNotification(n: Notification) {
  useNotifications.getState().markSeen([n]);
  const local = n.subject === "pull" && n.number ? localRepo(n) : null;
  if (local && n.number) {
    const app = useApp.getState();
    if (app.tabs.includes(local.path)) app.activate(local.path);
    else await app.openPath(local.path);
    usePullList.getState().show(local.path, { remote: local.remote, kind: n.kind, url: n.url, repo: n.repo, account: n.account }, n.number);
    useNotifications.getState().setPanel(false);
    return;
  }
  if (n.webUrl) await api.openUrl(n.webUrl).catch(() => {});
}

export function NotificationsBell() {
  const { t } = useTranslation();
  const accounts = useNotifications((s) => s.accounts);
  const seen = useNotifications((s) => s.seen);
  const open = useNotifications((s) => s.panelOpen);
  const setPanel = useNotifications((s) => s.setPanel);
  const off = useApp((s) => !!s.settings.notificationsOff);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPanel(false), [setPanel]);
  useDismiss(ref, open, close);

  const items = useMemo(() => Object.values(accounts).flatMap((a) => a.items).sort((a, b) => b.updatedAt - a.updatedAt), [accounts]);
  const unseen = items.filter((n) => !seen.has(notificationKey(n)));
  const errors = Object.entries(accounts).filter(([, a]) => a.error);
  const groups = useMemo(() => {
    const m = new Map<string, Notification[]>();
    for (const n of items) {
      const k = `${hostOf(n.url)} · ${n.repo}`;
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    return [...m.entries()];
  }, [items]);
  if (off) return null;

  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
  const ref_ = (n: Notification) => (n.number ? `${n.kind === "gitlab" ? "!" : "#"}${n.number}` : "");
  const providers = [...new Set(items.map((n) => n.kind))];
  const label = unseen.length ? t("notif.button", { count: unseen.length }) : t("notif.title");

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className={open ? "wc on" : "wc"}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setPanel(!open)}
      >
        <Icon name="bell" size={16} />
        {unseen.length > 0 && <span className="notif-badge">{unseen.length > 99 ? "99+" : unseen.length}</span>}
      </button>
      {open && (
        <div className="popover notif-panel" role="dialog" aria-label={t("notif.title")}>
          <div className="notif-head">
            <strong>{t("notif.title")}</strong>
            <span className="status-spacer" />
            {unseen.length > 0 && (
              <button className="link" onClick={() => useNotifications.getState().markSeen(items)}>
                {t("notif.allSeen")}
              </button>
            )}
            <button className="icon-btn sm" aria-label={t("notif.refresh")} title={t("notif.refresh")} onClick={() => void useNotifications.getState().pollDue(true)}>
              <Icon name="fetch" size={14} />
            </button>
          </div>
          {errors.map(([id, a]) => (
            <p key={id} className="notif-error" role="alert">
              {id.split("|").pop()} : {errorMessage(t, a.error!)}
            </p>
          ))}
          {items.length === 0 ? (
            <p className="notif-empty muted">{Object.keys(accounts).length ? t("notif.empty") : t("notif.noAccount")}</p>
          ) : (
            <div className="notif-list">
              {groups.map(([group, list]) => (
                <section key={group}>
                  <div className="notif-group mono">{group}</div>
                  <ul>
                    {list.map((n) => {
                      const isNew = !seen.has(notificationKey(n));
                      return (
                        <li key={notificationKey(n)} className={isNew ? "notif-item new" : "notif-item"}>
                          <button className="notif-main" onClick={() => void openNotification(n)} title={n.webUrl ?? undefined}>
                            <span className={`notif-icon ${n.reason}`}>
                              <Icon name={REASON_ICON[n.reason]} size={14} />
                            </span>
                            <span className="notif-text">
                              <span className="notif-title">
                                {ref_(n) && <span className="mono muted">{ref_(n)} </span>}
                                {n.title}
                              </span>
                              <span className="notif-meta muted">
                                {t(`notif.reason.${n.reason}`)} · {ago(n.updatedAt)}
                              </span>
                            </span>
                          </button>
                          <button
                            className="icon-btn sm notif-read"
                            aria-label={t("notif.markRead", { provider: PROVIDER_NAMES[n.kind] })}
                            title={t("notif.markRead", { provider: PROVIDER_NAMES[n.kind] })}
                            onClick={() => void useNotifications.getState().markRead(n.account, n).catch((e) => useApp.setState({ error: String(e) }))}
                          >
                            <Icon name="check" size={14} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <div className="notif-foot">
              {providers.map((k) => (
                <button
                  key={k}
                  className="link"
                  onClick={() => {
                    for (const id of new Set(items.filter((n) => n.kind === k).map((n) => n.account)))
                      void useNotifications.getState().markRead(id).catch((e) => useApp.setState({ error: String(e) }));
                  }}
                >
                  {t("notif.allRead", { provider: PROVIDER_NAMES[k] })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
