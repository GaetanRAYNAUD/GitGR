// Historique factice pour le backend simulé (navigateur, tests E2E).
// Déterministe : un même chemin de dépôt donne toujours le même historique.

import type { Commit, CommitDetails, FileChange, FileDiff, GitRef, RefsInfo, RemoteInfo } from "./types";

/** Petit générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function fakeSha(s: string): string {
  let out = "";
  for (let i = 0; out.length < 40; i++) out += hash(`${s}#${i}`).toString(16).padStart(8, "0");
  return out.slice(0, 40);
}

const AUTHORS = [
  ["Camille Dupont", "camille@exemple.fr"],
  ["Alex Martin", "alex@exemple.fr"],
  ["Sam Leroy", "sam@exemple.fr"],
] as const;

const SUBJECTS = [
  "feat(graph): calcul des lanes",
  "fix(ssh): chemin de clé contenant des espaces",
  "refactor: extraction du module de diff",
  "docs: mise à jour du README",
  "feat(profiles): sélecteur de profil",
  "test: dépôts temporaires pour le log",
  "chore: mise à jour des dépendances",
  "fix(ui): défilement de la liste des commits",
  "perf: rendu virtualisé des lignes",
  "feat(i18n): traductions anglaises",
];

export interface MockHistory {
  commits: Commit[];
  refs: RefsInfo;
}

const cache = new Map<string, MockHistory>();
/** Nombre de commits générés : assez pour tester le chargement par pages. */
export const MOCK_COMMIT_COUNT = 1200;

export function mockHistory(path: string): MockHistory {
  const hit = cache.get(path);
  if (hit) return hit;

  const rand = rng(hash(path));
  const oldestFirst: Commit[] = [];
  let time = Math.floor(Date.UTC(2026, 0, 1) / 1000);
  let n = 0;
  const make = (parents: string[], subject?: string): string => {
    n += 1;
    time += 600 + Math.floor(rand() * 7200);
    const [author, email] = AUTHORS[Math.floor(rand() * AUTHORS.length)];
    const sha = fakeSha(`${path}:${n}`);
    oldestFirst.push({ sha, parents, author, email, time, subject: subject ?? SUBJECTS[n % SUBJECTS.length] });
    return sha;
  };

  let main = make([], "chore: initialisation du dépôt");
  const tags: [string, string][] = [];
  let feature: string | null = null;
  let featureName = "";
  let branchNo = 0;
  while (n < MOCK_COMMIT_COUNT - 2) {
    if (!feature && rand() < 0.12) {
      branchNo += 1;
      featureName = `feature/sujet-${branchNo}`;
      feature = make([main], `feat: début de ${featureName}`);
    } else if (feature && rand() < 0.15) {
      main = make([main, feature], `Merge branch '${featureName}'`);
      feature = null;
    } else if (feature && rand() < 0.5) {
      feature = make([feature]);
    } else {
      main = make([main]);
    }
    if (n % 150 === 0) tags.push([`v0.${tags.length + 1}.0`, main]);
  }
  // Une branche en cours, non fusionnée, en tête d'historique.
  const wip = make([feature ?? main], "feat(graph): rendu canvas virtualisé");
  const originMain = main;
  main = make([main], "fix: correctif local pas encore poussé");
  // La branche courante et un tag sur le même commit (colonne Branche / tag à l'étroit).
  tags.push([`v0.${tags.length + 1}.0`, main]);

  const commits = oldestFirst.reverse();
  const ref = (kind: GitRef["kind"], short: string, target: string, extra: Partial<GitRef> = {}): GitRef => ({
    name: kind === "local" ? `refs/heads/${short}` : kind === "remote" ? `refs/remotes/${short}` : `refs/tags/${short}`,
    short,
    kind,
    target,
    upstream: null,
    ahead: 0,
    behind: 0,
    gone: false,
    ...extra,
  });
  const refs: GitRef[] = [
    ref("local", "main", main, { upstream: "origin/main", ahead: 1 }),
    ref("local", "feature/graph-rendering", wip, { upstream: "origin/feature/graph-rendering" }),
    ref("local", "feature/profils", commits[40].sha),
    ref("local", "fix/ssh-agent", commits[25].sha, { upstream: "origin/fix/ssh-agent", behind: 1 }),
    ref("remote", "origin/main", originMain),
    ref("remote", "origin/fix/ssh-agent", commits[24].sha),
    ref("remote", "origin/feature/graph-rendering", wip),
    ...tags.reverse().map(([name, sha]) => ref("tag", name, sha)),
  ];
  const name = path.split("/").pop() ?? "repo";
  const remotes: RemoteInfo[] = [{ name: "origin", url: `git@gitlab.exemple.fr:demo/${name}.git`, pushUrl: null }];
  // « dotfiles » a un second remote (celui d'un client), en retard d'un commit sur origin.
  if (name === "dotfiles") {
    remotes.unshift({ name: "client", url: `git@gitlab.client.fr:projet/${name}.git`, pushUrl: null });
    refs.splice(4, 0, ref("remote", "client/main", commits.find((c) => c.sha === originMain)!.parents[0]));
  }
  const result = { commits, refs: { head: main, headBranch: "main", refs, stashes: 0, autostash: null, remotes } };
  cache.set(path, result);
  return result;
}

const FILES = ["src/lib/graph.ts", "src/views/RepoView.tsx", "src-tauri/src/history.rs", "README.md", "src/styles.css"];

export function mockDetails(path: string, sha: string): CommitDetails {
  const c = mockHistory(path).commits.find((x) => x.sha === sha);
  if (!c) throw "invalid_sha";
  const rand = rng(hash(sha));
  const files: FileChange[] = FILES.filter(() => rand() < 0.5).map((p) => ({ status: "M", path: p, oldPath: null }));
  if (files.length === 0) files.push({ status: "M", path: FILES[0], oldPath: null });
  if (rand() < 0.3) files.push({ status: "A", path: "docs/nouveau.md", oldPath: null });
  if (rand() < 0.2) files.push({ status: "R", path: "src/lib/lanes.ts", oldPath: "src/lib/old-lanes.ts" });
  return {
    sha: c.sha,
    parents: c.parents,
    author: c.author,
    email: c.email,
    time: c.time,
    committer: c.author,
    committerEmail: c.email,
    commitTime: c.time,
    subject: c.subject,
    body: c.parents.length > 1 ? "" : `Description détaillée du changement, liée à !12.\n\nAvec un second paragraphe, après ${c.parents[0]?.slice(0, 8) ?? "rien"}.`,
    files,
  };
}

export function mockDiff(sha: string, file: string): FileDiff {
  if (file.endsWith(".png")) return { binary: true, truncated: false, hunks: [], fingerprint: "bin" };
  const rand = rng(hash(sha + file));
  const start = 1 + Math.floor(rand() * 40);
  return {
    binary: false,
    truncated: false,
    fingerprint: `${sha}:${file}`,
    hunks: [
      {
        header: `@@ -${start},6 +${start},7 @@ export function exemple()`,
        lines: [
          { kind: " ", old: start, new: start, text: "  const lanes = [];" },
          { kind: " ", old: start + 1, new: start + 1, text: "  for (const c of commits) {" },
          { kind: "-", old: start + 2, new: null, text: "    lanes.push(c.sha);" },
          { kind: "+", old: null, new: start + 2, text: "    const col = lanes.indexOf(c.sha);" },
          { kind: "+", old: null, new: start + 3, text: "    lanes[col] = c.parents[0] ?? null;" },
          { kind: " ", old: start + 3, new: start + 4, text: "  }" },
          { kind: " ", old: start + 4, new: start + 5, text: "  return lanes;" },
          { kind: " ", old: start + 5, new: start + 6, text: "}" },
        ],
      },
    ],
  };
}

/** Commit simulé (backend factice) : nouveau commit sur la branche courante, ou
 *  remplacement du dernier (`amend`). Renvoie le SHA créé. */
export function mockCommit(path: string, message: string, amend: boolean): string {
  const h = mockHistory(path);
  const head = h.refs.head;
  const old = h.commits.find((c) => c.sha === head);
  const [subject] = message.trim().split("\n");
  const sha = fakeSha(`${path}:commit:${Date.now()}:${Math.random()}`);
  const parents = amend ? (old?.parents ?? []) : head ? [head] : [];
  const [author, email] = AUTHORS[0];
  const commit: Commit = { sha, parents, author, email, time: Math.floor(Date.now() / 1000), subject };
  h.commits = [commit, ...h.commits.filter((c) => !(amend && c.sha === head))];
  mockMessages.set(sha, message.trim());
  // Nouvel objet refs : l'empreinte change, le graphe se recharge.
  h.refs = {
    ...h.refs,
    head: sha,
    refs: h.refs.refs.map((r) =>
      r.kind === "local" && r.short === h.refs.headBranch ? { ...r, target: sha, ahead: r.ahead + (amend ? 0 : 1) } : r,
    ),
  };
  return sha;
}

/** Ajoute un commit simulé (pull avec merge / rebase) et renvoie son SHA ; les refs sont
 *  à mettre à jour par l'appelant. */
export function mockNewCommit(path: string, parents: string[], subject: string): string {
  const h = mockHistory(path);
  const sha = fakeSha(`${path}:new:${Date.now()}:${Math.random()}`);
  const [author, email] = AUTHORS[0];
  h.commits = [{ sha, parents, author, email, time: Math.floor(Date.now() / 1000), subject }, ...h.commits];
  return sha;
}

/** Messages complets des commits simulés créés pendant la session. */
const mockMessages = new Map<string, string>();

export function mockHeadMessage(path: string): string {
  const h = mockHistory(path);
  const c = h.commits.find((x) => x.sha === h.refs.head);
  return (h.refs.head && mockMessages.get(h.refs.head)) ?? c?.subject ?? "";
}

/** Tests : repart des historiques générés (oublie les commits simulés). */
export function resetMockHistory() {
  cache.clear();
  mockMessages.clear();
}
