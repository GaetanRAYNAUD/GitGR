// Glisser-déposer d'un commit du graphe sur une branche locale (barre latérale ou étiquette
// du graphe) : au dépôt, un menu propose cherry-pick, reset ou déplacement de la branche.
//
// Événements souris plutôt que le drag & drop HTML5 : ce dernier est intercepté par Tauri sous
// Windows (dépôt de fichiers). Les cibles portent `data-drop-ref` (nom complet de la branche).

/** Distance (px) à parcourir avant qu'un appui devienne un glisser. */
const DRAG_THRESHOLD = 5;

export interface CommitDrop {
  /** Nom complet de la branche visée (`refs/heads/x`). */
  ref: string;
  x: number;
  y: number;
}

let stop: (() => void) | null = null;

/** Cible de dépôt sous le pointeur. */
function targetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return el instanceof Element ? (el.closest<HTMLElement>("[data-drop-ref]") ?? null) : null;
}

/** Commence (après quelques pixels) le glisser d'un commit ; `onDrop` reçoit la branche visée.
 *  À appeler sur le `mousedown` (bouton gauche) d'une ligne du graphe. */
export function startCommitDrag(e: React.MouseEvent, label: string, onDrop: (drop: CommitDrop) => void) {
  if (e.button !== 0) return;
  stop?.();
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let over: HTMLElement | null = null;

  const setOver = (el: HTMLElement | null) => {
    if (el === over) return;
    over?.classList.remove("drop-over");
    over = el;
    over?.classList.add("drop-over");
  };

  const onMove = (ev: MouseEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className = "commit-drag-ghost";
      ghost.textContent = label;
      document.body.appendChild(ghost);
      document.body.classList.add("commit-dragging");
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    setOver(targetAt(ev.clientX, ev.clientY));
  };

  const end = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("keydown", onKey, true);
    setOver(null);
    ghost?.remove();
    document.body.classList.remove("commit-dragging");
    stop = null;
  };

  const onUp = (ev: MouseEvent) => {
    const dragged = !!ghost;
    const target = dragged ? targetAt(ev.clientX, ev.clientY) : null;
    end();
    const ref = target?.dataset.dropRef;
    if (ref) onDrop({ ref, x: ev.clientX, y: ev.clientY });
  };

  // Échap annule le glisser.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !ghost) return;
    ev.stopPropagation();
    end();
  };

  stop = end;
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey, true);
}
