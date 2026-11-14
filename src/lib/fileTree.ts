// Arborescence des fichiers modifiés d'un commit (fonction pure, testée dans fileTree.test.ts).

export type FileNode<T extends { path: string }> =
  | {
      type: "dir";
      /** Libellé affiché : les dossiers à enfant unique sont fusionnés (`src/components/graph`). */
      name: string;
      /** Chemin complet du dossier, identifiant stable. */
      path: string;
      children: FileNode<T>[];
      /** Nombre de fichiers sous ce dossier. */
      count: number;
    }
  | { type: "file"; name: string; file: T };

interface Dir<T> {
  dirs: Map<string, Dir<T>>;
  files: T[];
}

/** Range les fichiers par dossier : dossiers d'abord, puis fichiers, par ordre alphabétique.
 *  Une chaîne de dossiers sans fichier ni autre sous-dossier est affichée sur une seule ligne. */
export function fileTree<T extends { path: string }>(files: T[]): FileNode<T>[] {
  const root: Dir<T> = { dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.path.split("/").slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [] }));
      node = next;
    }
    node.files.push(f);
  }

  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

  const build = (dir: Dir<T>, prefix: string): FileNode<T>[] => [
    ...[...dir.dirs]
      .sort(([a], [b]) => cmp(a, b))
      .map(([name, sub]): FileNode<T> => {
        let label = name;
        let path = prefix ? `${prefix}/${name}` : name;
        // Fusionne `a/` → `b/` tant que le dossier ne contient qu'un sous-dossier.
        while (sub.files.length === 0 && sub.dirs.size === 1) {
          const [childName, child] = [...sub.dirs][0];
          label = `${label}/${childName}`;
          path = `${path}/${childName}`;
          sub = child;
        }
        const children = build(sub, path);
        const count = children.reduce((n, c) => n + (c.type === "file" ? 1 : c.count), 0);
        return { type: "dir", name: label, path, children, count };
      }),
    ...[...dir.files]
      .sort((a, b) => cmp(base(a.path), base(b.path)))
      .map((file): FileNode<T> => ({ type: "file", name: base(file.path), file })),
  ];
  return build(root, "");
}
