import { useId } from "react";

// Drapeaux en SVG : les emoji drapeaux ne s'affichent pas sous Windows.

function FlagFr() {
  return (
    <svg viewBox="0 0 3 2" className="flag" aria-hidden="true">
      <rect width="1" height="2" x="0" fill="#002654" />
      <rect width="1" height="2" x="1" fill="#ffffff" />
      <rect width="1" height="2" x="2" fill="#ce1126" />
    </svg>
  );
}

function FlagGb() {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 60 30" className="flag" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <clipPath id={`${id}-t`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}-t)`} stroke="#c8102e" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  );
}

export function Flag({ lang }: { lang: "fr" | "en" }) {
  return lang === "fr" ? <FlagFr /> : <FlagGb />;
}
