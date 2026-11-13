import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { errorMessage } from "./errors";

const t = i18n.t.bind(i18n);

describe("errorMessage", () => {
  it("traduit un code connu", () => {
    expect(errorMessage(t, "not_a_repo")).toBe("Ce dossier n’est pas un dépôt Git.");
    expect(errorMessage(t, "dubious_ownership")).toMatch(/safe\.directory/);
  });

  it("affiche tel quel un message brut de git, même avec . et :", () => {
    const raw = "fatal: unable to access 'https://x.y/z.git': Could not resolve host";
    expect(errorMessage(t, raw)).toBe(raw);
  });

  it("affiche tel quel un code inconnu", () => {
    expect(errorMessage(t, "code_inconnu")).toBe("code_inconnu");
  });
});
