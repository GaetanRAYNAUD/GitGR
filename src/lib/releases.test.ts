import { describe, expect, it } from "vitest";
import { bumpVersion, nextTagName, releaseNotes } from "./releases";

const L = { feat: "Nouveautés", fix: "Corrections", other: "Autres", breaking: "Cassants" };
const c = (subject: string) => ({ sha: subject, subject });

describe("releaseNotes", () => {
  it("regroupe les conventional commits par type, cassants en tête, portée en gras", () => {
    const notes = releaseNotes([c("feat(ui): bouton"), c("fix: plantage"), c("chore: deps"), c("feat!: nouvelle API")], L);
    expect(notes).toBe("### Cassants\n\n- nouvelle API\n\n### Nouveautés\n\n- **ui** : bouton\n\n### Corrections\n\n- plantage\n\n### Autres\n\n- deps\n");
  });
  it("messages libres : une simple liste", () => {
    expect(releaseNotes([c("Ajoute le bouton"), c("Corrige le plantage"), c("fix: x")], L)).toBe("- Ajoute le bouton\n- Corrige le plantage\n- fix: x\n");
    expect(releaseNotes([], L)).toBe("");
  });
});

describe("bumpVersion", () => {
  it("patch, minor, major, préfixe gardé", () => {
    expect(bumpVersion("v1.2.3", "patch")).toBe("v1.2.4");
    expect(bumpVersion("v1.2.3", "minor")).toBe("v1.3.0");
    expect(bumpVersion("release-1.2.3-rc1", "major")).toBe("release-2.0.0");
    expect(bumpVersion("latest", "patch")).toBeNull();
  });
});

describe("nextTagName", () => {
  it("patch suivant du plus haut numéro (pas du dernier dans l'ordre alphabétique)", () => {
    expect(nextTagName(["v0.9.0", "v0.10.2", "latest", "v0.2.0"])).toBe("v0.10.3");
    expect(nextTagName(["latest"])).toBeNull();
  });
});
