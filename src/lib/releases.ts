// Notes d'une release tirées des commits (fonctions pures, testées dans releases.test.ts).

export interface NoteCommit {
  sha: string;
  subject: string;
}

export interface NoteLabels {
  feat: string;
  fix: string;
  other: string;
  breaking: string;
}

/** `type(portée)!: message` des conventional commits. */
const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/** Notes en Markdown : commits regroupés par type s'ils suivent les conventional commits
 *  (changements cassants, nouveautés, corrections, le reste), sinon une simple liste. */
export function releaseNotes(commits: NoteCommit[], labels: NoteLabels): string {
  if (!commits.length) return "";
  const parsed = commits.map((c) => {
    const m = CONVENTIONAL.exec(c.subject.trim());
    if (!m) return { group: "other" as const, text: c.subject.trim(), breaking: false };
    const [, type, scope, bang, text] = m;
    const t = type.toLowerCase();
    const group = t === "feat" ? ("feat" as const) : t === "fix" ? ("fix" as const) : ("other" as const);
    return { group, text: scope ? `**${scope}** : ${text}` : text, breaking: !!bang };
  });
  const conventional = commits.filter((c) => CONVENTIONAL.test(c.subject.trim())).length;
  // Moins de la moitié des messages suivent la convention : une liste, sans titres.
  if (conventional * 2 < commits.length) return commits.map((c) => `- ${c.subject.trim()}`).join("\n") + "\n";
  const sections: string[] = [];
  const add = (title: string, items: string[]) => {
    if (items.length) sections.push(`### ${title}\n\n${items.map((x) => `- ${x}`).join("\n")}`);
  };
  add(labels.breaking, parsed.filter((p) => p.breaking).map((p) => p.text));
  add(labels.feat, parsed.filter((p) => !p.breaking && p.group === "feat").map((p) => p.text));
  add(labels.fix, parsed.filter((p) => !p.breaking && p.group === "fix").map((p) => p.text));
  add(labels.other, parsed.filter((p) => !p.breaking && p.group === "other").map((p) => p.text));
  return sections.join("\n\n") + "\n";
}

/** Version suivante d'un tag (`v1.2.3` → patch `v1.2.4`, minor `v1.3.0`, major `v2.0.0`),
 *  préfixe et suffixe gardés ; `null` si le tag n'a pas de numéro x.y.z. */
export function bumpVersion(tag: string, level: "patch" | "minor" | "major"): string | null {
  const m = /^(.*?)(\d+)\.(\d+)\.(\d+)(.*)$/.exec(tag);
  if (!m) return null;
  const [, pre, a, b, c] = m;
  const [x, y, z] = [Number(a), Number(b), Number(c)];
  const next = level === "major" ? [x + 1, 0, 0] : level === "minor" ? [x, y + 1, 0] : [x, y, z + 1];
  return `${pre}${next.join(".")}`;
}

/** Numéro x.y.z d'un tag, pour les comparer. */
function versionOf(tag: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Nom proposé pour un nouveau tag : la version patch suivante du plus haut numéro (`v0.3.1`
 *  → `v0.3.2`), `null` sans tag numéroté. */
export function nextTagName(tags: string[]): string | null {
  let best: { tag: string; v: [number, number, number] } | null = null;
  for (const tag of tags) {
    const v = versionOf(tag);
    if (!v) continue;
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) best = { tag, v };
  }
  return best ? bumpVersion(best.tag, "patch") : null;
}
