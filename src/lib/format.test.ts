import { describe, expect, it } from "vitest";
import { commitDate, initials, relativeTime, remoteHost, remoteWebUrl } from "./format";

describe("remoteHost", () => {
  it.each([
    ["git@github.com:org/repo.git", "github.com"],
    ["git@gitlab.exemple.fr:groupe/sous/repo.git", "gitlab.exemple.fr"],
    ["https://github.com/org/repo.git", "github.com"],
    ["https://user:token@gitlab.exemple.fr/org/repo.git", "gitlab.exemple.fr"],
    ["ssh://git@gitlab.exemple.fr:2222/org/repo.git", "gitlab.exemple.fr"],
  ])("%s → %s", (url, host) => {
    expect(remoteHost(url)).toBe(host);
  });

  it("renvoie l'URL telle quelle si elle est inconnue", () => {
    expect(remoteHost("/chemin/local/repo")).toBe("/chemin/local/repo");
  });
});

describe("remoteWebUrl", () => {
  it.each([
    ["git@github.com:Org/Repo.git", "https://github.com/Org/Repo"],
    ["git@gitlab.exemple.fr:groupe/sous/repo.git", "https://gitlab.exemple.fr/groupe/sous/repo"],
    ["https://github.com/org/repo.git", "https://github.com/org/repo"],
    ["https://user:token@gitlab.exemple.fr/org/repo.git", "https://gitlab.exemple.fr/org/repo"],
    ["http://gitlab.local:8080/org/repo/", "http://gitlab.local:8080/org/repo"],
    ["ssh://git@gitlab.exemple.fr:2222/org/repo.git", "https://gitlab.exemple.fr/org/repo"],
  ])("%s → %s", (url, web) => {
    expect(remoteWebUrl(url)).toBe(web);
  });

  it("pas de page pour un chemin local ou une URL sans chemin", () => {
    expect(remoteWebUrl("/chemin/local/repo")).toBeNull();
    expect(remoteWebUrl("C:\\depots\\repo")).toBeNull();
    expect(remoteWebUrl("file:///srv/repo.git")).toBeNull();
    expect(remoteWebUrl("https://github.com/")).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  const min = 60_000;

  it.each([
    [0, { key: "justNow", count: 0 }],
    [59_000, { key: "justNow", count: 0 }],
    [5 * min, { key: "minutes", count: 5 }],
    [59 * min, { key: "minutes", count: 59 }],
    [60 * min, { key: "hours", count: 1 }],
    [23 * 60 * min, { key: "hours", count: 23 }],
    [3 * 24 * 60 * min, { key: "days", count: 3 }],
  ])("il y a %i ms", (ago, expected) => {
    expect(relativeTime(now - ago, now)).toEqual(expected);
  });
});

describe("commitDate", () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const day = 86_400_000;

  it("relative sur les 7 derniers jours", () => {
    expect(commitDate(now - 2 * day, "fr", now)).toEqual({ key: "days", count: 2 });
    expect(commitDate(now - 5 * 60_000, "fr", now)).toEqual({ key: "minutes", count: 5 });
  });

  it("date courte au-delà, avec l'année si elle diffère", () => {
    const sameYear = commitDate(now - 30 * day, "fr", now);
    expect(sameYear.key).toBe("date");
    expect(sameYear.key === "date" && sameYear.text).not.toMatch(/2026/);
    const older = commitDate(Date.UTC(2024, 2, 3), "fr", now);
    expect(older.key === "date" && older.text).toMatch(/2024/);
  });
});

describe("initials", () => {
  it.each([
    ["Camille Dupont", "CD"],
    ["alex", "A"],
    ["  Jean  Pierre  Martin ", "JM"],
    ["", "?"],
    ["Élodie Ölçer", "ÉÖ"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
