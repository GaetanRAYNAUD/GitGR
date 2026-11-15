// Validation d'un nom de branche ou de remote côté interface (le backend vérifie aussi, avec git).

/** Préfixe des stash créés par l'auto-stash (cf. src-tauri/src/branches.rs). */
export const AUTOSTASH_PREFIX = "GitGR-autostash: ";

/** Même idée que `git check-ref-format --branch` (en plus court). */
export function validBranchName(name: string): boolean {
  return (
    name !== "" &&
    name.trim() === name &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)
  );
}

/** Nom de remote : comme un nom de branche (il sert de préfixe à ses branches distantes). */
export const validRemoteName = validBranchName;
