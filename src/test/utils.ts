import { useApp } from "../store/app";
import { useGraph } from "../store/graph";
import { useWork } from "../store/worktree";

const initial = useApp.getState();
const initialGraph = useGraph.getState();
const initialWork = useWork.getState();

/** Remet les stores zustand dans leur état de départ (entre deux tests). */
export function resetStore() {
  useApp.setState(initial, true);
  useGraph.setState(initialGraph, true);
  useWork.setState(initialWork, true);
}

/** Chemins acceptés par le backend simulé (voir lib/api.ts). */
export const REPO_A = "C:/Users/demo/Projects/GitGR";
export const REPO_B = "C:/Users/demo/work/api-backend";
export const REPO_C = "C:/Users/demo/dotfiles";
export const NOT_A_REPO = "C:/Users/demo/Documents/pas-un-depot";
