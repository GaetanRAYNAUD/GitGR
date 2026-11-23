// Libellé d'un stash d'après son sujet de reflog (`%gs`) : « On main: message » pour un stash
// avec message, « WIP on main: abc1234 sujet » sans.

export function stashLabel(message: string): { branch: string | null; text: string } {
  const m = /^(WIP on|On) (.+?): (.*)$/s.exec(message);
  if (!m) return { branch: null, text: message };
  return { branch: m[2], text: m[3] || message };
}
