// Copie de travail factice pour le backend simulé (navigateur, tests E2E).
// Chaque fichier a éventuellement un côté « indexé » et un côté « non indexé », chacun
// réduit à une liste de lignes de diff ; indexer des lignes les déplace d'un côté à l'autre.

import type { ConflictSides, ConflictVersions, DiffLine, FileDiff, LineRef, StatusFile, WorkFileStatus, WorkStatus } from "./types";
import { parseConflicts } from "./conflicts";

interface Side {
  status: WorkFileStatus;
  lines: DiffLine[];
}

export interface MockFile {
  path: string;
  staged?: Side;
  unstaged?: Side;
}

const repos = new Map<string, MockFile[]>();

const ctx = (n: number, text: string): DiffLine => ({ kind: " ", old: n, new: n, text });
const add = (n: number, text: string): DiffLine => ({ kind: "+", old: null, new: n, text });
const del = (n: number, text: string): DiffLine => ({ kind: "-", old: n, new: null, text });

function initial(path: string): MockFile[] {
  // Même règle qu'avant : certains dépôts simulés sont propres (GitGR), d'autres non.
  if (path.length % 4 === 0) return [];
  return [
    {
      path: "src/graph/render.ts",
      unstaged: {
        status: "M",
        lines: [
          ctx(10, "export function render(rows: Row[]) {"),
          del(11, "  const height = rows.length * 34;"),
          add(11, "  const height = rows.length * ROW_H;"),
          add(12, "  const width = lanes * LANE_W;"),
          ctx(12, "  canvas.height = height;"),
          ctx(13, "}"),
        ],
      },
    },
    {
      path: "src-tauri/src/git/log.rs",
      staged: { status: "M", lines: [ctx(3, "pub fn log() {"), add(4, "    // pagination"), ctx(4, "}")] },
      unstaged: { status: "M", lines: [ctx(8, "fn parse() {"), del(9, "    todo!()"), add(9, "    vec![]"), ctx(10, "}")] },
    },
    { path: "src/graph/lanes.ts", staged: { status: "A", lines: [add(1, "export const LANE_W = 14;"), add(2, "")] } },
    { path: "notes.txt", unstaged: { status: "?", lines: [add(1, "idées pour la suite"), add(2, "- recherche")] } },
  ];
}

function files(path: string): MockFile[] {
  let f = repos.get(path);
  if (!f) repos.set(path, (f = initial(path)));
  return f;
}

const changed = (s?: Side) => !!s && s.lines.some((l) => l.kind !== " ");
const prune = (path: string) => repos.set(path, files(path).filter((f) => changed(f.staged) || changed(f.unstaged)));
const entry = (f: MockFile, s: Side): StatusFile => ({ path: f.path, oldPath: null, status: s.status });

/** Fichiers en conflit simulés (texte avec les marqueurs, et au besoin les trois versions),
 *  posés par les tests e2e (`window.__mockConflict`). */
const conflicts = new Map<string, Map<string, { text: string; versions?: Omit<ConflictVersions, "working"> }>>();

export function mockAddConflict(path: string, file: string, text: string, versions?: Omit<ConflictVersions, "working">) {
  if (!conflicts.has(path)) conflicts.set(path, new Map());
  conflicts.get(path)!.set(file, { text, versions });
}

/** Les versions données, sinon tirées des marqueurs : parties communes, plus le côté voulu
 *  de chaque bloc (version commune : celle du bloc en diff3, sinon aucune). */
export function mockConflictVersions(path: string, file: string): ConflictVersions {
  const c = conflicts.get(path)?.get(file);
  if (c === undefined) throw "conflict_no_file";
  // Conventions des tests : une image est binaire, « supprime » dans le nom = supprimé d'un côté.
  if (file.endsWith(".png")) throw "conflict_binary";
  if (file.includes("supprime")) throw "conflict_deleted";
  if (c.versions) return { ...c.versions, working: c.text };
  const parsed = parseConflicts(c.text);
  const side = (k: "ours" | "theirs" | "base") =>
    parsed.segments.flatMap((s) => (s.kind === "common" ? s.lines : (s[k] ?? []))).map((l) => `${l}\n`).join("");
  const diff3 = parsed.segments.some((s) => s.kind === "conflict" && s.base !== null);
  return { base: diff3 ? side("base") : null, ours: side("ours"), theirs: side("theirs"), working: c.text };
}

export function mockConflictSides(path: string, file: string): ConflictSides {
  if (!conflicts.get(path)?.has(file)) throw "not_conflicted";
  if (file.includes("supprime")) return { base: 40, ours: 52, theirs: null };
  return { base: 1000, ours: 1200, theirs: 1850 };
}

export function mockResolveConflictWith(path: string, file: string, choice: "ours" | "theirs" | "delete") {
  const sides = mockConflictSides(path, file);
  conflicts.get(path)?.delete(file);
  const kept = choice === "ours" ? sides.ours : choice === "theirs" ? sides.theirs : null;
  files(path).push({ path: file, staged: { status: kept === null ? "D" : "M", lines: [add(1, `version ${choice}`)] } });
}

/** Résolution écrite : le fichier n'est plus en conflit, il est indexé avec ce contenu. */
export function mockResolveConflict(path: string, file: string, content: string) {
  conflicts.get(path)?.delete(file);
  files(path).push({ path: file, staged: { status: "M", lines: content.split("\n").filter(Boolean).map((l, i) => add(i + 1, l)) } });
}

export function mockStatus(path: string): WorkStatus {
  const fs = files(path);
  const conflicted = [...(conflicts.get(path)?.keys() ?? [])];
  return {
    staged: fs.filter((f) => changed(f.staged)).map((f) => entry(f, f.staged!)),
    unstaged: fs.filter((f) => changed(f.unstaged)).map((f) => entry(f, f.unstaged!)),
    conflicted: conflicted.map((p) => ({ path: p, oldPath: null, status: "U" })),
    operation: conflicted.length ? "merge" : null,
    mergeMessage: null,
  };
}

/** Nombre de fichiers modifiés (pour le résumé). */
export function mockChangeCount(path: string): number {
  return files(path).length;
}

export function mockWorkDiff(path: string, file: string, area: string): FileDiff {
  const f = files(path).find((x) => x.path === file);
  const side = area === "staged" ? f?.staged : f?.unstaged;
  if (!side) return { binary: false, truncated: false, hunks: [], fingerprint: "vide" };
  const first = side.lines[0];
  const start = first?.old ?? first?.new ?? 1;
  return {
    binary: false,
    truncated: false,
    hunks: [{ header: `@@ -${start} +${start} @@`, lines: side.lines }],
    fingerprint: JSON.stringify(side.lines).length.toString(16),
  };
}

function move(path: string, file: string, from: "staged" | "unstaged", lines: LineRef[] | "all") {
  const f = files(path).find((x) => x.path === file);
  const src = f?.[from];
  if (!f || !src) return;
  const to = from === "staged" ? "unstaged" : "staged";
  const pick = (i: number) => lines === "all" || lines.some((r) => r.hunk === 0 && r.line === i);
  const moved = src.lines.filter((l, i) => l.kind !== " " && pick(i));
  src.lines = src.lines.filter((l, i) => l.kind === " " || !pick(i));
  if (moved.length) {
    const status = from === "unstaged" && src.status === "?" ? "A" : to === "unstaged" && src.status === "A" ? "?" : src.status;
    const dst = (f[to] ??= { status, lines: [] });
    dst.lines = [...dst.lines, ...moved];
  }
  prune(path);
}

export function mockStage(path: string, paths: string[], unstage: boolean) {
  for (const p of paths) move(path, p, unstage ? "staged" : "unstaged", "all");
}

export function mockStageAll(path: string, unstage: boolean) {
  mockStage(path, files(path).map((f) => f.path), unstage);
}

export function mockStageLines(path: string, file: string, lines: LineRef[], unstage: boolean) {
  move(path, file, unstage ? "staged" : "unstaged", lines);
}

export function mockDiscard(path: string, paths: string[], lines?: LineRef[]) {
  for (const p of paths) {
    const f = files(path).find((x) => x.path === p);
    if (!f?.unstaged) continue;
    if (lines) f.unstaged.lines = f.unstaged.lines.filter((l, i) => l.kind === " " || !lines.some((r) => r.line === i));
    else f.unstaged = undefined;
  }
  prune(path);
}

export function mockDiscardAll(path: string) {
  repos.set(path, []);
}

/** Commit simulé : vide l'index. Faux s'il n'y a rien à commiter. */
export function mockCommitIndex(path: string, amend: boolean): boolean {
  const fs = files(path);
  if (!amend && !fs.some((f) => changed(f.staged))) return false;
  for (const f of fs) f.staged = undefined;
  prune(path);
  return true;
}

/** Copie de la copie de travail (stash simulé). */
export function mockSnapshot(path: string): MockFile[] {
  return structuredClone(files(path));
}

/** Remplace la copie de travail (vide : tout est mis de côté). */
export function mockRestore(path: string, snapshot: MockFile[]) {
  repos.set(path, structuredClone(snapshot));
}

/** Tests : repart des copies de travail initiales. */
export function resetMockWorktree() {
  repos.clear();
}
