// Publier un dépôt local sur GitHub / GitLab : règles du nom du dépôt distant et choix par
// défaut de la fenêtre (src/components/PublishDialog.tsx).

/** Nom accepté par les deux providers (GitLab : aussi le chemin du projet) : lettres ASCII,
 *  chiffres, `.`, `_`, `-` ; ni `.` ni `-` en tête, ni `.git` / `.atom` à la fin. Même règle
 *  que `valid_repo_name` (src-tauri/src/providers.rs). */
export function validRepoName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 100 &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    !/^[.-]/.test(name) &&
    !name.endsWith(".git") &&
    !name.endsWith(".atom")
  );
}

/** Nom proposé d'après le dossier du dépôt : accents retirés, autres caractères remplacés par
 *  `-` (« Mon Projet » → `Mon-Projet`) ; vide si rien n'en reste. */
export function repoNameFromFolder(folder: string): string {
  const name = folder
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|-+$/g, "")
    .replace(/\.(git|atom)$/, "")
    .slice(0, 100);
  return validRepoName(name) ? name : "";
}

/** Nom du remote proposé : `origin` s'il est libre, sinon le nom du provider (`github`,
 *  `gitlab`), suffixé au besoin. */
export function freeRemoteName(taken: string[], provider: string): string {
  const used = new Set(taken);
  if (!used.has("origin")) return "origin";
  if (!used.has(provider)) return provider;
  let n = 2;
  while (used.has(`${provider}${n}`)) n++;
  return `${provider}${n}`;
}
