import { describe, expect, it } from "vitest";
import { manifest, nextVersion, releaseChangelog, releaseNotes } from "./release.mjs";

const CHANGELOG = `# Changelog

Intro.

## Non publié

- Nouveauté A
- Correction B

## [0.1.0] — 2026-11-01

- Première version
`;

describe("nextVersion", () => {
  it("monte le bon niveau", () => {
    expect(nextVersion("0.1.2", "patch")).toBe("0.1.3");
    expect(nextVersion("0.1.2", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.2", "major")).toBe("1.0.0");
    expect(nextVersion("0.1.2", "current")).toBe("0.1.2");
  });

  it("refuse un niveau ou une version inconnus", () => {
    expect(() => nextVersion("0.1.2", "huge")).toThrow(/niveau inconnu/);
    expect(() => nextVersion("0.1", "patch")).toThrow(/version invalide/);
  });
});

describe("changelog", () => {
  it("« Non publié » devient la section datée de la version, une nouvelle reste vide au-dessus", () => {
    const out = releaseChangelog(CHANGELOG, "0.2.0", "2026-11-23");
    expect(out).toBe(`# Changelog

Intro.

## Non publié

## [0.2.0] — 2026-11-23

- Nouveauté A
- Correction B

## [0.1.0] — 2026-11-01

- Première version
`);
    expect(releaseNotes(out, "0.2.0")).toBe("- Nouveauté A\n- Correction B");
    expect(releaseNotes(out, "0.1.0")).toBe("- Première version");
  });

  it("section vide : remplie avec les PR fusionnées", () => {
    const empty = releaseChangelog(CHANGELOG, "0.2.0", "2026-11-23");
    const out = releaseChangelog(empty, "0.2.1", "2026-11-24", [{ number: 34, title: "Distribution", url: "https://github.com/o/r/pull/34" }]);
    expect(releaseNotes(out, "0.2.1")).toBe("- Distribution ([#34](https://github.com/o/r/pull/34))");
  });

  it("refuse une section vide sans PR, ou une version déjà présente", () => {
    const empty = releaseChangelog(CHANGELOG, "0.2.0", "2026-11-23");
    expect(() => releaseChangelog(empty, "0.2.1", "2026-11-24")).toThrow(/rien à publier/);
    expect(() => releaseChangelog(CHANGELOG, "0.1.0", "2026-11-24")).toThrow(/déjà une section/);
  });
});

describe("manifest", () => {
  const files = ["GitGR_0.2.0_x64-setup.exe", "GitGR_0.2.0_x64-setup.exe.sig", "GitGR_0.2.0_amd64.AppImage", "GitGR_0.2.0_amd64.AppImage.sig", "GitGR_0.2.0_amd64.deb"];
  const base = "https://github.com/o/r/releases/download/v0.2.0";

  it("une entrée signée par plateforme", () => {
    const m = manifest("0.2.0", "notes", files, (f) => `sig de ${f}\n`, base, "2026-11-23T10:00:00Z");
    expect(m.version).toBe("0.2.0");
    expect(m.platforms["windows-x86_64"]).toEqual({ signature: "sig de GitGR_0.2.0_x64-setup.exe.sig", url: `${base}/GitGR_0.2.0_x64-setup.exe` });
    expect(m.platforms["windows-x86_64-nsis"]).toEqual(m.platforms["windows-x86_64"]);
    expect(m.platforms["linux-x86_64"].url).toBe(`${base}/GitGR_0.2.0_amd64.AppImage`);
    expect(m.platforms["darwin-aarch64"]).toBeUndefined();
  });

  it("macOS : l'archive .app.tar.gz pour Intel et Apple Silicon", () => {
    const m = manifest("0.2.0", "", [...files, "GitGR_0.2.0_universal.app.tar.gz", "GitGR_0.2.0_universal.app.tar.gz.sig"], () => "s", base, "d");
    expect(m.platforms["darwin-aarch64"].url).toBe(`${base}/GitGR_0.2.0_universal.app.tar.gz`);
    expect(m.platforms["darwin-x86_64"]).toEqual(m.platforms["darwin-aarch64"]);
  });

  it("refuse un paquet sans signature", () => {
    expect(() => manifest("0.2.0", "", files.filter((f) => !f.endsWith("AppImage.sig")), () => "s", base, "d")).toThrow(/signature manquante/);
  });
});
