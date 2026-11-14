// Poignée de redimensionnement : glisser (souris), flèches (clavier), double-clic = taille par défaut.
// Elle ne connaît pas la mise en page : elle mesure la taille de départ, puis signale la
// nouvelle taille ; le parent la borne et l'enregistre.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clamp, LIMITS, useLayoutValue } from "../lib/layout";
import { useApp } from "../store/app";

/** Pas d'une flèche au clavier (px). */
const KEY_STEP = 16;

interface Props {
  /** `x` : barre verticale qui change une largeur ; `y` : barre horizontale, une hauteur. */
  dir: "x" | "y";
  label: string;
  /** Taille au début du geste : celle de l'élément voisin (avant / après), ou une mesure libre. */
  measure: "prev" | "next" | ((el: HTMLElement) => number);
  /** Sens : +1 si aller vers la droite / le bas agrandit, −1 sinon. */
  sign?: 1 | -1;
  /** Nouvelle taille ; `final` au relâcher (ou au clavier) : c'est là qu'on enregistre. */
  onChange: (size: number, final: boolean) => void;
  onReset: () => void;
  className?: string;
  style?: CSSProperties;
}

function sizeOf(el: Element | null, dir: "x" | "y") {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return dir === "x" ? r.width : r.height;
}

export function Splitter({ dir, label, measure, sign = 1, onChange, onReset, className, style }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  /** Termine le geste en cours (aussi au démontage, en enregistrant la dernière taille affichée). */
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = () => {
    const el = ref.current!;
    if (typeof measure === "function") return measure(el);
    return sizeOf(measure === "prev" ? el.previousElementSibling : el.nextElementSibling, dir);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stop.current?.();
    const from = start();
    const origin = dir === "x" ? e.clientX : e.clientY;
    let last = from;
    document.body.classList.add(dir === "x" ? "resizing-x" : "resizing-y");

    const onMove = (ev: PointerEvent) => {
      last = from + sign * ((dir === "x" ? ev.clientX : ev.clientY) - origin);
      onChange(last, false);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("resizing-x", "resizing-y");
      stop.current = null;
      if (commit && last !== from) onChange(last, true);
    };
    const onUp = () => finish(true);
    stop.current = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = dir === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    const step = keys[e.key as keyof typeof keys];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(start() + sign * step * KEY_STEP, true);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={dir === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      title={`${label} — ${t("layout.resetHint")}`}
      tabIndex={0}
      className={["splitter", `splitter-${dir}`, className].filter(Boolean).join(" ")}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

/** Bloc dont on règle la hauteur avec une poignée en dessous (taille mémorisée sous `layoutKey`).
 *  Sans taille choisie, il garde sa hauteur naturelle ; avec, son contenu défile. */
export function ResizableBlock({
  layoutKey,
  label,
  className,
  children,
}: {
  layoutKey: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const height = useLayoutValue(layoutKey);
  const setLayout = useApp((s) => s.setLayout);
  const sized = height !== undefined;
  return (
    <>
      <div className={[className, sized && "sized"].filter(Boolean).join(" ") || undefined} style={sized ? { height } : undefined}>
        {children}
      </div>
      <Splitter
        dir="y"
        label={label}
        measure="prev"
        onChange={(v, final) => setLayout({ [layoutKey]: clamp(v, LIMITS.section) }, final)}
        onReset={() => setLayout({ [layoutKey]: null })}
      />
    </>
  );
}
