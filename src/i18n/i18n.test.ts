import { afterEach, describe, expect, it, vi } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { resolveLanguage } from ".";

/** Liste à plat des clés d'un fichier de traduction ("a.b.c"). */
function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("traductions", () => {
  it("FR et EN ont exactement les mêmes clés", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });
});

describe("resolveLanguage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("respecte un choix explicite", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("fr")).toBe("fr");
  });

  it("suit le système : français si francophone", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-CA");
    expect(resolveLanguage("system")).toBe("fr");
  });

  it("suit le système : anglais sinon", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    expect(resolveLanguage("system")).toBe("en");
  });
});
