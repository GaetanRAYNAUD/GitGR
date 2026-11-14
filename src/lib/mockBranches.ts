// Branches et réseau factices pour le backend simulé (navigateur, tests E2E) : modifient les
// refs de l'historique simulé (mockHistory) comme le ferait git, en restant simples.

import { mockHistory, mockNewCommit } from "./mockHistory";
import { mockChangeCount, mockRestore, mockSnapshot } from "./mockWorktree";
import { AUTOSTASH_PREFIX, validBranchName } from "./branchName";
import type { AutoStash, GitRef, OpResult, PullStrategy } from "./types";

const OK: OpResult = { stashed: false, stashKept: false, conflicts: false };

/** Piles de stash simulées, par dépôt (instantanés de la copie de travail). */
interface MockStash {
  sha: string;
  message: string;
  files: ReturnType<typeof mockSnapshot>;
}
const stashes = new Map<string, MockStash[]>();
let stashSeq = 0;

export function mockStashCount(path: string): number {
  return stashes.get(path)?.length ?? 0;
}

/** Dernier stash s'il vient de l'auto-stash (cf. `pending_autostash` côté Rust). */
export function mockAutostash(path: string): AutoStash | null {
  const top = stashes.get(path)?.[0];
  return top?.message.startsWith(AUTOSTASH_PREFIX) ? { sha: top.sha, message: top.message } : null;
}

export function mockStashPush(path: string, message: string) {
  const list = stashes.get(path) ?? [];
  stashSeq += 1;
  list.unshift({ sha: stashSeq.toString(16).padStart(40, "0"), message, files: mockSnapshot(path) });
  stashes.set(path, list);
  mockRestore(path, []);
}

export function mockStashPop(path: string): OpResult {
  const list = stashes.get(path);
  if (!list?.length) throw "no_stash";
  if (mockChangeCount(path) > 0) throw "stash_would_overwrite";
  mockRestore(path, list.shift()!.files);
  return OK;
}

/** Remplace les refs (nouvel objet : l'empreinte change, le graphe se recharge). */
function setRefs(path: string, refs: GitRef[], head: string | null, headBranch: string | null) {
  const h = mockHistory(path);
  h.refs = { head, headBranch, refs, stashes: mockStashCount(path), autostash: mockAutostash(path) };
}

const local = (path: string, name: string) => mockHistory(path).refs.refs.find((r) => r.kind === "local" && r.short === name);
const remote = (path: string, name: string) => mockHistory(path).refs.refs.find((r) => r.kind === "remote" && r.short === name);

function makeRef(kind: "local" | "remote", short: string, target: string, extra: Partial<GitRef> = {}): GitRef {
  return {
    name: kind === "local" ? `refs/heads/${short}` : `refs/remotes/${short}`,
    short,
    kind,
    target,
    upstream: null,
    ahead: 0,
    behind: 0,
    gone: false,
    ...extra,
  };
}

/** Ancêtres de `sha` (lui compris), d'après l'historique simulé. */
function ancestors(path: string, sha: string | null): Set<string> {
  const byId = new Map(mockHistory(path).commits.map((c) => [c.sha, c]));
  const seen = new Set<string>();
  const todo = sha ? [sha] : [];
  while (todo.length) {
    const s = todo.pop()!;
    if (seen.has(s)) continue;
    seen.add(s);
    todo.push(...(byId.get(s)?.parents ?? []));
  }
  return seen;
}

/** Auto-stash simulé : les modifications « suivent » le changement de branche. */
const stashResult = (path: string, autoStash: boolean): OpResult => ({ ...OK, stashed: autoStash && mockChangeCount(path) > 0 });

function moveHead(path: string, branch: string | null, target: string) {
  setRefs(path, mockHistory(path).refs.refs, target, branch);
}

export function mockCheckout(path: string, branch: string, autoStash: boolean): OpResult {
  const r = local(path, branch);
  if (!r) throw "branch_not_found";
  if (mockHistory(path).refs.headBranch === branch) return OK;
  const res = stashResult(path, autoStash);
  moveHead(path, branch, r.target);
  return res;
}

export function mockCheckoutRemote(path: string, branch: string, autoStash: boolean): [OpResult, string] {
  const r = remote(path, branch);
  if (!r) throw "branch_not_found";
  const name = branch.slice(branch.indexOf("/") + 1);
  if (local(path, name)) return [mockCheckout(path, name, autoStash), name];
  const res = stashResult(path, autoStash);
  setRefs(path, [makeRef("local", name, r.target, { upstream: branch }), ...mockHistory(path).refs.refs], r.target, name);
  return [res, name];
}

export function mockCheckoutDetached(path: string, sha: string, autoStash: boolean): OpResult {
  if (!mockHistory(path).commits.some((c) => c.sha === sha)) throw "invalid_start_point";
  const res = stashResult(path, autoStash);
  moveHead(path, null, sha);
  return res;
}

export function mockCreateBranch(path: string, name: string, start: string | null, checkout: boolean, autoStash: boolean): OpResult {
  if (!validBranchName(name)) throw "invalid_branch_name";
  if (local(path, name)) throw "branch_exists";
  const h = mockHistory(path);
  const target = start ? (h.refs.refs.find((r) => r.short === start || r.name === start)?.target ?? start) : h.refs.head;
  if (!target || !h.commits.some((c) => c.sha === target)) throw "invalid_start_point";
  const refs = [...h.refs.refs, makeRef("local", name, target)];
  if (!checkout) {
    setRefs(path, refs, h.refs.head, h.refs.headBranch);
    return OK;
  }
  const res = stashResult(path, autoStash);
  setRefs(path, refs, target, name);
  return res;
}

export function mockRenameBranch(path: string, old: string, next: string) {
  if (!local(path, old)) throw "branch_not_found";
  if (!validBranchName(next)) throw "invalid_branch_name";
  if (old === next) return;
  if (local(path, next)) throw "branch_exists";
  const h = mockHistory(path);
  const refs = h.refs.refs.map((r) => (r.kind === "local" && r.short === old ? { ...r, short: next, name: `refs/heads/${next}` } : r));
  setRefs(path, refs, h.refs.head, h.refs.headBranch === old ? next : h.refs.headBranch);
}

export function mockDeleteBranch(path: string, branch: string, force: boolean) {
  const r = local(path, branch);
  if (!r) throw "branch_not_found";
  const h = mockHistory(path);
  if (h.refs.headBranch === branch) throw "branch_is_current";
  if (!force && !ancestors(path, h.refs.head).has(r.target)) throw "branch_not_merged";
  setRefs(path, h.refs.refs.filter((x) => x !== r), h.refs.head, h.refs.headBranch);
}

export function mockDeleteRemoteBranch(path: string, branch: string) {
  const r = remote(path, branch);
  if (!r) throw "branch_not_found";
  const h = mockHistory(path);
  const refs = h.refs.refs
    .filter((x) => x !== r)
    .map((x) => (x.upstream === branch ? { ...x, gone: true, ahead: 0, behind: 0 } : x));
  setRefs(path, refs, h.refs.head, h.refs.headBranch);
}

/** Branche courante et sa distante ; erreurs comme git. */
function tracked(path: string) {
  const h = mockHistory(path);
  if (!h.refs.headBranch) throw "detached_head";
  const l = local(path, h.refs.headBranch)!;
  const up = l.upstream && !l.gone ? remote(path, l.upstream) : undefined;
  return { h, l, up };
}

export function mockPull(path: string, strategy: PullStrategy, autoStash: boolean): OpResult {
  const { h, l, up } = tracked(path);
  if (!up) throw "no_upstream";
  if (l.behind === 0) return OK;
  const res = stashResult(path, autoStash);
  let target = up.target;
  if (l.ahead > 0) {
    if (strategy === "ff-only") throw "not_fast_forward";
    const subject = strategy === "merge" ? `Merge branch '${up.short}' into ${l.short}` : "fix: correctif local (rebasé)";
    target = mockNewCommit(path, strategy === "merge" ? [l.target, up.target] : [up.target], subject);
  }
  const ahead = strategy === "merge" && l.ahead > 0 ? l.ahead + 1 : l.ahead;
  const refs = h.refs.refs.map((r) => (r === l ? { ...r, target, ahead, behind: 0 } : r));
  setRefs(path, refs, target, l.short);
  return res;
}

export function mockPush(path: string, force: boolean) {
  const { h, l, up } = tracked(path);
  if (up && l.behind > 0 && !force) throw "push_rejected";
  const name = up?.short ?? `origin/${l.short}`;
  const others = h.refs.refs.filter((r) => r !== up).map((r) => (r === l ? { ...r, upstream: name, ahead: 0, behind: 0, gone: false } : r));
  setRefs(path, [...others, makeRef("remote", name, l.target)], h.refs.head, h.refs.headBranch);
}

/** Tests : repart de piles de stash vides. */
export function resetMockBranches() {
  stashes.clear();
}
