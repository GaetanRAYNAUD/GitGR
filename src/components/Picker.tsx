// Bouton de choix qui ouvre un menu (profils, comptes) : il montre des avatars, ce qu'un
// <select> ne sait pas faire. Partagé par les fenêtres de clone et de publication.

import { useId, useRef } from "react";
import type { Profile } from "../lib/types";
import { type MenuItem, openMenuBelow } from "./ContextMenu";
import { Icon } from "./Icon";
import { ProfileAvatar } from "./ProfileAvatar";

/** Avatar du profil (image, sinon initiales sur sa couleur) ; cercle vide pour « aucun ». */
export function ProfileMark({ profile }: { profile: Profile | null }) {
  if (!profile) return <span className="menu-swatch none" aria-hidden="true" />;
  return <ProfileAvatar profile={profile} className="picker-avatar" />;
}

export function Picker({ label, disabled, items, children }: { label: string; disabled?: boolean; items: () => MenuItem[]; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  // Nom lu : le libellé puis la valeur choisie (« Profil, Travail »), pas le libellé seul.
  return (
    <button
      ref={ref}
      type="button"
      className="pf-input picker"
      aria-labelledby={`${id}-l ${id}-v`}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={() => ref.current && openMenuBelow(ref.current, items())}
    >
      <span id={`${id}-l`} className="visually-hidden">
        {label}
      </span>
      <span id={`${id}-v`} className="picker-value">
        {children}
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
}
