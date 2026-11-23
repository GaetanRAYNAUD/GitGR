// Mises à jour de GitGR : vérification (au démarrage, en silence, et depuis les Réglages),
// puis, par défaut, téléchargement en arrière-plan et installation à la fermeture de l'app,
// sans interrompre le travail. « Redémarrer maintenant » installe tout de suite. Réglage
// `autoUpdateOff` : la nouvelle version est seulement annoncée, installée à la demande.

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import type { InstallKind, UpdateInfo } from "../lib/types";
import { releaseUrl, updateMode } from "../lib/updates";
import { useApp } from "./app";

/** `downloading` : téléchargement en arrière-plan ; `ready` : téléchargée, installée à la
 *  fermeture ; `installing` : installation demandée (redémarrage ou fermeture). */
export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "installing" | "error";

interface UpdatesState {
  /** Paquet installé ; `null` tant qu'il n'est pas connu. */
  kind: InstallKind | null;
  status: UpdateStatus;
  /** Version disponible (statuts `available` à `installing`). */
  update: UpdateInfo | null;
  /** Avancement du téléchargement, en pourcentage ; `null` : taille inconnue. */
  percent: number | null;
  /** Dernière erreur (vérification ou installation). */
  error: string | null;
  /** Lit le manifeste de la dernière release ; une nouvelle version est téléchargée en
   *  arrière-plan (installation automatique) ou annoncée. `silent` (démarrage) : une erreur
   *  (hors ligne…) est ignorée. */
  check(silent?: boolean): Promise<void>;
  /** Télécharge en arrière-plan la version disponible, installée ensuite à la fermeture. */
  download(): Promise<void>;
  /** Installe la version disponible tout de suite, puis redémarre. */
  install(): Promise<void>;
  /** Fermeture de l'app : installe la version téléchargée, sans relance. */
  installOnClose(): Promise<void>;
}

const t = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts);

/** Installation automatique : réglage, activée par défaut. */
const autoInstall = () => !useApp.getState().settings.autoUpdateOff;

async function loadKind(): Promise<InstallKind> {
  const known = useUpdates.getState().kind;
  if (known) return known;
  const kind = await api.installKind().catch((): InstallKind => "none");
  useUpdates.setState({ kind });
  return kind;
}

const notesAction = (update: UpdateInfo) => ({
  label: t("updates.notes"),
  onClick: () => void api.openUrl(releaseUrl(update.version)).catch(() => {}),
  keep: true,
});

/** Message de l'app qui annonce la version `update` (sans installation automatique). */
function announce(update: UpdateInfo, kind: InstallKind) {
  if (updateMode(kind) === "auto") {
    useApp.getState().notify(t("updates.available", { version: update.version }), false, [
      { label: t("updates.install"), onClick: () => void useUpdates.getState().install() },
      notesAction(update),
    ]);
  } else {
    useApp.getState().notify(t("updates.availableManual", { version: update.version }), false, [notesAction(update)]);
  }
}

/** Pourcentage d'un téléchargement ; `null` : taille inconnue. */
const percentOf = (done: number, total: number | null) => (total ? Math.min(100, Math.round((done / total) * 100)) : null);

export const useUpdates = create<UpdatesState>((set, get) => ({
  kind: null,
  status: "idle",
  update: null,
  percent: null,
  error: null,

  async check(silent = false) {
    const kind = await loadKind();
    const busy = ["checking", "downloading", "ready", "installing"] as const;
    if (updateMode(kind) === "none" || (busy as readonly string[]).includes(get().status)) return;
    set({ status: "checking", error: null });
    let update: UpdateInfo | null;
    try {
      update = await api.checkUpdate();
    } catch (e) {
      // Au démarrage, pas de message pour un réseau absent ou un manifeste illisible.
      set(silent ? { status: "idle" } : { status: "error", error: errorCode(e) });
      return;
    }
    set({ status: update ? "available" : "upToDate", update });
    if (!update) return;
    if (updateMode(kind) === "auto" && autoInstall()) await get().download();
    else if (silent) announce(update, kind);
  },

  async download() {
    const { update, kind, status } = get();
    if (!update || !kind || updateMode(kind) !== "auto" || status !== "available") return;
    set({ status: "downloading", percent: 0, error: null });
    try {
      await api.downloadUpdate((done, total) => {
        const percent = percentOf(done, total);
        if (percent !== get().percent) set({ percent });
      });
    } catch {
      // Téléchargement en échec (réseau…) : la version reste proposée, à installer à la main.
      set({ status: "available", percent: null });
      announce(update, kind);
      return;
    }
    set({ status: "ready", percent: null });
    useApp.getState().notify(t("updates.ready", { version: update.version }), false, [
      { label: t("updates.restartNow"), onClick: () => void get().install() },
      notesAction(update),
    ]);
  },

  async install() {
    const { update, kind, status } = get();
    if (!update || !kind || updateMode(kind) !== "auto" || status === "installing" || status === "downloading") return;
    const downloaded = status === "ready";
    set({ status: "installing", percent: downloaded ? null : 0, error: null });
    const progress = (percent: number | null) =>
      useApp.getState().notify(percent === null ? t("updates.downloadingUnknown") : t("updates.downloading", { percent }), true);
    if (!downloaded) progress(0);
    else useApp.getState().notify(t("updates.installing"), true);
    try {
      await api.installUpdate((done, total) => {
        const percent = percentOf(done, total);
        // Un appel par bloc téléchargé : le message ne change qu'avec le pourcentage.
        if (percent === get().percent) return;
        set({ percent });
        progress(percent);
      });
      // Sous Windows l'installateur ferme GitGR et le relance ; ailleurs l'app redémarre.
      useApp.getState().notify(t("updates.restarting"), true);
    } catch (e) {
      const error = errorCode(e);
      set({ status: "error", error, percent: null });
      useApp.getState().notify(t("updates.installFailed", { error }), true);
    }
  },

  async installOnClose() {
    if (get().status !== "ready" || !autoInstall()) return;
    set({ status: "installing" });
    try {
      // Sans relance : l'utilisateur ferme GitGR. Sous Windows l'installateur (silencieux)
      // termine l'app ; ailleurs la fenêtre se ferme ensuite normalement.
      await api.installUpdate(() => {}, false);
    } catch {
      // Échec : GitGR se ferme quand même ; la version sera proposée au prochain démarrage.
      set({ status: "ready" });
    }
  },
}));
