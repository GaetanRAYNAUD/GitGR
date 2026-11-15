// Avatar d'un profil : son image si elle existe, sinon ses initiales sur sa couleur.

import { initials } from "../lib/format";
import { profileColor } from "../lib/profiles";
import type { Profile } from "../lib/types";

export function ProfileAvatar({ profile, className = "pf-avatar" }: { profile: Pick<Profile, "name" | "color" | "image">; className?: string }) {
  if (profile.image) return <img className={`${className} img`} src={profile.image} alt="" aria-hidden="true" draggable={false} />;
  return (
    <span className={className} style={{ background: `color-mix(in srgb, ${profileColor(profile)} 30%, transparent)` }} aria-hidden="true">
      {initials(profile.name || "?").slice(0, 2)}
    </span>
  );
}
