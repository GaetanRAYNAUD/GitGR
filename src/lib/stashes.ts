// Libellé d'un stash d'après son sujet de reflog (`%gs`) : « On main: message » pour un stash
// avec message, « WIP on main: abc1234 sujet » sans.

export function stashLabel(message: string): { branch: string | null; text: string } {
  const m = /^(WIP on|On) (.+?): (.*)$/s.exec(message);
  if (!m) return { branch: null, text: message };
  return { branch: m[2], text: m[3] || message };
}

/** Arbre vide de git : départ du diff des fichiers non suivis d'un stash. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
