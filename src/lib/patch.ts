// Diff au format patch (unifié, comme `git diff`) : un bloc, des lignes ou le fichier entier,
// pour le presse-papiers. Fonctions pures (testées dans patch.test.ts), et la copie annoncée.

import type { TFunction } from "i18next";
import { useApp } from "../store/app";
import type { FileDiff, Hunk, LineRef } from "./types";

/** Le fichier d'un diff : chemins et état (A = ajouté, D = supprimé, R = renommé…). */
export interface PatchFile {
  path: string;
  oldPath: string | null;
  status: string;
}

const NO_EOL = "\ No newline at end of file";

function hunkLines(h: Hunk): string[] {
  const out = [h.header];
  for (const l of h.lines) {
    out.push(l.kind + l.text);
    if (l.noEol) out.push(NO_EOL);
  }
  return out;
}

/** En-tête de fichier d'un patch (`diff --git`, `---`, `+++`), applicable par `git apply`. */
function fileHeader(f: PatchFile): string[] {
  const from = f.oldPath ?? f.path;
  const out = [`diff --git a/${from} b/${f.path}`];
  if (f.status === "A" || f.status === "?") out.push("new file mode 100644");
  if (f.status === "D") out.push("deleted file mode 100644");
  if (f.oldPath && f.oldPath !== f.path) out.push(`rename from ${f.oldPath}`, `rename to ${f.path}`);
  out.push(f.status === "A" || f.status === "?" ? "--- /dev/null" : `--- a/${from}`);
  out.push(f.status === "D" ? "+++ /dev/null" : `+++ b/${f.path}`);
  return out;
}

/** Le fichier entier, ou seulement les blocs `only` (indices). */
export function filePatch(f: PatchFile, diff: FileDiff, only?: number[]): string {
  const hunks = only ? only.map((i) => diff.hunks[i]).filter(Boolean) : diff.hunks;
  return [...fileHeader(f), ...hunks.flatMap(hunkLines)].join("\n") + "\n";
}

/** Lignes choisies, préfixées (`+`, `-`, ` `) dans l'ordre du diff, sans en-tête. */
export function linesPatch(diff: FileDiff, refs: LineRef[]): string {
  const sorted = [...refs].sort((a, b) => a.hunk - b.hunk || a.line - b.line);
  const out: string[] = [];
  for (const r of sorted) {
    const l = diff.hunks[r.hunk]?.lines[r.line];
    if (!l) continue;
    out.push(l.kind + l.text);
    if (l.noEol) out.push(NO_EOL);
  }
  return out.join("\n") + "\n";
}

/** Copie un patch dans le presse-papiers et l'annonce (ou dit l'échec). */
export async function copyPatch(t: TFunction, text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    useApp.getState().notify(done);
  } catch {
    useApp.getState().notify(t("patch.copyFailed"));
  }
}
