// État de la copie de travail de chaque dépôt : fichiers indexés / non indexés, diff ouvert,
// brouillon du message de commit, actions d'indexation et commit.

import { snapshot, unchanged } from "../lib/undo";
import { useUndo } from "./undo";
import { create } from "zustand";
import { api, errorCode } from "../lib/api";
import type { DiffArea, FileDiff, LineRef, StatusFile, WorkStatus } from "../lib/types";
import { diffOpts, useApp } from "./app";
import { useGraph } from "./graph";

export interface CommitDraft {
  summary: string;
  body: string;
  amend: boolean;
  /** Message saisi avant de cocher « amend », restauré si on la décoche. */
  saved?: { summary: string; body: string };
}

export interface WorkDiff {
  file: StatusFile;
  area: DiffArea;
  data?: FileDiff;
  error?: string;
}

export interface RepoWork {
  status?: WorkStatus;
  error?: string;
  /** Une action (indexation, commit…) est en cours. */
  busy: boolean;
  diff?: WorkDiff;
  draft: CommitDraft;
}

interface WorkStore {
  repos: Record<string, RepoWork>;

  refresh(path: string): Promise<void>;
  openDiff(path: string, file: StatusFile, area: DiffArea): Promise<void>;
  closeDiff(path: string): void;
  /** Relit le diff ouvert (fichier modifié ailleurs) ; le ferme s'il n'y a plus rien. */
  reloadDiff(path: string): Promise<void>;
  stage(path: string, files: StatusFile[]): Promise<void>;
  unstage(path: string, files: StatusFile[]): Promise<void>;
  stageAll(path: string): Promise<void>;
  unstageAll(path: string): Promise<void>;
  /** Abandonne les modifications non indexées de ces fichiers (non suivis : supprimés). */
  discard(path: string, files: StatusFile[]): Promise<void>;
  discardAll(path: string): Promise<void>;
  /** Ajoute un motif au `.gitignore` (puis relit l'état : les fichiers visés disparaissent). */
  ignore(path: string, pattern: string): Promise<void>;
  /** Ne plus suivre un fichier (`rm --cached`) et l'ignorer. */
  untrack(path: string, file: string, pattern: string): Promise<void>;
  stashAll(path: string, message: string): Promise<void>;
  stashFiles(path: string, message: string, files: string[]): Promise<void>;
  /** Lignes du diff ouvert : indexer, retirer de l'index, ou abandonner. */
  applyLines(path: string, lines: LineRef[], action: "stage" | "unstage" | "discard"): Promise<void>;
  setDraft(path: string, patch: Partial<Pick<CommitDraft, "summary" | "body">>): void;
  setAmend(path: string, amend: boolean): Promise<void>;
  /** Vrai si le commit a été créé. */
  commit(path: string): Promise<boolean>;
  drop(path: string): void;
}

const emptyDraft = (): CommitDraft => ({ summary: "", body: "", amend: false });
const empty = (): RepoWork => ({ busy: false, draft: emptyDraft() });

/** Côté du diff à ouvrir pour un fichier d'une liste. */
export function areaOf(file: StatusFile, list: "staged" | "unstaged" | "conflicted"): DiffArea {
  if (list === "conflicted") return "conflicted";
  if (list === "staged") return "staged";
  return file.status === "?" ? "untracked" : "unstaged";
}

/** Message complet : résumé, ligne vide, description. */
export function fullMessage(d: CommitDraft): string {
  const body = d.body.trim();
  return body ? `${d.summary.trim()}\n\n${body}` : d.summary.trim();
}

const statusRequest: Record<string, number> = {};

export const useWork = create<WorkStore>((set, get) => {
  const repo = (path: string) => get().repos[path] ?? empty();
  const patch = (path: string, p: Partial<RepoWork>) =>
    set((s) => ({ repos: { ...s.repos, [path]: { ...(s.repos[path] ?? empty()), ...p } } }));

  /** Recharge le diff ouvert ; s'il n'a plus rien de ce côté, bascule de l'autre côté ou le ferme. */
  const reloadDiff = async (path: string) => {
    const d = repo(path).diff;
    const st = repo(path).status;
    if (!d || !st) return;
    const find = (list: StatusFile[]) => list.find((f) => f.path === d.file.path);
    let next: { file: StatusFile; area: DiffArea } | undefined;
    if (d.area === "staged") {
      const f = find(st.staged);
      const other = find(st.unstaged);
      next = f ? { file: f, area: "staged" } : other ? { file: other, area: areaOf(other, "unstaged") } : undefined;
    } else if (d.area === "conflicted") {
      const f = find(st.conflicted);
      next = f ? { file: f, area: "conflicted" } : undefined;
    } else {
      const f = find(st.unstaged);
      const other = find(st.staged);
      next = f ? { file: f, area: areaOf(f, "unstaged") } : other ? { file: other, area: "staged" } : undefined;
    }
    if (next) await get().openDiff(path, next.file, next.area);
    else get().closeDiff(path);
  };

  /** Après une action : résumé, graphe (un commit déplace les refs), état et diff ouvert.
   *  Le graphe est relu avant l'état : quand plus rien n'est en cours, la vue sélectionne
   *  alors le nouveau HEAD (le commit tout juste créé), pas l'ancien. */
  const after = async (path: string) => {
    useApp.getState().refreshSummary(path);
    await useGraph.getState().refresh(path);
    await get().refresh(path);
    await reloadDiff(path);
  };

  /** Lance une action git ; une erreur est affichée dans le toast global. */
  const act = async (path: string, run: () => Promise<unknown>): Promise<boolean> => {
    if (repo(path).busy) return false;
    patch(path, { busy: true });
    let ok = true;
    try {
      await run();
    } catch (e) {
      ok = false;
      useApp.setState({ error: errorCode(e) });
    }
    patch(path, { busy: false });
    await after(path);
    return ok;
  };

  return {
    repos: {},

    async refresh(path) {
      const req = (statusRequest[path] ?? 0) + 1;
      statusRequest[path] = req;
      try {
        const status = await api.workStatus(path);
        if (statusRequest[path] === req) patch(path, { status, error: undefined });
      } catch (e) {
        if (statusRequest[path] === req) patch(path, { error: errorCode(e) });
      }
    },

    async openDiff(path, file, area) {
      const open: WorkDiff = { file, area };
      // Garde les données affichées pendant le rechargement du même fichier (pas de clignotement).
      const cur = repo(path).diff;
      if (cur && cur.file.path === file.path && cur.area === area) open.data = cur.data;
      patch(path, { diff: open });
      let next: WorkDiff;
      try {
        next = { file, area, data: await api.workDiff(path, file.path, file.oldPath, area, diffOpts()) };
      } catch (e) {
        next = { file, area, error: errorCode(e) };
      }
      if (repo(path).diff === open) patch(path, { diff: next });
    },

    closeDiff(path) {
      patch(path, { diff: undefined });
    },

    reloadDiff,

    stage: (path, files) => act(path, () => api.stageFiles(path, files.map((f) => f.path))).then(() => {}),

    unstage: (path, files) =>
      act(path, () =>
        // Un renommage indexé : retirer aussi l'ancien chemin, sinon la suppression reste indexée.
        api.unstageFiles(path, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))),
      ).then(() => {}),

    stageAll: (path) => act(path, () => api.stageAll(path)).then(() => {}),
    unstageAll: (path) => act(path, () => api.unstageAll(path)).then(() => {}),

    discard: (path, files) =>
      act(path, () =>
        api.discardFiles(
          path,
          files.filter((f) => f.status !== "?").map((f) => f.path),
          files.filter((f) => f.status === "?").map((f) => f.path),
        ),
      ).then(() => {}),

    discardAll: (path) => act(path, () => api.discardAll(path)).then(() => {}),
    ignore: (path, pattern) => act(path, () => api.addToGitignore(path, pattern)).then(() => {}),
    untrack: (path, file, pattern) => act(path, () => api.untrackFile(path, file, pattern)).then(() => {}),
    stashAll: (path, message) => act(path, () => api.stashAll(path, message)).then(() => {}),
    stashFiles: (path, message, files) => act(path, () => api.stashFiles(path, message, files)).then(() => {}),

    async applyLines(path, lines, action) {
      const d = repo(path).diff;
      if (!d?.data || lines.length === 0) return;
      const { file, data } = d;
      await act(path, () =>
        action === "discard"
          ? api.discardLines(path, file.path, lines, data.fingerprint)
          : api.stageLines(path, file.path, file.oldPath, lines, data.fingerprint, action === "unstage"),
      );
    },

    setDraft(path, p) {
      patch(path, { draft: { ...repo(path).draft, ...p } });
    },

    async setAmend(path, amend) {
      const d = repo(path).draft;
      if (amend === d.amend) return;
      if (!amend) {
        patch(path, { draft: { ...(d.saved ?? { summary: "", body: "" }), amend: false } });
        return;
      }
      // Pré-remplit avec le message du dernier commit (le brouillon en cours est mis de côté).
      let message = "";
      try {
        message = await api.headMessage(path);
      } catch (e) {
        useApp.setState({ error: errorCode(e) });
        return;
      }
      const [summary, ...rest] = message.split("\n");
      patch(path, {
        draft: { summary, body: rest.join("\n").trim(), amend: true, saved: { summary: d.summary, body: d.body } },
      });
    },

    async commit(path) {
      const draft = repo(path).draft;
      // Pour Ctrl+Z : refs relues juste avant, puis celles du graphe relu après le commit.
      const before = await api.repoRefs(path).then(snapshot, () => null);
      const ok = await act(path, () => api.commit(path, fullMessage(draft), draft.amend));
      if (ok) patch(path, { draft: emptyDraft() });
      const refs = useGraph.getState().graphs[path]?.refs;
      if (ok && before && refs && !unchanged(before, snapshot(refs))) {
        useUndo.getState().record(path, { label: draft.amend ? "amend" : "commit", before, after: snapshot(refs), soft: true });
      }
      return ok;
    },

    drop(path) {
      set((s) => {
        const repos = { ...s.repos };
        delete repos[path];
        return { repos };
      });
    },
  };
});

/** Nombre de fichiers distincts modifiés (indexés, non indexés ou en conflit). */
export function changedCount(st: WorkStatus | undefined): number {
  if (!st) return 0;
  return new Set([...st.staged, ...st.unstaged, ...st.conflicted].map((f) => f.path)).size;
}
