// Avatars des propriétaires de dépôts (utilisateur, organisation, groupe), lus une fois par
// session et par instance : le backend les garde aussi en cache sur disque (src-tauri/src/avatars.rs).

import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import type { ProviderKind } from "../lib/types";

interface AvatarsStore {
  /** Clé `kind|instance|propriétaire|compte` → data URL ; `null` : pas d'avatar ; absent : jamais demandé. */
  avatars: Record<string, string | null>;
}

export const useAvatars = create<AvatarsStore>(() => ({ avatars: {} }));

/** Avec ou sans compte, deux entrées : un groupe privé n'est visible qu'avec le token. */
const key = (kind: ProviderKind, url: string, owner: string, account: string | null) => `${kind}|${url}|${owner.toLowerCase()}|${account ?? ""}`;
const pending = new Set<string>();

/** Oublie les avatars lus (tests). */
export function resetAvatars() {
  pending.clear();
  useAvatars.setState({ avatars: {} });
}

/** Avatar d'un propriétaire, demandé au premier affichage ; `null` tant qu'il n'est pas là (ou
 *  s'il n'existe pas). Une erreur (réseau, token) n'est pas gardée : réessayée au prochain
 *  affichage dans une autre session de l'app. */
export function useOwnerAvatar(kind: ProviderKind | null, url: string | null, owner: string | null, account: string | null): string | null {
  const k = kind && url && owner ? key(kind, url, owner, account) : null;
  const avatar = useAvatars((s) => (k ? s.avatars[k] : undefined));
  useEffect(() => {
    if (!k || !kind || !url || !owner || pending.has(k) || k in useAvatars.getState().avatars) return;
    pending.add(k);
    api.ownerAvatar(kind, url, owner, account).then(
      (data) => useAvatars.setState((s) => ({ avatars: { ...s.avatars, [k]: data } })),
      () => {},
    );
  }, [k, kind, url, owner, account]);
  return avatar ?? null;
}
