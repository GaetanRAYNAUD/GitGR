// Profil actif d'un dépôt, discret (zone de commit, barre d'état) ; un clic ouvre le menu
// pour en changer, écrire l'identité dans .git/config ou gérer les profils.

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { profileColor } from "../lib/profiles";
import { ProfileAvatar } from "./ProfileAvatar";
import { activeProfile, useProfiles } from "../store/profiles";
import { type MenuItem, openMenuBelow } from "./ContextMenu";

export function ProfilePill({ path, className }: { path: string; className?: string }) {
  const { t } = useTranslation();
  const profiles = useProfiles((s) => s.profiles);
  const binding = useProfiles((s) => s.repoProfiles[path]);
  const active = useProfiles((s) => activeProfile(path, s));
  const ref = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const el = ref.current;
    if (!el) return;
    const store = useProfiles.getState();
    const allowed = new Set(binding?.allowed ?? []);
    // Profils associés au dépôt d'abord, puis les autres.
    const ordered = [...profiles.filter((p) => allowed.has(p.id)), ...profiles.filter((p) => !allowed.has(p.id))];
    const items: MenuItem[] = ordered.map((p) => ({
      label: `${p.name} · ${p.userEmail}`,
      checked: p.id === active?.id,
      swatch: profileColor(p),
      image: p.image,
      onClick: () => store.setActive(path, p.id),
    }));
    if (profiles.length) {
      items.push({ label: t("profiles.noneItem"), checked: !active, swatch: null, onClick: () => store.setActive(path, null) }, "sep");
      items.push({ label: t("profiles.apply"), disabled: !active, onClick: () => store.applyIdentity(path) });
    }
    items.push({
      label: profiles.length ? t("profiles.manage") : t("profiles.create"),
      onClick: () => store.openPage(active?.id ?? (profiles.length ? null : "new")),
    });
    openMenuBelow(el, items);
  };

  const title = active ? t("profiles.pillHint", { name: active.userName, email: active.userEmail }) : t("profiles.pillNoneHint");
  return (
    <button
      ref={ref}
      type="button"
      className={className ? `profile-pill ${className}` : "profile-pill"}
      title={title}
      aria-haspopup="menu"
      onClick={openMenu}
    >
      {active?.image ? (
        <ProfileAvatar profile={active} className="pill-avatar" />
      ) : (
        <span className="dot" style={{ background: active ? profileColor(active) : "var(--faint)" }} />
      )}
      {active?.name ?? t("profiles.none")}
    </button>
  );
}
