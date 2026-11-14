// Logo de GitGR : un G tracé comme une branche du graphe, trois commits, HEAD au centre.
// Même dessin que src-tauri/icons/logo.svg (variante sombre, icône de l'app) et
// logo-light.svg (thème clair) ; les couleurs suivent le thème via les variables --logo-*.

/** `tile` : avec le carré de fond (comme l'icône de l'app). Sans, le dessin se pose sur la
 *  surface qui l'entoure : l'intérieur des commits prend `--logo-hole`, à régler sur la
 *  couleur de cette surface (cf. `.brand` dans styles.css). */
export function Logo({ size = 22, tile = true }: { size?: number; tile?: boolean }) {
  const hole = tile ? "var(--logo-bg)" : "var(--logo-hole)";
  return (
    <svg className="logo" width={size} height={size} viewBox={tile ? "0 0 110 110" : "18 18 74 74"} aria-hidden="true">
      {tile && <rect x="0.5" y="0.5" width="109" height="109" rx="24" fill="var(--logo-bg)" stroke="var(--logo-edge)" />}
      <g fill="none" strokeWidth="6" strokeLinecap="round">
        <path d="M76 36A28 28 0 0 0 27 55" stroke="var(--logo-1)" />
        <path d="M27 55A28 28 0 0 0 55 83" stroke="var(--logo-2)" />
        <path d="M55 83A28 28 0 0 0 83 55H58" stroke="var(--logo-3)" />
      </g>
      <g fill={hole} strokeWidth="4">
        <circle cx="76" cy="36" r="7" stroke="var(--logo-1)" />
        <circle cx="27" cy="55" r="7" stroke="var(--logo-2)" />
        <circle cx="55" cy="83" r="7" stroke="var(--logo-3)" />
      </g>
      <circle cx="56" cy="55" r="7" fill="var(--logo-head)" />
    </svg>
  );
}
