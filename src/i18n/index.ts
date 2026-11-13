import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { LanguageSetting } from "../lib/types";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const LANGUAGES = ["fr", "en"] as const;

/** Langue effective : celle choisie, sinon celle du système (FR si francophone, EN sinon). */
export function resolveLanguage(setting: LanguageSetting): string {
  if (setting !== "system") return setting;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: resolveLanguage("system"),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
