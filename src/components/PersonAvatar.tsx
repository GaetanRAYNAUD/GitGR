// Avatar d'une personne d'une PR / MR (auteur, relecteur, assigné) : son image, sinon ses
// initiales sur une couleur tirée du login.

import { initials } from "../lib/format";
import type { Person } from "../lib/types";
import { usePersonAvatar, type PersonContext } from "../store/avatars";

function hue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function PersonAvatar({ ctx, person, size = 18, className }: { ctx: PersonContext | null; person: Person; size?: number; className?: string }) {
  const image = usePersonAvatar(ctx, person.avatar);
  const cls = className ? `person-avatar ${className}` : "person-avatar";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) } as React.CSSProperties;
  if (image) return <img className={cls} src={image} alt="" draggable={false} style={style} />;
  return (
    <span className={`${cls} initials`} aria-hidden="true" style={{ ...style, background: `hsl(${hue(person.login)} 45% 45%)` }}>
      {initials(person.name || person.login).slice(0, 2)}
    </span>
  );
}
