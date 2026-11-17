import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { Notification, Profile } from "../lib/types";
import { useApp } from "./app";
import { activity, IDLE_SECONDS, notificationKey, pollDelay, resetNotifications, setLastInputForTests, useNotifications } from "./notifications";
import { useProfiles } from "./profiles";

const ACCOUNT = "github|https://github.com|moi";
const note = (id: string, updatedAt = 100): Notification => ({
  id,
  account: ACCOUNT,
  kind: "github",
  url: "https://github.com",
  repo: "o/r",
  subject: "pull",
  number: 1,
  title: `T${id}`,
  reason: "review_requested",
  webUrl: null,
  updatedAt,
});

beforeEach(() => {
  vi.restoreAllMocks();
  resetNotifications();
  useProfiles.setState({ profiles: [{ id: "p", name: "P", accounts: [{ id: ACCOUNT, kind: "github", url: "https://github.com", login: "moi", name: null }] } as unknown as Profile] });
  useApp.setState((s) => ({ settings: { ...s.settings, notificationsOff: false, systemNotificationsOff: false, notificationSpeed: "standard" } }));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

describe("rythme", () => {
  it("standard : 2 min / 10 min ; rapide : 1 / 5 ; jamais sous l'intervalle du provider ; pause", () => {
    expect(pollDelay("active", "standard", 0)).toBe(120);
    expect(pollDelay("background", "standard", 0)).toBe(600);
    expect(pollDelay("active", "fast", 0)).toBe(60);
    expect(pollDelay("background", "fast", 0)).toBe(300);
    expect(pollDelay("active", "fast", 90)).toBe(90);
    expect(pollDelay("paused", "fast", 0)).toBeNull();
  });
  it("inactif depuis 15 min : en pause ; fenêtre sans focus : arrière-plan", () => {
    expect(activity()).toBe("active");
    setLastInputForTests(Date.now() - (IDLE_SECONDS + 1) * 1000);
    expect(activity()).toBe("paused");
    setLastInputForTests(Date.now());
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(activity()).toBe("background");
  });
});

describe("lectures", () => {
  it("première lecture sans annonce ; ensuite seulement le nouveau, avec une notification du système", async () => {
    const poll = vi.spyOn(api, "pollNotifications").mockResolvedValueOnce({ changed: true, items: [note("1")], minInterval: null });
    const notify = vi.spyOn(api, "systemNotify").mockResolvedValue();
    await useNotifications.getState().pollDue(true);
    expect(notify).not.toHaveBeenCalled();
    // Pas encore dû (2 min) : aucune requête.
    await useNotifications.getState().pollDue();
    expect(poll).toHaveBeenCalledTimes(1);
    poll.mockResolvedValueOnce({ changed: true, items: [note("2", 200), note("1")], minInterval: null });
    await useNotifications.getState().pollDue(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toContain("T2");
    // `304` : la liste reste.
    poll.mockResolvedValueOnce({ changed: false, items: [], minInterval: null });
    await useNotifications.getState().pollDue(true);
    expect(useNotifications.getState().accounts[ACCOUNT].items).toHaveLength(2);
  });

  it("notifications du système désactivées, ou tout désactivé", async () => {
    const poll = vi.spyOn(api, "pollNotifications").mockResolvedValueOnce({ changed: true, items: [], minInterval: null }).mockResolvedValueOnce({ changed: true, items: [note("3")], minInterval: null });
    const notify = vi.spyOn(api, "systemNotify").mockResolvedValue();
    useApp.setState((s) => ({ settings: { ...s.settings, systemNotificationsOff: true } }));
    await useNotifications.getState().pollDue(true);
    await useNotifications.getState().pollDue(true);
    expect(notify).not.toHaveBeenCalled();
    expect(useNotifications.getState().accounts[ACCOUNT].items).toHaveLength(1);
    useApp.setState((s) => ({ settings: { ...s.settings, notificationsOff: true } }));
    await useNotifications.getState().pollDue(true);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("l'intervalle du provider est respecté même sur demande", async () => {
    const poll = vi.spyOn(api, "pollNotifications").mockResolvedValue({ changed: false, items: [], minInterval: 60 });
    await useNotifications.getState().pollDue(true);
    await useNotifications.getState().pollDue(true);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("vu en local ; marquer comme lu chez le provider retire la notification", async () => {
    vi.spyOn(api, "pollNotifications").mockResolvedValue({ changed: true, items: [note("1"), note("2")], minInterval: null });
    const seen = vi.spyOn(api, "addNotificationsSeen").mockResolvedValue();
    const read = vi.spyOn(api, "markNotificationRead").mockResolvedValue();
    await useNotifications.getState().pollDue(true);
    useNotifications.getState().markSeen([note("1")]);
    expect(seen).toHaveBeenCalledWith([notificationKey(note("1"))]);
    await useNotifications.getState().markRead(ACCOUNT, note("2"));
    expect(read).toHaveBeenCalledWith(ACCOUNT, "2");
    expect(useNotifications.getState().accounts[ACCOUNT].items.map((n) => n.id)).toEqual(["1"]);
    await useNotifications.getState().markRead(ACCOUNT);
    expect(read).toHaveBeenLastCalledWith(ACCOUNT, null);
    expect(useNotifications.getState().accounts[ACCOUNT].items).toEqual([]);
  });
});
