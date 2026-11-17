// Avatars des propriétaires de dépôts (utilisateur, organisation, groupe), lus une fois par
// session et par instance : le backend les garde aussi en cache sur disque (src-tauri/src/avatars.rs).

import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import type { ProviderKind } from "../lib/types";

interface AvatarsStore {
  /** Clé `kind|instance|propriétaire|compte` → data URL ; `null` : pas d'avatar ; absent : jamais demandé. */
  avatars: Record<string, string | null>;
  /** Auteurs : clé du contexte (`AuthorContext`) puis adresse → data URL ou `null`. */
  authors: Record<string, Record<string, string | null>>;
}

export const useAvatars = create<AvatarsStore>(() => ({ avatars: {}, authors: {} }));

/** Avec ou sans compte, deux entrées : un groupe privé n'est visible qu'avec le token. */
const key = (kind: ProviderKind, url: string, owner: string, account: string | null) => `${kind}|${url}|${owner.toLowerCase()}|${account ?? ""}`;
const pending = new Set<string>();

/** Oublie les avatars lus (tests). */
export function resetAvatars() {
  pending.clear();
  authorPending.clear();
  personQueue.clear();
  personAsked.clear();
  useAvatars.setState({ avatars: {}, authors: {} });
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

/** Dépôt dont on affiche les auteurs : provider et dépôt du remote `origin` (s'il est connu),
 *  et compte dont le token sert. */
export interface AuthorContext {
  kind: ProviderKind | null;
  url: string | null;
  /** `propriétaire/nom`. */
  repo: string | null;
  account: string | null;
}

const authorKey = (c: AuthorContext) => `${c.kind ?? ""}|${c.url ?? ""}|${c.repo ?? ""}|${c.account ?? ""}`;
/** Adresses déjà demandées, par contexte. */
const authorPending = new Map<string, Set<string>>();
const NO_AUTHORS: Record<string, string | null> = {};

/** Avatars des auteurs `emails` (les lignes visibles du graphe) : demandés au backend par
 *  paquets, une seule fois par session ; `ctx` à `null` : rien n'est demandé (réglage). */
export function useAuthorAvatars(ctx: AuthorContext | null, emails: string[]): Record<string, string | null> {
  const k = ctx ? authorKey(ctx) : null;
  const avatars = useAvatars((s) => (k ? s.authors[k] : undefined)) ?? NO_AUTHORS;
  const list = emails.join("\n");
  useEffect(() => {
    if (!ctx || !k || !list) return;
    let asked = authorPending.get(k);
    if (!asked) authorPending.set(k, (asked = new Set()));
    const wanted = [...new Set(list.split("\n").map((e) => e.toLowerCase()))].filter((e) => e && !asked.has(e));
    if (!wanted.length) return;
    for (const e of wanted) asked.add(e);
    for (let i = 0; i < wanted.length; i += 60) {
      const batch = wanted.slice(i, i + 60);
      api.authorAvatars(ctx.kind, ctx.url, ctx.repo, ctx.account, batch).then(
        (found) => useAvatars.setState((s) => ({ authors: { ...s.authors, [k]: { ...s.authors[k], ...found } } })),
        // Erreur : ces adresses pourront être redemandées (prochain affichage).
        () => batch.forEach((e) => asked.delete(e)),
      );
    }
    // `ctx` est rendu par `k` ; seules la clé et la liste comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, list]);
  return avatars;
}

/** Images chargées pour le canvas du graphe (data URL → image), et un compteur qui change à
 *  chaque image prête (pour redessiner). */
const images = new Map<string, HTMLImageElement>();
export function useAvatarImages(urls: (string | null | undefined)[]): { get(url: string | null | undefined): HTMLImageElement | null; version: number } {
  const [version, setVersion] = useState(0);
  const list = urls.filter((u): u is string => !!u);
  const joined = [...new Set(list)].join("\n");
  useEffect(() => {
    let live = true;
    for (const url of joined ? joined.split("\n") : []) {
      if (images.has(url)) continue;
      const img = new Image();
      img.onload = () => live && setVersion((v) => v + 1);
      img.src = url;
      images.set(url, img);
    }
    return () => {
      live = false;
    };
  }, [joined]);
  return {
    get: (url) => {
      const img = url ? images.get(url) : undefined;
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    },
    version,
  };
}

/** Instance dont viennent les images des personnes (PR / MR), et compte dont le token sert. */
export interface PersonContext {
  kind: ProviderKind;
  url: string;
  account: string | null;
}

const personKey = (c: PersonContext) => `person|${c.kind}|${c.url}|${c.account ?? ""}`;
/** Adresses en attente d'envoi, par contexte : regroupées en une demande par rendu. */
const personQueue = new Map<string, { ctx: PersonContext; urls: Set<string> }>();
const personAsked = new Set<string>();
let personScheduled = false;

function flushPersons() {
  personScheduled = false;
  const batches = [...personQueue.values()];
  personQueue.clear();
  for (const { ctx, urls } of batches) {
    const k = personKey(ctx);
    const list = [...urls];
    for (let i = 0; i < list.length; i += 60) {
      const batch = list.slice(i, i + 60);
      api.personAvatars(ctx.kind, ctx.url, ctx.account, batch).then(
        (found) => useAvatars.setState((s) => ({ authors: { ...s.authors, [k]: { ...s.authors[k], ...found } } })),
        () => batch.forEach((u) => personAsked.delete(`${k}|${u}`)),
      );
    }
  }
}

/** Image d'une personne (adresse donnée par l'API), demandée au premier affichage et groupée
 *  avec les autres de la même liste ; `null` tant qu'elle n'est pas là. */
export function usePersonAvatar(ctx: PersonContext | null, url: string | null | undefined): string | null {
  const k = ctx ? personKey(ctx) : null;
  const avatar = useAvatars((s) => (k && url ? s.authors[k]?.[url] : undefined));
  useEffect(() => {
    if (!ctx || !k || !url) return;
    const asked = `${k}|${url}`;
    if (personAsked.has(asked)) return;
    personAsked.add(asked);
    let q = personQueue.get(k);
    if (!q) personQueue.set(k, (q = { ctx, urls: new Set() }));
    if (!personScheduled) {
      personScheduled = true;
      queueMicrotask(flushPersons);
    }
    q.urls.add(url);
    // `ctx` est rendu par `k`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, url]);
  return avatar ?? null;
}
