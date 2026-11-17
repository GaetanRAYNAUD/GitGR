// Backend simulé des PR / MR ouvertes (navigateur seulement) : trois PR / MR par dépôt, avec
// relectures, fils et checks ; les actions modifient l'état gardé en mémoire.

import { mockDetails, mockDiff, mockHistory } from "./mockHistory";
import type { FileChange, FileDiff, MergeBlocker, Person, ProviderKind, PullAction, PullDetail, PullList, PullSummary } from "./types";

const person = (login: string, name: string, id: number): Person => ({ id, login, name, avatar: `mock:${login}` });
const CAMILLE = person("camille.dupont", "Camille Dupont", 7);
const MAX = person("max", "Max Martin", 9);
const ZOE = person("zoe", "Zoé Leroy", 10);
/** Compte du backend simulé (cf. connectAccount) : celui dont on montre « les miennes ». */
const ME_GITHUB = person("octo-demo", "Octo Démo", 1);

const store = new Map<string, PullDetail[]>();
/** Actions reçues (lues par les tests e2e via `window`). */
export const mockPullActions: { number: number; action: PullAction }[] = [];

const now = () => Math.floor(Date.now() / 1000);

function headOf(path: string, branch: string): string | null {
  return mockHistory(path).refs.refs.find((r) => r.short === `origin/${branch}`)?.target ?? null;
}

function seed(path: string, kind: ProviderKind, url: string, repo: string): PullDetail[] {
  const me = kind === "github" ? ME_GITHUB : CAMILLE;
  const t = now();
  const base = (n: number, over: Partial<PullDetail>): PullDetail => ({
    number: n,
    title: "",
    url: `${url}/${repo}/${kind === "github" ? "pull" : "-/merge_requests"}/${n}`,
    state: "open",
    author: me,
    sourceBranch: "",
    fork: false,
    targetBranch: "main",
    headSha: null,
    createdAt: t - 86400 * 2,
    updatedAt: t - 3600,
    review: null,
    checks: null,
    reviewers: [],
    assignees: [],
    labels: [],
    body: "",
    reviews: [],
    threads: [],
    checksList: [],
    merge: { canMerge: false, blockers: [], methods: kind === "github" ? ["merge", "squash", "rebase"] : ["merge", "squash"], deleteBranch: true, autoMerge: false },
    canUpdate: true,
    ...over,
  });
  return [
    base(12, {
      title: "Rendu du graphe sur canvas",
      sourceBranch: "feature/graph-rendering",
      headSha: headOf(path, "feature/graph-rendering"),
      review: "required",
      checks: "pending",
      reviewers: [MAX],
      labels: [{ name: "enhancement", color: "a2eeef" }],
      body: "Dessine le graphe sur un canvas limité à la zone visible.\n\n- lanes stables\n- 8 couleurs",
      reviews: [{ author: MAX, state: "pending", at: null }],
      threads: [
        { id: "t1", resolvable: false, resolved: false, replyable: false, path: null, line: null, comments: [{ id: "c1", author: ZOE, body: "Super, j'ai hâte !", at: t - 7200 }] },
        {
          id: "t2",
          resolvable: true,
          resolved: false,
          replyable: true,
          path: "src/lib/graph.ts",
          line: 42,
          comments: [{ id: "c2", author: MAX, body: "Pourquoi 8 couleurs et pas 10 ?", at: t - 5400 }],
        },
      ],
      checksList: [
        { name: "build", state: "success", url: "https://ci.exemple.fr/1" },
        { name: "test e2e", state: "pending", url: "https://ci.exemple.fr/2" },
      ],
      merge: { canMerge: false, blockers: ["approvals", "checks_pending"], methods: kind === "github" ? ["merge", "squash", "rebase"] : ["merge", "squash"], deleteBranch: true, autoMerge: false },
    }),
    base(13, {
      title: "Corriger la phrase de passe de l'agent SSH",
      author: MAX,
      sourceBranch: "fix/ssh-agent",
      headSha: headOf(path, "fix/ssh-agent"),
      review: "approved",
      checks: "success",
      reviewers: [me],
      assignees: [MAX],
      labels: [{ name: "bug", color: "d73a4a" }],
      body: "La phrase de passe était redemandée à chaque fetch.",
      reviews: [
        { author: me, state: "pending", at: null },
        { author: ZOE, state: "approved", at: t - 1800 },
      ],
      checksList: [{ name: "build", state: "success", url: null }],
      merge: { canMerge: true, blockers: [], methods: kind === "github" ? ["squash", "merge"] : ["merge", "squash"], deleteBranch: true, autoMerge: null },
    }),
    base(14, {
      title: "Traduction en espagnol",
      author: ZOE,
      state: "draft",
      sourceBranch: "es",
      fork: true,
      headSha: mockHistory(path).commits[40]?.sha ?? null,
      checks: "failure",
      checksList: [{ name: "lint", state: "failure", url: "https://ci.exemple.fr/3" }],
      merge: { canMerge: false, blockers: ["draft"], methods: ["merge"], deleteBranch: false, autoMerge: null },
      canUpdate: false,
    }),
  ];
}

function pullsOf(path: string, kind: ProviderKind, url: string, repo: string): PullDetail[] {
  const key = `${path}|${kind}|${url}|${repo.toLowerCase()}`;
  let list = store.get(key);
  if (!list) store.set(key, (list = seed(path, kind, url, repo)));
  return list;
}

/** Dernier dépôt dont les refs ont été lues : celui des PR / MR simulées (la vraie API n'a pas
 *  besoin du dossier). */
let lastPath = "";
export function mockPullsPath(path: string) {
  lastPath = path;
}

export function mockListPulls(kind: ProviderKind, url: string, repo: string): PullList {
  if (repo.includes("sans-pr")) return { pulls: [], fetchedAt: now(), truncated: false };
  const pulls: PullSummary[] = pullsOf(lastPath, kind, url, repo)
    .filter((p) => p.state === "open" || p.state === "draft")
    .map(({ body: _b, reviews: _r, threads: _t, checksList: _c, merge: _m, canUpdate: _u, ...s }) => s);
  return { pulls, fetchedAt: now(), truncated: false };
}

export function mockPullDetail(kind: ProviderKind, url: string, repo: string, number: number): PullDetail {
  const p = pullsOf(lastPath, kind, url, repo).find((x) => x.number === number);
  if (!p) throw "pull_not_found";
  return structuredClone(p);
}

export function mockPullAct(kind: ProviderKind, url: string, repo: string, number: number, action: PullAction) {
  const p = pullsOf(lastPath, kind, url, repo).find((x) => x.number === number);
  if (!p) throw "pull_not_found";
  mockPullActions.push({ number, action });
  const me = kind === "github" ? ME_GITHUB : CAMILLE;
  const t = now();
  const comment = (body: string) => ({ id: `c${Math.random()}`, author: me, body: body.trim(), at: t });
  const blockers = (b: MergeBlocker[]) => {
    p.merge = { ...p.merge, blockers: b, canMerge: b.length === 0 };
  };
  switch (action.type) {
    case "comment":
      if (!action.body.trim()) throw "comment_empty";
      p.threads.push({ id: `t${p.threads.length + 10}`, resolvable: false, resolved: false, replyable: kind === "gitlab", path: null, line: null, comments: [comment(action.body)] });
      break;
    case "reply": {
      const th = p.threads.find((x) => x.id === action.thread);
      if (!th) throw "thread_invalid";
      th.comments.push(comment(action.body));
      break;
    }
    case "resolve": {
      const th = p.threads.find((x) => x.id === action.thread);
      if (th) th.resolved = action.resolved;
      break;
    }
    case "review": {
      if (action.event === "approve" && p.author?.login === me.login) throw "review_own_pull";
      const state = action.event === "approve" ? "approved" : action.event === "changes" ? "changes" : "commented";
      const r = p.reviews.find((x) => x.author.login === me.login);
      if (r) r.state = state;
      else p.reviews.push({ author: me, state, at: t });
      if (action.body.trim()) p.threads.push({ id: `r${t}`, resolvable: false, resolved: false, replyable: false, path: null, line: null, comments: [comment(action.body)] });
      if (state === "approved") {
        p.review = "approved";
        blockers(p.merge.blockers.filter((b) => b !== "approvals" && b !== "changes"));
      } else if (state === "changes") p.review = "changes";
      break;
    }
    case "setOpen":
      p.state = action.open ? "open" : "closed";
      blockers(action.open ? [] : ["not_open"]);
      break;
    case "setDraft":
      p.state = action.draft ? "draft" : "open";
      blockers(action.draft ? ["draft", ...p.merge.blockers] : p.merge.blockers.filter((b) => b !== "draft"));
      break;
    case "merge":
      if (action.auto) {
        p.merge = { ...p.merge, autoMerge: true };
        break;
      }
      if (!p.merge.canMerge) throw "pull_not_mergeable";
      p.state = "merged";
      blockers(["not_open"]);
      break;
    case "updateBranch":
      blockers(p.merge.blockers.filter((b) => b !== "behind"));
      break;
    case "unapprove":
      break;
  }
  p.updatedAt = t;
}

export function mockPullFiles(path: string, head: string): FileChange[] {
  return mockDetails(path, head).files;
}

export function mockPullFileDiff(head: string, file: string): FileDiff {
  return mockDiff(head, file);
}

/** Oublie les PR / MR simulées (tests). */
export function resetMockPulls() {
  store.clear();
  mockPullActions.length = 0;
}
