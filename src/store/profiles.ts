// Profils (identités Git) et profil actif de chaque dépôt.
//
// L'identité et la clé SSH du profil actif sont injectées par le backend dans chaque commande
// git du dépôt (src-tauri/src/git.rs) ; ici : la liste, l'association dépôt ↔ profils, la
// sélection automatique et le garde-fou avant un commit / push.

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import { hostMismatch, parseRemote, remoteLabel, suggestProfile } from "../lib/profiles";
import type { AppState, Profile, RepoProfiles } from "../lib/types";
import { useApp } from "./app";
import { useDialogs } from "./dialogs";

const t = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts);

interface ProfilesStore {
  profiles: Profile[];
  /** Par chemin de dépôt ; absent = jamais choisi. */
  repoProfiles: Record<string, RepoProfiles>;
  home: string | null;
  /** Page de gestion des profils ouverte (à la place du dépôt / de l'accueil). */
  pageOpen: boolean;
  /** Profil à montrer en ouvrant la page. */
  pageSelect: string | null;

  load(state: AppState, home: string | null): void;
  /** Enregistre toute la liste (ajout, modification, suppression). */
  save(profiles: Profile[]): Promise<boolean>;
  /** Profil actif du dépôt (`null` : configuration Git) ; il est associé au dépôt au passage. */
  setActive(path: string, id: string | null): Promise<boolean>;
  /** Retire un profil des profils associés au dépôt (et du profil actif). */
  dissociate(path: string, id: string): Promise<void>;
  /** Dépôt sans profil choisi : prend celui que désignent les règles (hôte du remote, dossier). */
  autoSelect(path: string): Promise<void>;
  /** Garde-fou : profil actif qui ne correspond pas au remote. `false` : l'utilisateur annule. */
  confirmIdentity(path: string): Promise<boolean>;
  /** Écrit l'identité du profil actif dans `.git/config`. */
  applyIdentity(path: string): Promise<void>;
  /** Dépôt retiré de la liste. */
  forget(path: string): void;
  openPage(select?: string | null): void;
  closePage(): void;
}

/** Garde-fou déjà accepté pour ce dépôt et ce profil, le temps de la session. */
const acknowledged = new Set<string>();

/** Oublie les garde-fous acceptés (tests). */
export function resetProfileGuards() {
  acknowledged.clear();
}

/** Remote `origin` du dépôt (hôte et chemin). */
const remoteOf = (path: string) => parseRemote(useApp.getState().summaries[path]?.data?.remoteUrl ?? null);

/** Profil actif d'un dépôt (`null` : aucun). */
export function activeProfile(path: string, s: Pick<ProfilesStore, "profiles" | "repoProfiles"> = useProfiles.getState()): Profile | null {
  // `s` : l'état du store (sélecteur React) ; par défaut, l'état courant.
  const id = s.repoProfiles[path]?.active;
  return (id && s.profiles.find((p) => p.id === id)) || null;
}

export const useProfiles = create<ProfilesStore>((set, get) => {
  /** Enregistre les profils d'un dépôt ; en cas d'échec, l'état précédent est remis (le backend
   *  injecterait encore l'ancienne identité) et `false` est renvoyé. */
  const bind = async (path: string, binding: RepoProfiles) => {
    const before = get().repoProfiles[path];
    set((s) => ({ repoProfiles: { ...s.repoProfiles, [path]: binding } }));
    try {
      await api.setRepoProfiles(path, binding);
      return true;
    } catch (e) {
      set((s) => {
        const next = { ...s.repoProfiles };
        if (before) next[path] = before;
        else delete next[path];
        return { repoProfiles: next };
      });
      useApp.setState({ error: errorCode(e) });
      return false;
    }
  };

  return {
    profiles: [],
    repoProfiles: {},
    home: null,
    pageOpen: false,
    pageSelect: null,

    load(state, home) {
      set({ profiles: state.profiles ?? [], repoProfiles: state.repoProfiles ?? {}, home });
    },

    async save(profiles) {
      try {
        const repoProfiles = await api.setProfiles(profiles);
        set({ profiles, repoProfiles });
      } catch (e) {
        useApp.setState({ error: errorCode(e) });
        return false;
      }
      // Une nouvelle règle peut désigner un profil pour les dépôts ouverts qui n'en ont pas.
      for (const path of useApp.getState().tabs) await get().autoSelect(path);
      return true;
    },

    async setActive(path, id) {
      const cur = get().repoProfiles[path] ?? { active: null, allowed: [] };
      const allowed = id && !cur.allowed.includes(id) ? [...cur.allowed, id] : cur.allowed;
      return bind(path, { active: id, allowed });
    },

    async dissociate(path, id) {
      const cur = get().repoProfiles[path];
      if (!cur) return;
      await bind(path, { active: cur.active === id ? null : cur.active, allowed: cur.allowed.filter((a) => a !== id) });
    },

    async autoSelect(path) {
      const { profiles, repoProfiles, home } = get();
      if (repoProfiles[path] || profiles.length === 0) return;
      const summary = useApp.getState().summaries[path];
      // Attend le résumé (hôte du remote) ; un dépôt en erreur n'est pas concerné.
      if (!summary?.data) return;
      const pick = suggestProfile(profiles, { path, remote: remoteOf(path), home });
      if (!pick || get().repoProfiles[path]) return;
      if (!(await bind(path, { active: pick.id, allowed: [pick.id] }))) return;
      const repo = useApp.getState().repos.find((r) => r.path === path)?.name ?? path;
      useApp.getState().notify(t("profiles.autoSelected", { profile: pick.name, repo }));
    },

    async confirmIdentity(path) {
      const { profiles, home } = get();
      const active = activeProfile(path);
      const remote = remoteOf(path);
      const other = hostMismatch(profiles, active?.id ?? null, { path, remote, home });
      if (!active || !other) return true;
      const key = `${path}\n${active.id}`;
      if (acknowledged.has(key)) return true;
      const pick = await useDialogs.getState().choose({
        title: t("profiles.mismatchTitle"),
        body: t("profiles.mismatchBody", { active: active.name, host: remote && remoteLabel(remote), other: other.name }),
        choices: [
          { id: "keep", label: t("profiles.keep", { name: active.name }) },
          { id: "switch", label: t("profiles.switchTo", { name: other.name }) },
        ],
      });
      if (pick === "keep") acknowledged.add(key);
      if (pick === "switch") return get().setActive(path, other.id);
      return pick !== null;
    },

    async applyIdentity(path) {
      const p = activeProfile(path);
      if (!p) return;
      try {
        await api.applyIdentity(path);
        const signing = p.signing ? ` ${t("profiles.appliedSigning")}` : "";
        useApp.getState().notify(t("profiles.applied", { name: p.userName, email: p.userEmail }) + signing);
      } catch (e) {
        useApp.setState({ error: errorCode(e) });
      }
    },

    forget(path) {
      const next = { ...get().repoProfiles };
      delete next[path];
      set({ repoProfiles: next });
    },

    openPage(select = null) {
      set({ pageOpen: true, pageSelect: select });
    },

    closePage() {
      set({ pageOpen: false, pageSelect: null });
    },
  };
});
