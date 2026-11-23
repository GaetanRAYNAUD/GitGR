// Branches et réseau factices pour le backend simulé (navigateur, tests E2E) : modifient les
// refs de l'historique simulé (mockHistory) comme le ferait git, en restant simples.

import { mockHistory, mockNewCommit } from "./mockHistory";
import { mockChangeCount, mockRestore, mockSnapshot } from "./mockWorktree";
import { AUTOSTASH_PREFIX, validBranchName, validRemoteName } from "./branchName";
import type { AutoStash, GitRef, OpResult, PullStrategy, RemoteInfo, StashEntry } from "./types";

const OK: OpResult = { stashed: false, stashKept: false, conflicts: false };

/** Piles de stash simulées, par dépôt (instantanés de la copie de travail). */
interface MockStash {
  sha: string;
  message: string;
  base: string;
  time: number;
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
  const h = mockHistory(path).refs;
  list.unshift({ sha: stashSeq.toString(16).padStart(40, "0"), message, base: h.head ?? "", time: Math.floor(Date.now() / 1000), files: mockSnapshot(path) });
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

export function mockListStashes(path: string): StashEntry[] {
  const branch = mockHistory(path).refs.headBranch ?? "HEAD";
  return (stashes.get(path) ?? []).map(({ sha, message, base, time }) => ({ sha, base, time, message: `On ${branch}: ${message}` }));
}

export function mockStashApply(path: string, sha: string, drop: boolean): OpResult {
  const list = stashes.get(path) ?? [];
  const i = list.findIndex((s) => s.sha === sha);
  if (i < 0) throw "stash_missing";
  if (mockChangeCount(path) > 0) throw "stash_would_overwrite";
  mockRestore(path, list[i].files);
  if (drop) list.splice(i, 1);
  touchRefs(path);
  return OK;
}

export function mockStashDrop(path: string, sha: string) {
  const list = stashes.get(path) ?? [];
  const i = list.findIndex((s) => s.sha === sha);
  if (i < 0) throw "stash_missing";
  list.splice(i, 1);
  touchRefs(path);
}

/** Nouvel objet refs (nombre de stashes à jour) : l'empreinte change, la barre latérale relit. */
function touchRefs(path: string) {
  const h = mockHistory(path);
  h.refs = { ...h.refs, stashes: mockStashCount(path), autostash: mockAutostash(path) };
}

/** Remplace les refs (nouvel objet : l'empreinte change, le graphe se recharge). */
function setRefs(path: string, refs: GitRef[], head: string | null, headBranch: string | null) {
  const h = mockHistory(path);
  h.refs = { ...h.refs, head, headBranch, refs, stashes: mockStashCount(path), autostash: mockAutostash(path) };
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

/** Tire `remoteName/branch` dans la branche courante, sans toucher à la branche suivie. */
export function mockPullFrom(path: string, remoteName: string, branch: string, strategy: PullStrategy, autoStash: boolean): OpResult {
  const { h, l } = tracked(path);
  if (!h.refs.remotes.some((r) => r.name === remoteName)) throw "remote_not_found";
  const source = remote(path, `${remoteName}/${branch}`);
  if (!source) throw "remote_ref_not_found";
  if (ancestors(path, l.target).has(source.target)) return OK;
  const res = stashResult(path, autoStash);
  let target = source.target;
  if (!ancestors(path, source.target).has(l.target)) {
    if (strategy === "ff-only") throw "not_fast_forward";
    const subject = strategy === "merge" ? `Merge branch '${branch}' of ${remoteName} into ${l.short}` : "fix: correctif local (rebasé)";
    target = mockNewCommit(path, strategy === "merge" ? [l.target, source.target] : [source.target], subject);
  }
  setRefs(path, h.refs.refs.map((r) => (r === l ? { ...r, target } : r)), target, l.short);
  return res;
}

/** `to` : remote choisi ; `null` : celui de la branche suivie, sinon `origin`. */
export function mockPush(path: string, force: boolean, to: string | null = null) {
  const { h, l, up } = tracked(path);
  if (to && !h.refs.remotes.some((r) => r.name === to)) throw "remote_not_found";
  const upstreamRemote = up?.short.slice(0, up.short.indexOf("/"));
  // Vers un autre remote que celui de la branche suivie : la branche du même nom, sans changer le suivi.
  if (to && up && to !== upstreamRemote) {
    const name = `${to}/${l.short}`;
    const there = remote(path, name);
    if (there && !force && !ancestors(path, l.target).has(there.target)) throw "push_rejected";
    setRefs(path, [...h.refs.refs.filter((r) => r !== there), makeRef("remote", name, l.target)], h.refs.head, h.refs.headBranch);
    return;
  }
  if (up && l.behind > 0 && !force) throw "push_rejected";
  const name = up?.short ?? `${to ?? "origin"}/${l.short}`;
  const others = h.refs.refs.filter((r) => r !== up).map((r) => (r === l ? { ...r, upstream: name, ahead: 0, behind: 0, gone: false } : r));
  setRefs(path, [...others, makeRef("remote", name, l.target)], h.refs.head, h.refs.headBranch);
}

// --- Remotes -------------------------------------------------------------------

const sortRemotes = (list: RemoteInfo[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

function setRemotes(path: string, remotes: RemoteInfo[], refs = mockHistory(path).refs.refs) {
  const h = mockHistory(path);
  h.refs = { ...h.refs, refs, remotes: sortRemotes(remotes) };
}

export function mockAddRemote(path: string, name: string, url: string) {
  const { remotes } = mockHistory(path).refs;
  if (!validRemoteName(name)) throw "invalid_remote_name";
  if (!url.trim()) throw "invalid_remote_url";
  if (remotes.some((r) => r.name === name)) throw "remote_exists";
  setRemotes(path, [...remotes, { name, url, pushUrl: null }]);
}

export function mockRenameRemote(path: string, old: string, next: string) {
  const { remotes, refs } = mockHistory(path).refs;
  if (!remotes.some((r) => r.name === old)) throw "remote_not_found";
  if (!validRemoteName(next)) throw "invalid_remote_name";
  if (old === next) return;
  if (remotes.some((r) => r.name === next)) throw "remote_exists";
  const moved = (short: string) => `${next}/${short.slice(old.length + 1)}`;
  setRemotes(
    path,
    remotes.map((r) => (r.name === old ? { ...r, name: next } : r)),
    refs.map((r) => {
      if (r.kind === "remote" && r.short.startsWith(`${old}/`)) return { ...r, short: moved(r.short), name: `refs/remotes/${moved(r.short)}` };
      return r.upstream?.startsWith(`${old}/`) ? { ...r, upstream: moved(r.upstream) } : r;
    }),
  );
}

export function mockSetRemoteUrl(path: string, name: string, url: string) {
  const { remotes } = mockHistory(path).refs;
  if (!remotes.some((r) => r.name === name)) throw "remote_not_found";
  if (!url.trim()) throw "invalid_remote_url";
  setRemotes(path, remotes.map((r) => (r.name === name ? { ...r, url } : r)));
}

export function mockRemoveRemote(path: string, name: string) {
  const { remotes, refs } = mockHistory(path).refs;
  if (!remotes.some((r) => r.name === name)) throw "remote_not_found";
  setRemotes(
    path,
    remotes.filter((r) => r.name !== name),
    refs
      .filter((r) => !(r.kind === "remote" && r.short.startsWith(`${name}/`)))
      .map((r) => (r.upstream?.startsWith(`${name}/`) ? { ...r, upstream: null, ahead: 0, behind: 0, gone: false } : r)),
  );
}

/** Tests : repart de piles de stash vides. */
export function resetMockBranches() {
  stashes.clear();
}
