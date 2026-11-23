// Motifs `.gitignore` proposés au clic droit sur un fichier non suivi : ce fichier, son
// extension, son dossier. Chemins ancrés à la racine (« / » en tête) pour ne viser qu'eux.

export interface IgnoreChoice {
  kind: "file" | "ext" | "dir";
  pattern: string;
  /** Ce que le motif désigne, pour le libellé (`a.log`, `*.log`, `logs/`). */
  label: string;
}

/** Échappe ce que `.gitignore` interprète dans un nom (`*`, `?`, `[`, `\`, espaces finaux). */
function escape(path: string): string {
  return path.replace(/[\\*?[\]]/g, (c) => `\\${c}`).replace(/ +$/, (sp) => sp.replace(/ /g, "\\ "));
}

export function ignoreChoices(file: string): IgnoreChoice[] {
  const slash = file.lastIndexOf("/");
  const name = file.slice(slash + 1);
  const out: IgnoreChoice[] = [{ kind: "file", pattern: `/${escape(file)}`, label: name }];
  // Une extension, pas un nom qui commence par un point (`.env`).
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot);
    out.push({ kind: "ext", pattern: `*${escape(ext)}`, label: `*${ext}` });
  }
  if (slash > 0) {
    const dir = file.slice(0, slash);
    out.push({ kind: "dir", pattern: `/${escape(dir)}/`, label: `${dir}/` });
  }
  return out;
}
