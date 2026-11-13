import { useApp } from "../store/app";

const initial = useApp.getState();

/** Remet le store zustand dans son état de départ (entre deux tests). */
export function resetStore() {
  useApp.setState(initial, true);
}

/** Chemins acceptés par le backend simulé (voir lib/api.ts). */
export const REPO_A = "C:/Users/demo/Projects/GitGR";
export const REPO_B = "C:/Users/demo/work/api-backend";
export const REPO_C = "C:/Users/demo/dotfiles";
export const NOT_A_REPO = "C:/Users/demo/Documents/pas-un-depot";
