// Mise en forme des refs pour le graphe et la barre latérale (fonctions pures, testées dans refs.test.ts).

import type { GitRef, RefsInfo } from "./types";

export interface RefChip {
  label: string;
  kind: "head" | "local" | "remote" | "tag";
  /** Branche courante (HEAD). */
  current: boolean;
  /** Branche locale dont la distante du même nom pointe sur le même commit. */
  synced: boolean;
  /** Infobulle : toutes les refs représentées par l'étiquette. */
  title: string;
  /** Remote de la branche : le sien (distante), celui de son upstream ou de sa jumelle (locale). */
  remote?: string;
}

/** Remote d'une branche distante `origin/main` (un nom de remote peut contenir des « / »). */
export function remoteOfShort(short: string | null, remotes: string[]): string | undefined {
  if (!short) return undefined;
  return remotes.filter((r) => short.startsWith(r + "/")).sort((a, b) => b.length - a.length)[0];
}

const remoteName = (r: GitRef) => r.short.slice(0, r.short.indexOf("/"));
const remoteBranch = (r: GitRef) => r.short.slice(r.short.indexOf("/") + 1);

/** Étiquettes à afficher sur chaque commit, indexées par SHA, dans l'ordre d'affichage :
 *  branche courante, autres branches locales, distantes seules, tags. */
export function chipsByCommit(info: RefsInfo | null): Map<string, RefChip[]> {
  const out = new Map<string, RefChip[]>();
  if (!info) return out;
  const push = (sha: string, chip: RefChip) => {
    const list = out.get(sha);
    if (list) list.push(chip);
    else out.set(sha, [chip]);
  };

  const remotes = info.refs.filter((r) => r.kind === "remote");
  const remoteNames = [...new Set([...info.remotes.map((r) => r.name), ...remotes.map(remoteName)])];
  const absorbed = new Set<string>();
  const locals = info.refs
    .filter((r) => r.kind === "local")
    .sort((a, b) => Number(b.short === info.headBranch) - Number(a.short === info.headBranch));
  for (const l of locals) {
    const twins = remotes.filter((r) => r.target === l.target && remoteBranch(r) === l.short);
    twins.forEach((r) => absorbed.add(r.name));
    push(l.target, {
      label: l.short,
      kind: "local",
      current: l.short === info.headBranch,
      synced: twins.length > 0,
      title: [l.short, ...twins.map((r) => r.short)].join(" · "),
      remote: remoteOfShort(l.upstream, remoteNames) ?? remoteOfShort(twins[0]?.short ?? null, remoteNames),
    });
  }
  if (!info.headBranch && info.head) {
    out.set(info.head, [{ label: "HEAD", kind: "head", current: true, synced: false, title: "HEAD" }, ...(out.get(info.head) ?? [])]);
  }
  for (const r of remotes) {
    if (!absorbed.has(r.name)) push(r.target, { label: r.short, kind: "remote", current: false, synced: false, title: r.short, remote: remoteOfShort(r.short, remoteNames) });
  }
  for (const t of info.refs.filter((r) => r.kind === "tag")) {
    push(t.target, { label: t.short, kind: "tag", current: false, synced: false, title: t.short });
  }
  return out;
}

export interface RefSection {
  /** "local", "remote:<nom>", "tags". */
  key: string;
  kind: "local" | "remote" | "tags";
  /** Nom du remote (sections distantes). */
  remote?: string;
  items: GitRef[];
}

/** Sections de la barre latérale : branches locales, une section par remote, tags. */
export function refSections(info: RefsInfo | null): RefSection[] {
  if (!info) return [];
  const byName = (a: GitRef, b: GitRef) => a.short.localeCompare(b.short);
  const sections: RefSection[] = [
    { key: "local", kind: "local", items: info.refs.filter((r) => r.kind === "local").sort(byName) },
  ];
  // Un remote sans branche récupérée (ajouté, pas encore de fetch) a sa section, vide.
  const remotes = new Map<string, GitRef[]>(info.remotes.map((r) => [r.name, []]));
  for (const r of info.refs.filter((x) => x.kind === "remote")) {
    const name = remoteName(r);
    remotes.set(name, [...(remotes.get(name) ?? []), r]);
  }
  for (const [name, items] of [...remotes].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push({ key: `remote:${name}`, kind: "remote", remote: name, items: items.sort(byName) });
  }
  // Tags : les plus récents (selon le nom, versions comprises) en premier.
  const tags = info.refs
    .filter((r) => r.kind === "tag")
    .sort((a, b) => b.short.localeCompare(a.short, undefined, { numeric: true }));
  sections.push({ key: "tags", kind: "tags", items: tags });
  return sections;
}

/** Libellé d'une ref dans sa section (sans le préfixe du remote). */
export function sectionLabel(r: GitRef): string {
  return r.kind === "remote" ? remoteBranch(r) : r.short;
}

export type RefNode =
  | { type: "folder"; name: string; /** Chemin du dossier (`feature`, `feature/ui`). */ path: string; children: RefNode[]; count: number }
  | { type: "ref"; name: string; ref: GitRef };

/** Range les refs en arborescence selon les `/` de leur nom (`feature/a`, `feature/b` →
 *  dossier `feature`). Dossiers d'abord, puis refs, chacun par ordre alphabétique. */
export function refTree(items: GitRef[], label: (r: GitRef) => string = sectionLabel): RefNode[] {
  type Folder = { folders: Map<string, Folder>; refs: { name: string; ref: GitRef }[] };
  const root: Folder = { folders: new Map(), refs: [] };
  for (const ref of items) {
    const parts = label(ref).split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) node.folders.set(part, (next = { folders: new Map(), refs: [] }));
      node = next;
    }
    node.refs.push({ name: parts[parts.length - 1], ref });
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const build = (f: Folder, prefix: string): RefNode[] => [
    ...[...f.folders]
      .sort(([a], [b]) => cmp(a, b))
      .map(([name, sub]): RefNode => {
        const path = prefix ? `${prefix}/${name}` : name;
        const children = build(sub, path);
        const count = children.reduce((n, c) => n + (c.type === "ref" ? 1 : c.count), 0);
        return { type: "folder", name, path, children, count };
      }),
    ...f.refs.sort((a, b) => cmp(a.name, b.name)).map(({ name, ref }): RefNode => ({ type: "ref", name, ref })),
  ];
  return build(root, "");
}
