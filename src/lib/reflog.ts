// Libellés du reflog : l'opération Git (`commit (amend)`, `rebase (finish)`, `merge main`…) en
// un mot traduit, et les messages fixes de Git (`moving from a to b`…) remis en phrase. Ce qui
// n'est pas reconnu reste tel que Git l'écrit.

/** Opération reconnue : clé de traduction sous `reflog.op`. */
export type ReflogOp =
  | "commit"
  | "amend"
  | "initial"
  | "commitMerge"
  | "checkout"
  | "reset"
  | "rebase"
  | "rebaseEnd"
  | "merge"
  | "pull"
  | "cherryPick"
  | "revert"
  | "branch"
  | "clone"
  | "push"
  | "fetch"
  | "rename";

export function reflogOp(action: string): ReflogOp | null {
  const a = action.trim();
  if (a === "commit") return "commit";
  if (a === "commit (amend)") return "amend";
  if (a === "commit (initial)") return "initial";
  if (a === "commit (merge)") return "commitMerge";
  if (a === "checkout") return "checkout";
  if (a === "reset") return "reset";
  if (/^rebase( -i| --interactive)? \((finish|abort)\)$/.test(a)) return "rebaseEnd";
  if (/^rebase\b/.test(a)) return "rebase";
  if (/^pull\b/.test(a)) return "pull";
  if (/^merge\b/.test(a)) return "merge";
  if (a === "cherry-pick") return "cherryPick";
  if (a === "revert") return "revert";
  if (a === "branch") return "branch";
  if (a === "Branch") return "rename";
  if (/^clone\b/.test(a)) return "clone";
  if (a === "update by push") return "push";
  if (/^fetch\b/.test(a)) return "fetch";
  return null;
}

/** Message fixe de Git reconnu : clé sous `reflog.msg` et ses valeurs. */
export type ReflogMsg = { key: string; vars: Record<string, string> };

const short = (ref: string) => ref.replace(/^refs\/(heads|remotes|tags)\//, "");

export function reflogMessage(message: string): ReflogMsg | null {
  let m = /^moving from (.+) to (.+)$/.exec(message);
  if (m) return { key: "moving", vars: { from: short(m[1]), to: short(m[2]) } };
  m = /^moving to (.+)$/.exec(message);
  if (m) return { key: "movingTo", vars: { to: short(m[1]) } };
  m = /^returning to (.+)$/.exec(message);
  if (m) return { key: "returning", vars: { to: short(m[1]) } };
  m = /^Created from (.+)$/.exec(message);
  if (m) return { key: "created", vars: { from: short(m[1]) } };
  m = /^renamed (.+) to (.+)$/.exec(message);
  if (m) return { key: "renamed", vars: { from: short(m[1]), to: short(m[2]) } };
  if (message === "Fast-forward") return { key: "fastForward", vars: {} };
  m = /^Merge made by the '(.+)' strategy\.$/.exec(message);
  if (m) return { key: "mergeMade", vars: {} };
  return null;
}
