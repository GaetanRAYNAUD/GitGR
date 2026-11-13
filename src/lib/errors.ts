import type { TFunction } from "i18next";
import i18n from "../i18n";

/** Message lisible pour une erreur du backend : un code connu (`not_a_repo`…) est traduit,
 *  tout autre texte (message brut de git) est affiché tel quel — jamais utilisé comme clé i18n,
 *  car `.` et `:` y sont des séparateurs. */
export function errorMessage(t: TFunction, error: string): string {
  const key = `errors.${error}`;
  return /^[a-z_]+$/.test(error) && i18n.exists(key) ? t(key) : error;
}
