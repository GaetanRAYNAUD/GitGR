import { describe, expect, it } from "vitest";
import { filterRepos, joinPath, overallPercent, repoNameFromUrl, repoUrl, validFolderName } from "./clone";
import type { ProviderRepo } from "./types";

const repo = (fullName: string, extra: Partial<ProviderRepo> = {}): ProviderRepo => ({
  fullName,
  name: fullName.split("/").pop()!,
  description: null,
  private: false,
  fork: false,
  archived: false,
  httpUrl: `https://h/${fullName}.git`,
  sshUrl: `git@h:${fullName}.git`,
  updatedAt: null,
  ...extra,
});

describe("clone", () => {
  it("tire le nom du dossier de l'URL", () => {
    expect(repoNameFromUrl("https://github.com/moi/depot.git")).toBe("depot");
    expect(repoNameFromUrl("git@github.com:moi/Mon-Depot.GIT")).toBe("Mon-Depot");
    expect(repoNameFromUrl("ssh://git@h:2222/g/sous/projet/")).toBe("projet");
    expect(repoNameFromUrl("C:\\depots\\local")).toBe("local");
    expect(repoNameFromUrl("https://h/x.git?ref=1")).toBe("x");
    expect(repoNameFromUrl("")).toBe("");
    expect(repoNameFromUrl("https://github.com/")).toBe("");
    expect(repoNameFromUrl("https://h/con.git")).toBe("");
  });

  it("valide un nom de dossier comme le backend", () => {
    for (const ok of ["depot", "mon-depot.git", ".config", "Été 2026"]) expect(validFolderName(ok)).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "a:b", "x.", " x", "x ", "CON", "nul.txt", "a\nb", "a*b"]) expect(validFolderName(bad)).toBe(false);
  });

  it("assemble le chemin de destination", () => {
    expect(joinPath("C:/Users/demo/Projects", "x")).toBe("C:/Users/demo/Projects/x");
    expect(joinPath("C:\\Users\\demo\\", "x")).toBe("C:\\Users\\demo\\x");
    expect(joinPath("/home/demo/", "x")).toBe("/home/demo/x");
  });

  it("choisit l'URL ssh ou https", () => {
    expect(repoUrl(repo("o/r"), true)).toBe("git@h:o/r.git");
    expect(repoUrl(repo("o/r"), false)).toBe("https://h/o/r.git");
    expect(repoUrl(repo("o/r", { sshUrl: null }), true)).toBe("https://h/o/r.git");
  });

  it("calcule l'avancement global", () => {
    expect(overallPercent({ phase: "counting", percent: null })).toBe(0);
    expect(overallPercent({ phase: "receiving", percent: 50 })).toBe(45);
    expect(overallPercent({ phase: "checkout", percent: 100 })).toBe(100);
  });

  it("filtre les dépôts sur tous les mots", () => {
    const list = [repo("octo/api", { description: "Serveur REST" }), repo("octo/front"), repo("autre/api")];
    expect(filterRepos(list, "").length).toBe(3);
    expect(filterRepos(list, "API octo").map((r) => r.fullName)).toEqual(["octo/api"]);
    expect(filterRepos(list, "rest").map((r) => r.fullName)).toEqual(["octo/api"]);
  });
});
