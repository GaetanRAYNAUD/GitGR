import { describe, expect, it } from "vitest";
import { relativeTime, remoteHost } from "./format";

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
