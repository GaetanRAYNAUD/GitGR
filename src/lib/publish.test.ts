import { describe, expect, it } from "vitest";
import { freeRemoteName, repoNameFromFolder, validRepoName } from "./publish";

describe("nom du dépôt à publier", () => {
  it("suit la règle commune à GitHub et GitLab (la même que le backend)", () => {
    for (const ok of ["gitgr", "Mon_Depot-2.0", "a"]) expect(validRepoName(ok), ok).toBe(true);
    for (const bad of ["", "-x", ".x", "a b", "été", "a/b", "x.git", "x.atom", "a".repeat(101)]) expect(validRepoName(bad), bad).toBe(false);
  });

  it("est tiré du dossier", () => {
    expect(repoNameFromFolder("GitGR")).toBe("GitGR");
    expect(repoNameFromFolder("Mon Projet")).toBe("Mon-Projet");
    expect(repoNameFromFolder("Été 2026")).toBe("Ete-2026");
    expect(repoNameFromFolder(".config")).toBe("config");
    expect(repoNameFromFolder("depot.git")).toBe("depot");
    expect(repoNameFromFolder("日本")).toBe("");
  });
});

describe("nom du remote proposé", () => {
  it("origin s'il est libre, sinon le provider", () => {
    expect(freeRemoteName([], "github")).toBe("origin");
    expect(freeRemoteName(["origin"], "github")).toBe("github");
    expect(freeRemoteName(["origin", "gitlab", "gitlab2"], "gitlab")).toBe("gitlab3");
  });
});
