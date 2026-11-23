import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { InstallKind, UpdateInfo } from "../lib/types";
import { releaseUrl, updateMode } from "../lib/updates";
import { useApp } from "./app";
import { useUpdates } from "./updates";

type MockWindow = {
  __mockInstallKind?: InstallKind;
  __mockUpdate?: UpdateInfo | null;
  __mockUpdateError?: string;
  __mockRelaunched?: boolean;
  __mockDownloaded?: boolean;
  __mockDownloadError?: string;
  __mockInstalled?: boolean;
};
const w = window as unknown as MockWindow;
const UPDATE: UpdateInfo = { version: "0.2.0", notes: "Nouveautés", date: null };

beforeEach(() => {
  vi.restoreAllMocks();
  delete w.__mockInstallKind;
  delete w.__mockUpdate;
  delete w.__mockUpdateError;
  delete w.__mockRelaunched;
  delete w.__mockDownloaded;
  delete w.__mockDownloadError;
  delete w.__mockInstalled;
  useUpdates.setState({ kind: null, status: "idle", update: null, percent: null, error: null });
  useApp.setState((s) => ({ notice: null, settings: { ...s.settings, autoUpdateOff: false } }));
});

describe("paquets", () => {
  it("dit qui fait la mise à jour", () => {
    expect(updateMode("nsis")).toBe("auto");
    expect(updateMode("appimage")).toBe("auto");
    expect(updateMode("app")).toBe("auto");
    expect(updateMode("deb")).toBe("manual");
    expect(updateMode("rpm")).toBe("manual");
    expect(updateMode("none")).toBe("none");
  });

  it("page de la release d'une version", () => {
    expect(releaseUrl("0.2.0")).toBe("https://github.com/GaetanRAYNAUD/GitGR/releases/tag/v0.2.0");
    expect(releaseUrl("v0.2.0")).toBe("https://github.com/GaetanRAYNAUD/GitGR/releases/tag/v0.2.0");
  });
});

describe("vérification", () => {
  it("au démarrage, télécharge la nouvelle version en arrière-plan, sans l'installer", async () => {
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check(true);
    expect(useUpdates.getState()).toMatchObject({ status: "ready", update: UPDATE, kind: "nsis" });
    expect(w.__mockDownloaded).toBe(true);
    expect(w.__mockInstalled).toBeUndefined();
    const notice = useApp.getState().notice!;
    expect(notice).toMatchObject({ text: "GitGR 0.2.0 est prête : elle s'installera à la fermeture de GitGR.", sticky: false });
    expect(notice.actions?.map((a) => a.label)).toEqual(["Redémarrer maintenant", "Nouveautés"]);
  });

  it("installation automatique désactivée : annonce seulement, « Installer et redémarrer »", async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, autoUpdateOff: true } }));
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check(true);
    expect(useUpdates.getState().status).toBe("available");
    expect(w.__mockDownloaded).toBeUndefined();
    const notice = useApp.getState().notice!;
    expect(notice.text).toBe("GitGR 0.2.0 est disponible.");
    expect(notice.actions?.map((a) => a.label)).toEqual(["Installer et redémarrer", "Nouveautés"]);
  });

  it("téléchargement en échec : la version reste proposée, à installer à la main", async () => {
    w.__mockUpdate = UPDATE;
    w.__mockDownloadError = "network down";
    await useUpdates.getState().check(true);
    expect(useUpdates.getState().status).toBe("available");
    expect(useApp.getState().notice?.actions?.map((a) => a.label)).toEqual(["Installer et redémarrer", "Nouveautés"]);
  });

  it("à jour : aucun message au démarrage", async () => {
    await useUpdates.getState().check(true);
    expect(useUpdates.getState().status).toBe("upToDate");
    expect(useApp.getState().notice).toBeNull();
  });

  it("deb / rpm : prévient seulement, sans installer", async () => {
    w.__mockInstallKind = "deb";
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check(true);
    const notice = useApp.getState().notice!;
    expect(notice.text).toContain("gestionnaire de paquets");
    expect(notice.actions?.map((a) => a.label)).toEqual(["Nouveautés"]);
    const install = vi.spyOn(api, "installUpdate");
    await useUpdates.getState().install();
    expect(install).not.toHaveBeenCalled();
  });

  it("build de développement : ne vérifie rien", async () => {
    w.__mockInstallKind = "none";
    const check = vi.spyOn(api, "checkUpdate");
    await useUpdates.getState().check();
    expect(check).not.toHaveBeenCalled();
    expect(useUpdates.getState().status).toBe("idle");
  });

  it("erreur : silencieuse au démarrage, affichée depuis les Réglages", async () => {
    w.__mockUpdateError = "network down";
    await useUpdates.getState().check(true);
    expect(useUpdates.getState()).toMatchObject({ status: "idle", error: null });
    expect(useApp.getState().notice).toBeNull();
    await useUpdates.getState().check();
    expect(useUpdates.getState()).toMatchObject({ status: "error", error: "network down" });
  });
});

describe("installation", () => {
  it("à la fermeture : installe la version téléchargée, sans relance", async () => {
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check(true);
    await useUpdates.getState().installOnClose();
    expect(w.__mockInstalled).toBe(true);
    expect(w.__mockRelaunched).toBeUndefined();
  });

  it("à la fermeture : rien sans version téléchargée, ni si l'installation automatique est désactivée", async () => {
    await useUpdates.getState().installOnClose();
    expect(w.__mockInstalled).toBeUndefined();
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check(true);
    useApp.setState((s) => ({ settings: { ...s.settings, autoUpdateOff: true } }));
    await useUpdates.getState().installOnClose();
    expect(w.__mockInstalled).toBeUndefined();
  });

  it("« Redémarrer maintenant » : installe la version téléchargée puis redémarre", async () => {
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check();
    await useUpdates.getState().install();
    expect(w.__mockInstalled).toBe(true);
    expect(w.__mockRelaunched).toBe(true);
    expect(useApp.getState().notice?.text).toBe("Mise à jour installée, redémarrage de GitGR…");
  });

  it("sans téléchargement préalable : télécharge avec progression, installe puis redémarre", async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, autoUpdateOff: true } }));
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check();
    await useUpdates.getState().install();
    expect(useUpdates.getState().percent).toBe(100);
    expect(w.__mockRelaunched).toBe(true);
  });

  it("échec : message qui reste, nouvel essai possible", async () => {
    w.__mockUpdate = UPDATE;
    await useUpdates.getState().check();
    vi.spyOn(api, "installUpdate").mockRejectedValueOnce("signature invalide");
    await useUpdates.getState().install();
    expect(useUpdates.getState()).toMatchObject({ status: "error", error: "signature invalide", update: UPDATE });
    expect(useApp.getState().notice).toMatchObject({ text: "La mise à jour n'a pas pu être installée : signature invalide", sticky: true });
    await useUpdates.getState().install();
    expect(w.__mockRelaunched).toBe(true);
  });
});
