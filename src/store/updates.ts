// Mises à jour de GitGR : vérification (au démarrage, en silence, et depuis les Réglages),
// annonce de la nouvelle version, téléchargement et installation, puis redémarrage.

import { create } from "zustand";
import i18n from "../i18n";
import { api, errorCode } from "../lib/api";
import type { InstallKind, UpdateInfo } from "../lib/types";
import { releaseUrl, updateMode } from "../lib/updates";
import { useApp } from "./app";

export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "installing" | "error";

interface UpdatesState {
  /** Paquet installé ; `null` tant qu'il n'est pas connu. */
  kind: InstallKind | null;
  status: UpdateStatus;
  /** Version disponible (statut `available` ou `installing`). */
  update: UpdateInfo | null;
  /** Avancement du téléchargement, en pourcentage ; `null` : taille inconnue. */
  percent: number | null;
  /** Dernière erreur (vérification ou installation). */
  error: string | null;
  /** Lit le manifeste de la dernière release. `silent` (démarrage) : une nouvelle version est
   *  annoncée par un message, une erreur (hors ligne…) est ignorée. */
  check(silent?: boolean): Promise<void>;
  /** Télécharge et installe la version disponible, puis redémarre. */
  install(): Promise<void>;
}

const t = (key: string, opts: Record<string, unknown> = {}) => i18n.t(key, opts);

async function loadKind(): Promise<InstallKind> {
  const known = useUpdates.getState().kind;
  if (known) return known;
  const kind = await api.installKind().catch((): InstallKind => "none");
  useUpdates.setState({ kind });
  return kind;
}

/** Message de l'app qui annonce la version `update`. */
function announce(update: UpdateInfo, kind: InstallKind) {
  const notes = { label: t("updates.notes"), onClick: () => void api.openUrl(releaseUrl(update.version)).catch(() => {}), keep: true };
  if (updateMode(kind) === "auto") {
    useApp.getState().notify(t("updates.available", { version: update.version }), false, [
      { label: t("updates.install"), onClick: () => void useUpdates.getState().install() },
      notes,
    ]);
  } else {
    useApp.getState().notify(t("updates.availableManual", { version: update.version }), false, [notes]);
  }
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  kind: null,
  status: "idle",
  update: null,
  percent: null,
  error: null,

  async check(silent = false) {
    const kind = await loadKind();
    if (updateMode(kind) === "none" || get().status === "checking" || get().status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const update = await api.checkUpdate();
      set({ status: update ? "available" : "upToDate", update });
      if (update && silent) announce(update, kind);
    } catch (e) {
      // Au démarrage, pas de message pour un réseau absent ou un manifeste illisible.
      set(silent ? { status: "idle" } : { status: "error", error: errorCode(e) });
    }
  },

  async install() {
    const { update, kind, status } = get();
    if (!update || !kind || updateMode(kind) !== "auto" || status === "installing") return;
    set({ status: "installing", percent: 0, error: null });
    const progress = (percent: number | null) =>
      useApp.getState().notify(percent === null ? t("updates.downloadingUnknown") : t("updates.downloading", { percent }), true);
    progress(0);
    try {
      await api.installUpdate((done, total) => {
        const percent = total ? Math.min(100, Math.round((done / total) * 100)) : null;
        // Un appel par bloc téléchargé : le message ne change qu'avec le pourcentage.
        if (percent === get().percent) return;
        set({ percent });
        progress(percent);
      });
      // Sous Windows l'installateur ferme GitGR ; ailleurs l'app redémarre.
      useApp.getState().notify(t("updates.restarting"), true);
    } catch (e) {
      const error = errorCode(e);
      set({ status: "error", error, percent: null });
      useApp.getState().notify(t("updates.installFailed", { error }), true);
    }
  },
}));
