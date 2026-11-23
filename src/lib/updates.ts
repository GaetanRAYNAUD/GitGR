// Mises à jour de GitGR : ce que permet chaque paquet, pages des releases.

import type { InstallKind } from "./types";

/** Notes de version : les releases du dépôt de GitGR. */
export const RELEASES_URL = "https://github.com/GaetanRAYNAUD/GitGR/releases";

/** Page de la release d'une version (tags `vX.Y.Z`). */
export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version.replace(/^v/, "")}`;
}

/** Comment GitGR se met à jour selon son paquet : seul (installateur Windows, AppImage, macOS),
 *  par le gestionnaire de paquets (deb, rpm : l'app prévient seulement), ou pas du tout
 *  (build de développement). */
export function updateMode(kind: InstallKind): "auto" | "manual" | "none" {
  switch (kind) {
    case "nsis":
    case "msi":
    case "appimage":
    case "app":
      return "auto";
    case "deb":
    case "rpm":
      return "manual";
    default:
      return "none";
  }
}
