// Plan d'un rebase interactif (fonctions pures, testées dans rebasePlan.test.ts) : lignes
// réordonnées, actions, ce qui empêche de lancer, résumé.

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export const ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

/** Touche de chaque action (comme dans la liste de `git rebase -i`). */
export const ACTION_KEYS: Record<string, RebaseAction> = { p: "pick", r: "reword", s: "squash", f: "fixup", d: "drop" };

export interface PlanRow {
  sha: string;
  subject: string;
  /** Message d'origine. */
  original: string;
  action: RebaseAction;
  /** Nouveau message (`reword`). */
  message: string;
  pushed: boolean;
  /** Date du commit (secondes Unix). */
  time: number;
}

/** Déplace la ligne `from` en position `to`. */
export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= rows.length) return rows;
  const out = rows.slice();
  const [r] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, r);
  return out;
}

/** Raison pour laquelle le plan ne peut pas être lancé (clé i18n), `null` s'il peut l'être. */
export function planProblem(rows: PlanRow[], original: string[]): string | null {
  if (!rows.some((r) => r.action !== "drop")) return "rebase.why.allDropped";
  const first = rows.findIndex((r) => r.action !== "drop");
  if (rows[first].action === "squash" || rows[first].action === "fixup") return "rebase.why.squashFirst";
  if (rows.some((r) => r.action === "reword" && !r.message.trim())) return "rebase.why.emptyMessage";
  if (!changed(rows, original)) return "rebase.why.nothing";
  return null;
}

/** Le plan change-t-il quelque chose (ordre, action, message) ? */
export function changed(rows: PlanRow[], original: string[]): boolean {
  return rows.some((r, i) => r.sha !== original[i] || r.action !== "pick");
}

/** Des commits déjà poussés seront-ils réécrits ? Tout commit après le premier changement
 *  (dans l'ordre d'origine) change de SHA. */
export function rewritesPushed(rows: PlanRow[], original: string[]): boolean {
  const firstChange = rows.findIndex((r, i) => r.sha !== original[i] || r.action !== "pick");
  if (firstChange < 0) return false;
  const touched = new Set(original.slice(firstChange));
  return rows.some((r) => r.pushed && touched.has(r.sha));
}

/** Compteurs pour le résumé : renommés, réunis, retirés, déplacés. */
export function summary(rows: PlanRow[], original: string[]) {
  return {
    reword: rows.filter((r) => r.action === "reword").length,
    squash: rows.filter((r) => r.action === "squash" || r.action === "fixup").length,
    drop: rows.filter((r) => r.action === "drop").length,
    moved: rows.filter((r, i) => r.sha !== original[i]).length,
  };
}
