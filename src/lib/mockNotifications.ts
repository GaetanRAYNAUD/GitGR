// Backend simulé des notifications (navigateur seulement) : deux par compte au départ ; les tests
// en ajoutent avec `window.__mockAddNotification` et lisent les notifications du système envoyées.

import type { Notification, NotificationPoll } from "./types";

const lists = new Map<string, Notification[]>();
/** Comptes dont la liste a changé depuis la dernière lecture (sinon : « 304 »). */
const dirty = new Set<string>();
export const mockSeenNotifications = new Set<string>();
export const mockSystemNotifications: { title: string; body: string }[] = [];
export const mockNotificationPolls: { account: string; changed: boolean }[] = [];

function seed(account: string): Notification[] {
  const [kind, url] = account.split("|");
  const k = kind === "gitlab" ? "gitlab" : "github";
  const t = Math.floor(Date.now() / 1000);
  const repo = k === "gitlab" ? "demo/gitgr" : "octo-demo/gitgr";
  const page = (n: number) => `${url}/${repo}/${k === "gitlab" ? "-/merge_requests" : "pull"}/${n}`;
  return [
    { id: "n1", account, kind: k, url, repo, subject: "pull", number: 13, title: "Corriger la phrase de passe de l'agent SSH", reason: "review_requested", webUrl: page(13), updatedAt: t - 600 },
    { id: "n2", account, kind: k, url, repo: k === "gitlab" ? "demo/api-backend" : "octo-demo/api", subject: "pull", number: 4, title: "Pagination des comptes", reason: "mention", webUrl: page(4), updatedAt: t - 7200 },
  ];
}

export function mockPollNotifications(account: string): NotificationPoll {
  let list = lists.get(account);
  const first = !list;
  if (!list) lists.set(account, (list = seed(account)));
  const changed = first || dirty.has(account);
  dirty.delete(account);
  mockNotificationPolls.push({ account, changed });
  // GitLab n'annonce pas d'intervalle ; GitHub demande 60 s.
  return { changed, items: changed ? [...list] : [], minInterval: account.startsWith("github|") ? 60 : null };
}

export function mockMarkNotificationRead(account: string, id: string | null) {
  const list = lists.get(account) ?? [];
  lists.set(account, id ? list.filter((n) => n.id !== id) : []);
  dirty.add(account);
}

export function mockAddNotification(n: Notification) {
  lists.set(n.account, [n, ...(lists.get(n.account) ?? seed(n.account))]);
  dirty.add(n.account);
}

if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  Object.assign(window, {
    __mockAddNotification: mockAddNotification,
    __mockSystemNotifications: mockSystemNotifications,
    __mockNotificationPolls: mockNotificationPolls,
  });
}
