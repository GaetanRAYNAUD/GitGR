import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import fr from "../i18n/locales/fr.json";
import { filterShortcuts, keyLabel, keyParts, SHORTCUTS, ZONES } from "./shortcuts";

describe("table des raccourcis", () => {
  it("identifiants uniques, zones connues, libellés en français et en anglais", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(ZONES).toContain(s.zone);
      expect((fr.shortcuts.items as Record<string, string>)[s.id], s.id).toBeTruthy();
      expect((en.shortcuts.items as Record<string, string>)[s.id], s.id).toBeTruthy();
    }
  });

  it("chaque touche nommée a sa traduction", () => {
    const named = new Set(SHORTCUTS.flatMap((s) => s.keys.flatMap(keyParts)).filter((k) => k.length > 1 && !/^F\d+$/.test(k) && !/…/.test(k)));
    for (const k of named) {
      expect((fr.shortcuts.keyNames as Record<string, string>)[k], k).toBeTruthy();
      expect((en.shortcuts.keyNames as Record<string, string>)[k], k).toBeTruthy();
    }
  });

  it("recherche par libellé (sans accents) ou par touche affichée", () => {
    const names = fr.shortcuts.keyNames as Record<string, string>;
    const label = (s: { id: string }) => (fr.shortcuts.items as Record<string, string>)[s.id];
    const combo = (k: string) => keyParts(k).map((p) => keyLabel(p, names)).join("+");
    expect(filterShortcuts(SHORTCUTS, "precedent", label, combo).map((s) => s.id)).toContain("prevTab");
    expect(filterShortcuts(SHORTCUTS, "ctrl+maj+k", label, combo).map((s) => s.id)).toEqual(["push"]);
    expect(filterShortcuts(SHORTCUTS, "", label, combo)).toHaveLength(SHORTCUTS.length);
  });
});
