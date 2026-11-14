import { useContextMenu } from "../components/ContextMenu";
import { useApp } from "../store/app";
import { useDialogs } from "../store/dialogs";
import { useGraph } from "../store/graph";
import { useOps } from "../store/ops";
import { useWork } from "../store/worktree";

const initial = useApp.getState();
const initialGraph = useGraph.getState();
const initialWork = useWork.getState();
const initialOps = useOps.getState();
const initialDialogs = useDialogs.getState();
const initialMenu = useContextMenu.getState();

/** Remet les stores zustand dans leur état de départ (entre deux tests). */
export function resetStore() {
  useApp.setState(initial, true);
  useGraph.setState(initialGraph, true);
  useWork.setState(initialWork, true);
  useOps.setState(initialOps, true);
  useDialogs.setState(initialDialogs, true);
  useContextMenu.setState(initialMenu, true);
}

/** Chemins acceptés par le backend simulé (voir lib/api.ts). */
export const REPO_A = "C:/Users/demo/Projects/GitGR";
export const REPO_B = "C:/Users/demo/work/api-backend";
export const REPO_C = "C:/Users/demo/dotfiles";
export const NOT_A_REPO = "C:/Users/demo/Documents/pas-un-depot";
