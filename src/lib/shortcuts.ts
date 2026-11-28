// Table des raccourcis clavier de GitGR, par zone : la page « Raccourcis clavier » des réglages
// (F1) et la palette de commandes la lisent. Combinaisons écrites en forme canonique
// (`Ctrl+Shift+K`), traduites à l'affichage (`Ctrl+Maj+K`) par `keyLabel`.
//
// À tenir à jour avec les écouteurs (App.tsx, RepoView, CommitGraph, DiffBody…).

export type ShortcutZone = "global" | "tabs" | "toolbar" | "graph" | "sidebar" | "changes" | "diff" | "conflicts";

export interface Shortcut {
  /** Clé du libellé : `shortcuts.items.<id>`. */
  id: string;
  zone: ShortcutZone;
  /** Une ou plusieurs combinaisons équivalentes (`Ctrl+Y`, `Ctrl+Shift+Z`). */
  keys: string[];
}

export const ZONES: ShortcutZone[] = ["global", "tabs", "toolbar", "graph", "sidebar", "changes", "diff", "conflicts"];

export const SHORTCUTS: Shortcut[] = [
  { id: "openRepo", zone: "global", keys: ["Ctrl+O"] },
  { id: "quickOpen", zone: "global", keys: ["Ctrl+E"] },
  { id: "home", zone: "global", keys: ["Ctrl+T"] },
  { id: "refresh", zone: "global", keys: ["F5"] },
  { id: "undo", zone: "global", keys: ["Ctrl+Z"] },
  { id: "redo", zone: "global", keys: ["Ctrl+Y", "Ctrl+Shift+Z"] },
  { id: "toGraph", zone: "global", keys: ["Ctrl+G"] },
  { id: "notifications", zone: "global", keys: ["Ctrl+Shift+N"] },
  { id: "toast", zone: "global", keys: ["F6"] },
  { id: "shortcuts", zone: "global", keys: ["F1"] },

  { id: "nextTab", zone: "tabs", keys: ["Ctrl+Tab"] },
  { id: "prevTab", zone: "tabs", keys: ["Ctrl+Shift+Tab"] },
  { id: "tabN", zone: "tabs", keys: ["Ctrl+1…8"] },
  { id: "lastTab", zone: "tabs", keys: ["Ctrl+9"] },
  { id: "closeTab", zone: "tabs", keys: ["Ctrl+W"] },
  { id: "moveTab", zone: "tabs", keys: ["Ctrl+Shift+PageUp", "Ctrl+Shift+PageDown"] },
  { id: "renameTab", zone: "tabs", keys: ["F2"] },

  { id: "pull", zone: "toolbar", keys: ["Ctrl+Shift+L"] },
  { id: "push", zone: "toolbar", keys: ["Ctrl+Shift+K"] },
  { id: "fetch", zone: "toolbar", keys: ["Ctrl+Shift+F"] },
  { id: "branch", zone: "toolbar", keys: ["Ctrl+Shift+B"] },
  { id: "stash", zone: "toolbar", keys: ["Ctrl+Shift+S"] },
  { id: "pop", zone: "toolbar", keys: ["Ctrl+Shift+P"] },
  { id: "recentBranches", zone: "toolbar", keys: ["Ctrl+Shift+O"] },

  { id: "find", zone: "graph", keys: ["Ctrl+F"] },
  { id: "findNext", zone: "graph", keys: ["Enter", "Shift+Enter"] },
  { id: "move", zone: "graph", keys: ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"] },
  { id: "extend", zone: "graph", keys: ["Shift+ArrowUp", "Shift+ArrowDown"] },
  { id: "details", zone: "graph", keys: ["Enter"] },
  { id: "rowMenu", zone: "graph", keys: ["Shift+F10"] },
  { id: "back", zone: "graph", keys: ["Alt+ArrowLeft"] },

  { id: "sidebarFocus", zone: "sidebar", keys: ["Ctrl+Shift+E"] },
  { id: "sidebarCheckout", zone: "sidebar", keys: ["Shift+Enter"] },
  { id: "sidebarShow", zone: "sidebar", keys: ["Enter"] },
  { id: "sidebarFold", zone: "sidebar", keys: ["ArrowLeft", "ArrowRight"] },
  { id: "sidebarClear", zone: "sidebar", keys: ["Escape"] },

  { id: "stage", zone: "changes", keys: ["Space"] },
  { id: "discard", zone: "changes", keys: ["Delete"] },
  { id: "selectAll", zone: "changes", keys: ["Ctrl+A"] },
  { id: "commit", zone: "changes", keys: ["Ctrl+Enter"] },

  { id: "diffPick", zone: "diff", keys: ["Space"] },
  { id: "diffApply", zone: "diff", keys: ["Enter"] },
  { id: "diffDiscard", zone: "diff", keys: ["Delete"] },
  { id: "diffHunk", zone: "diff", keys: ["F7", "Shift+F7"] },
  { id: "diffCopy", zone: "diff", keys: ["Ctrl+C"] },
  { id: "diffBlame", zone: "diff", keys: ["Ctrl+Alt+B"] },
  { id: "diffClose", zone: "diff", keys: ["Escape"] },

  { id: "conflictNext", zone: "conflicts", keys: ["F7"] },
  { id: "conflictSide", zone: "conflicts", keys: ["Alt+ArrowLeft", "Alt+ArrowRight"] },
  { id: "conflictMove", zone: "conflicts", keys: ["Alt+ArrowUp", "Alt+ArrowDown"] },
  { id: "conflictSave", zone: "conflicts", keys: ["Ctrl+S"] },
];

/** Touches d'une combinaison (`Ctrl+Shift+K` → `["Ctrl", "Shift", "K"]`). */
export function keyParts(combo: string): string[] {
  return combo.split("+").filter(Boolean);
}

/** Libellé d'une touche dans la langue de l'interface (`names` : `shortcuts.keyNames`). */
export function keyLabel(key: string, names: Record<string, string>): string {
  return names[key] ?? key;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Raccourcis dont le libellé ou une touche contient le texte cherché (sans casse ni accents). */
export function filterShortcuts(list: Shortcut[], query: string, label: (s: Shortcut) => string, combo: (k: string) => string): Shortcut[] {
  const q = fold(query.trim());
  if (!q) return list;
  return list.filter((s) => fold(label(s)).includes(q) || s.keys.some((k) => fold(combo(k)).includes(q)));
}
