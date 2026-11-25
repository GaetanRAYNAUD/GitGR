// Navigation au clavier d'un arbre fait de boutons ordinaires (barre latérale des refs) :
// une seule tabulation (« roving tabindex »), ↑ / ↓ / Début / Fin d'un élément à l'autre,
// → / ← pour déplier / replier (ou aller au premier enfant / au parent), Maj+Entrée pour
// l'action du double-clic, et recherche à la frappe.
//
// Les éléments portent :
//   data-ti        : la clé stable de l'élément (arrêt de tabulation retenu d'un rendu à l'autre) ;
//   data-ti-parent : la clé de son parent (← y ramène) ;
//   aria-expanded  : s'il se déplie (en-tête de section, dossier).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const ITEM = "[data-ti]";

/** Éléments de l'arbre visibles, dans l'ordre du document. */
export function treeItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEM)];
}

/** Élément suivant dont le libellé commence par `prefix` (sans casse), à partir de `from`
 *  exclu, en bouclant. */
export function typeAhead(labels: string[], from: number, prefix: string): number {
  const p = prefix.toLowerCase();
  for (let d = 1; d <= labels.length; d++) {
    const i = (from + d) % labels.length;
    if (labels[i].toLowerCase().startsWith(p)) return i;
  }
  return -1;
}

const labelOf = (el: HTMLElement) => (el.querySelector(".side-label, .section-name")?.textContent ?? el.textContent ?? "").trim();

/** `onItems` : appelé avec le nombre d'éléments à chaque changement de l'arbre. */
export function useTreeNav(onItems?: (count: number) => void) {
  const root = useRef<HTMLDivElement>(null);
  /** Clé de l'élément qui porte l'arrêt de tabulation. */
  const active = useRef<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const onItemsRef = useRef(onItems);
  onItemsRef.current = onItems;

  // Un seul élément tabulable — le dernier focalisé, sinon la branche courante, sinon le
  // premier. Les poignées de redimensionnement sortent de la tabulation (Alt+↑ / Alt+↓ sur
  // l'en-tête de la section les remplacent).
  const apply = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const items = treeItems(el);
    const keep =
      items.find((i) => i.dataset.ti === active.current) ?? items.find((i) => i.getAttribute("aria-current") === "true") ?? items[0];
    // Comparé à l'attribut (pas à `tabIndex`, qui vaut déjà 0 sur un bouton sans attribut).
    for (const i of items) {
      const want = i === keep ? "0" : "-1";
      if (i.getAttribute("tabindex") !== want) i.setAttribute("tabindex", want);
    }
    el.querySelectorAll<HTMLElement>(".splitter").forEach((s) => (s.tabIndex = -1));
    onItemsRef.current?.(items.length);
  }, []);
  // Au rendu du parent, et quand une section enfant se rend seule (données arrivées après).
  useLayoutEffect(apply);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const obs = new MutationObserver(apply);
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [apply]);

  const onFocus = useCallback((e: React.FocusEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (!t || !root.current) return;
    active.current = t.dataset.ti ?? null;
    for (const i of treeItems(root.current)) i.tabIndex = i === t ? 0 : -1;
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = root.current;
    const cur = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (!el || !cur || e.target !== cur) return;
    const items = treeItems(el);
    const i = items.indexOf(cur);
    const go = (j: number) => {
      const next = items[Math.max(0, Math.min(items.length - 1, j))];
      next?.focus();
      next?.scrollIntoView({ block: "nearest" });
    };
    const expanded = cur.getAttribute("aria-expanded");
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Hauteur de la section : sa poignée, au clavier, depuis l'en-tête.
      const splitter = cur.closest(".side-group")?.querySelector(".splitter");
      if (!splitter) return;
      e.preventDefault();
      splitter.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true }));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return go(i + 1);
      case "ArrowUp":
        e.preventDefault();
        return go(i - 1);
      case "Home":
        e.preventDefault();
        return go(0);
      case "End":
        e.preventDefault();
        return go(items.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (expanded === "false") cur.click();
        else if (expanded === "true") go(i + 1);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (expanded === "true") return cur.click();
        const parent = cur.dataset.tiParent ? items.find((x) => x.dataset.ti === cur.dataset.tiParent) : undefined;
        parent?.focus();
        return;
      }
      case "Enter":
        if (!e.shiftKey) return;
        // Maj+Entrée : l'action du double-clic (checkout).
        e.preventDefault();
        cur.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        return;
    }
    // Recherche à la frappe : les lettres tapées à la suite (moins d'une seconde d'écart).
    if (e.key.length === 1 && e.key !== " ") {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at < 1000 ? t.text + e.key : e.key;
      t.at = now;
      const j = typeAhead(items.map(labelOf), t.text.length > 1 ? i - 1 : i, t.text);
      if (j >= 0) {
        e.preventDefault();
        go(j);
      }
    }
  }, []);

  /** Donne le focus à l'élément qui porte l'arrêt de tabulation (Ctrl+Maj+E, Échap du filtre). */
  const focus = useCallback(() => {
    root.current?.querySelector<HTMLElement>(`${ITEM}[tabindex="0"]`)?.focus();
  }, []);

  return { root, onFocus, onKeyDown, focus };
}
