// Notifications des providers (relectures demandées, mentions, pipelines en échec…), une lecture
// par compte connecté, tous dépôts confondus (src-tauri/src/notifications.rs).
//
// Rythme (réglage « standard » / « rapide ») : fenêtre active toutes les 2 min (1), en
// arrière-plan toutes les 10 min (5) ; en pause quand la fenêtre est cachée ou après 15 min sans
// activité, avec une lecture au retour. Jamais plus souvent que ce que demande le provider
// (`X-Poll-Interval` chez GitHub). Chez GitHub, une lecture sans changement répond `304` et ne
// compte pas dans la limite de requêtes.
//
// « Vu » est local (gardé sur disque) ; « marquer comme lu » chez le provider est un bouton à part.

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import type { Account, Notification } from "../lib/types";
import { useApp } from "./app";
import { useProfiles } from "./profiles";

export const SPEEDS = {
  standard: { active: 120, background: 600 },
  fast: { active: 60, background: 300 },
} as const;
/** Sans clavier ni souris depuis ce délai : pause. */
export const IDLE_SECONDS = 15 * 60;
/** Vérification de ce qui est dû (aucune requête si rien ne l'est). */
const TICK_MS = 15_000;

export const notificationKey = (n: Notification) => `${n.account}|${n.id}|${n.updatedAt}`;

interface AccountState {
  items: Notification[];
  /** Dernière lecture (millisecondes), réussie ou non. */
  polledAt: number;
  /** Intervalle minimal demandé par le provider (secondes). */
  minInterval: number;
  error: string | null;
  /** Première lecture faite : les suivantes peuvent annoncer du nouveau. */
  primed: boolean;
}

interface NotificationsStore {
  accounts: Record<string, AccountState>;
  seen: Set<string>;
  panelOpen: boolean;
  /** Lit les comptes dont la lecture est due (`force` : tous). */
  pollDue(force?: boolean): Promise<void>;
  markSeen(items: Notification[]): void;
  /** Marque comme lu chez le provider (une notification, ou toutes celles du compte). */
  markRead(account: string, item?: Notification): Promise<void>;
  setPanel(open: boolean): void;
}

/** Comptes connectés, chacun une fois (un compte peut être lié à plusieurs profils). */
export function connectedAccounts(): Account[] {
  const out = new Map<string, Account>();
  for (const p of useProfiles.getState().profiles) for (const a of p.accounts ?? []) out.set(a.id, a);
  return [...out.values()];
}

/** État de la fenêtre pour le rythme des lectures. */
export type Activity = "active" | "background" | "paused";
let lastInput = Date.now();
export function activity(now = Date.now()): Activity {
  if (typeof document === "undefined" || document.hidden || now - lastInput > IDLE_SECONDS * 1000) return "paused";
  return document.hasFocus() ? "active" : "background";
}

/** Délai entre deux lectures d'un compte, en secondes ; `null` : en pause. */
export function pollDelay(state: Activity, speed: keyof typeof SPEEDS, minInterval: number): number | null {
  if (state === "paused") return null;
  return Math.max(SPEEDS[speed][state], minInterval);
}

const inflight = new Set<string>();

export const useNotifications = create<NotificationsStore>((set, get) => {
  const patch = (account: string, p: Partial<AccountState>) =>
    set((s) => ({ accounts: { ...s.accounts, [account]: { ...(s.accounts[account] ?? { items: [], polledAt: 0, minInterval: 0, error: null, primed: false }), ...p } } }));

  const pollOne = async (account: Account) => {
    if (inflight.has(account.id)) return;
    inflight.add(account.id);
    const before = get().accounts[account.id];
    patch(account.id, { polledAt: Date.now() });
    try {
      const r = await api.pollNotifications(account.id);
      if (!r.changed) {
        patch(account.id, { error: null, minInterval: r.minInterval ?? 0, primed: true });
        return;
      }
      const known = new Set((before?.items ?? []).map(notificationKey));
      const fresh = r.items.filter((n) => !known.has(notificationKey(n)) && !get().seen.has(notificationKey(n)));
      patch(account.id, { items: r.items, error: null, minInterval: r.minInterval ?? 0, primed: true });
      // Pas d'annonce à la première lecture (démarrage, compte ajouté) : seulement le badge.
      if (before?.primed && fresh.length) announce(fresh);
    } catch (e) {
      patch(account.id, { error: errorCode(e) });
    } finally {
      inflight.delete(account.id);
    }
  };

  return {
    accounts: {},
    seen: new Set(),
    panelOpen: false,
    async pollDue(force = false) {
      const settings = useApp.getState().settings;
      if (settings.notificationsOff) return;
      const state = activity();
      const speed = settings.notificationSpeed ?? "standard";
      const now = Date.now();
      const accounts = connectedAccounts();
      // Comptes retirés : leurs notifications aussi.
      const ids = new Set(accounts.map((a) => a.id));
      if (Object.keys(get().accounts).some((id) => !ids.has(id)))
        set((s) => ({ accounts: Object.fromEntries(Object.entries(s.accounts).filter(([id]) => ids.has(id))) }));
      await Promise.all(
        accounts.map((a) => {
          const st = get().accounts[a.id];
          const delay = pollDelay(state, speed, st?.minInterval ?? 0);
          const due = force ? !st || now - st.polledAt >= (st.minInterval ?? 0) * 1000 : delay !== null && (!st || now - st.polledAt >= delay * 1000);
          return due ? pollOne(a) : undefined;
        }),
      );
    },
    markSeen(items) {
      const keys = items.map(notificationKey).filter((k) => !get().seen.has(k));
      if (!keys.length) return;
      set((s) => ({ seen: new Set([...s.seen, ...keys]) }));
      api.addNotificationsSeen(keys).catch(() => {});
    },
    async markRead(account, item) {
      await api.markNotificationRead(account, item?.id ?? null);
      const st = get().accounts[account];
      if (!st) return;
      get().markSeen(item ? [item] : st.items);
      patch(account, { items: item ? st.items.filter((n) => n.id !== item.id) : [] });
    },
    setPanel(open) {
      set({ panelOpen: open });
    },
  };
});

/** Notification du système pour ce qui vient d'arriver (sauf si désactivé). */
function announce(fresh: Notification[]) {
  if (useApp.getState().settings.systemNotificationsOff) return;
  const t = i18n.t.bind(i18n);
  if (fresh.length === 1) {
    const n = fresh[0];
    void api.systemNotify(t(`notif.reason.${n.reason}`), `${n.repo}${n.number ? ` ${n.kind === "gitlab" ? "!" : "#"}${n.number}` : ""} — ${n.title}`).catch(() => {});
  } else {
    void api.systemNotify(t("notif.manyTitle", { count: fresh.length }), fresh.slice(0, 3).map((n) => n.title).join("\n")).catch(() => {});
  }
}

let started = false;
/** Lance le planificateur (une fois) : lecture au démarrage, puis selon l'activité. */
export function startNotifications() {
  if (started || typeof window === "undefined") return;
  started = true;
  api.notificationsSeen().then(
    (keys) => useNotifications.setState((s) => ({ seen: new Set([...keys, ...s.seen]) })),
    () => {},
  );
  const poll = (force = false) => void useNotifications.getState().pollDue(force);
  const input = () => {
    const wasPaused = activity() === "paused";
    lastInput = Date.now();
    if (wasPaused) poll(true);
  };
  for (const e of ["keydown", "pointerdown", "pointermove", "wheel"]) window.addEventListener(e, input, { passive: true });
  // Retour de la fenêtre : ce qui est dû au rythme actif est lu tout de suite.
  window.addEventListener("focus", () => poll());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll(true);
  });
  setInterval(() => poll(), TICK_MS);
  // Compte connecté ou retiré : lu (ou oublié) tout de suite.
  let ids = connectedAccounts().map((a) => a.id).sort().join("\n");
  useProfiles.subscribe(() => {
    const next = connectedAccounts().map((a) => a.id).sort().join("\n");
    if (next !== ids) {
      ids = next;
      poll(true);
    }
  });
  // Réglage réactivé : lu tout de suite.
  useApp.subscribe((s, prev) => {
    if (prev.settings.notificationsOff && !s.settings.notificationsOff) poll(true);
  });
  poll(true);
}

/** Pour les tests. */
export function resetNotifications() {
  inflight.clear();
  lastInput = Date.now();
  useNotifications.setState({ accounts: {}, seen: new Set(), panelOpen: false });
}

export function setLastInputForTests(ms: number) {
  lastInput = ms;
}
