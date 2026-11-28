import { useEffect, useState } from "react";
import { startNotifications, useNotifications } from "./store/notifications";
import { useTranslation } from "react-i18next";
import { ContextMenuHost } from "./components/ContextMenu";
import { BranchColorPopoverHost } from "./components/BranchColorPopover";
import { DialogHost } from "./components/DialogHost";
import { QuickOpenHost, useQuickOpen } from "./components/QuickOpen";
import { CommandPaletteHost, usePalette } from "./components/CommandPalette";
import { ReleaseDialogHost } from "./components/ReleaseDialog";
import { GitMissing } from "./components/GitMissing";
import { Icon } from "./components/Icon";
import { TitleBar } from "./components/TitleBar";
import { resolveLanguage } from "./i18n";
import { api } from "./lib/api";
import { dueTab } from "./lib/autoFetch";
import { errorMessage } from "./lib/errors";
import { useUpdates } from "./store/updates";
import { useApp } from "./store/app";
import { useOps } from "./store/ops";
import { PublishDialogHost } from "./components/PublishDialog";
import { PullDialogHost } from "./components/PullDialog";
import { useProfiles } from "./store/profiles";
import { ProfilesPage } from "./views/ProfilesPage";
import { SettingsPage } from "./views/SettingsPage";
import { RepoView } from "./views/RepoView";
import { Welcome } from "./views/Welcome";

/** Applique le thème choisi (ou celui de l'OS) via `data-theme` sur <html>. */
function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const effective = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = effective;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function useLanguage() {
  const language = useApp((s) => s.settings.language);
  const { i18n } = useTranslation();
  useEffect(() => {
    const lng = resolveLanguage(language);
    if (i18n.language !== lng) i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
  }, [language, i18n]);
}

/** Saisie de texte en cours : Ctrl+Z / Ctrl+Y y gardent leur sens (annuler la frappe). */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** Fenêtre modale ouverte (confirmation, saisie, sélecteur rapide…) : les raccourcis qui
 *  agissent derrière elle (onglets, annuler, graphe) attendent qu'elle soit fermée. Le panneau
 *  des notifications, non modal, ne compte pas. */
const modalOpen = () => !!document.querySelector('[aria-modal="true"]');

/** Raccourcis globaux : Ctrl+Tab, Ctrl+W, Ctrl+T, Ctrl+O, Ctrl+1..9, F5,
 *  Ctrl+Maj+PageUp / PageDown pour déplacer l'onglet actif, Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z)
 *  pour annuler / rétablir la dernière opération git du dépôt actif, Ctrl+E pour le sélecteur
 *  rapide de dépôts, Ctrl+G pour revenir au graphe, Ctrl+Maj+N pour les notifications, F6
 *  pour aller au message affiché en bas (et à ses boutons), F1 pour la liste des raccourcis,
 *  Ctrl+P pour la palette de commandes. */
function useShortcuts() {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      // Sous une fenêtre modale, rien ne change derrière elle (onglet, dépôt) : le sélecteur
      // rapide seul répond encore à Ctrl+E (pour se fermer).
      const modal = modalOpen() && !useQuickOpen.getState().open;
      const tabKeys = ctrl && (e.key === "Tab" || e.key === "PageUp" || e.key === "PageDown" || /^[1-9wWtT]$/.test(e.key));
      if (modal && (tabKeys || e.key === "F5")) return;
      // Changer d'onglet ferme le sélecteur rapide (ses repères « onglet actif » seraient faux).
      if (tabKeys) useQuickOpen.getState().hide();
      if (ctrl && e.shiftKey && (e.key === "PageUp" || e.key === "PageDown")) {
        if (s.active) s.moveTab(s.active, s.tabs.indexOf(s.active) + (e.key === "PageUp" ? -1 : 1));
      } else if (ctrl && e.key === "Tab") {
        s.cycleTab(e.shiftKey ? -1 : 1);
      } else if (ctrl && e.key.toLowerCase() === "w") {
        if (s.active) s.closeTab(s.active);
      } else if (ctrl && e.key.toLowerCase() === "t") {
        s.activate(null);
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "e") {
        if (modal) return;
        const q = useQuickOpen.getState();
        if (q.open) q.hide();
        else q.show();
      } else if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        // Palette de commandes (une seconde fois : la refermer).
        if (modal && !usePalette.getState().open) return;
        const p = usePalette.getState();
        if (p.open) p.hide();
        else {
          useQuickOpen.getState().hide();
          p.show();
        }
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "o") {
        if (modal) return;
        s.pickAndOpen(t("welcome.pickTitle"));
      } else if (ctrl && /^[1-9]$/.test(e.key)) {
        // Ctrl+9 : le dernier onglet, comme dans les navigateurs.
        const path = e.key === "9" ? s.tabs[s.tabs.length - 1] : s.tabs[Number(e.key) - 1];
        if (path) s.activate(path);
      } else if (ctrl && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        // Pas dans un champ, ni sous une fenêtre (dialogue de saisie ou de confirmation).
        if (!s.active || typing(e.target) || modalOpen()) return;
        void useOps.getState().replay(s.active, e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
      } else if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "g") {
        // Revient au graphe (l'écran principal) depuis n'importe quel panneau.
        const graph = document.querySelector<HTMLElement>(".graph-scroll");
        if (!graph || modalOpen()) return;
        graph.focus();
      } else if (ctrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        if (modal) return;
        const n = useNotifications.getState();
        // Refermé depuis le panneau : le focus revient à la cloche.
        const inPanel = !!document.activeElement?.closest(".notif-panel");
        n.setPanel(!n.panelOpen);
        if (inPanel) requestAnimationFrame(() => document.querySelector<HTMLElement>(".notif-wrap > button")?.focus());
      } else if (e.key === "F6" && !ctrl && !e.altKey) {
        // Le message affiché en bas (« Annuler » après une suppression…) : son premier bouton.
        const toast = document.querySelector<HTMLElement>(".toast button");
        if (!toast || modal) return;
        toast.focus();
      } else if (e.key === "F1" && !ctrl && !e.altKey && !e.shiftKey) {
        // Liste des raccourcis clavier (réglages).
        if (modal) return;
        useApp.setState({ settingsSection: "keys" });
        if (s.settingsOpen) useApp.setState({ settingsOpen: false });
        requestAnimationFrame(() => useApp.getState().openSettings());
      } else if (e.key === "F5") {
        if (s.active) s.refreshRepo(s.active);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);
}

/** Rafraîchit le dépôt actif quand la fenêtre reprend le focus (modifs faites ailleurs), et le
 *  résumé des autres onglets. */
function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => {
      const { active, tabs, refreshRepo, refreshSummary } = useApp.getState();
      if (active) refreshRepo(active);
      // Les autres onglets : seulement leur résumé (indicateur de travail en attente).
      for (const p of tabs) if (p !== active) void refreshSummary(p);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}

/** Surveille le dépôt de l'onglet actif : une modification faite ailleurs (terminal, éditeur,
 *  autre outil git) le rafraîchit sans attendre le retour du focus. */
function useWatchActiveRepo() {
  const active = useApp((s) => s.active);
  useEffect(() => {
    api.watchRepo(active).catch(() => {});
  }, [active]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let gone = false;
    api
      .onRepoChanged((path) => {
        const { active: current, refreshRepo } = useApp.getState();
        if (path === current) refreshRepo(path);
      })
      .then((u) => (gone ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}

/** Fetch automatique du dépôt actif : à l'ouverture de l'onglet, puis toutes les N minutes
 *  (réglage `autoFetchMinutes`, 0 = jamais). Silencieux : une erreur réseau n'est pas affichée. */
const lastFetch = new Map<string, number>();
const FETCH_TICK_MS = 30_000;

function useAutoFetch() {
  const active = useApp((s) => s.active);
  const minutes = useApp((s) => s.settings.autoFetchMinutes) ?? 10;
  useEffect(() => {
    if (!active || minutes <= 0) return;
    const tick = () => {
      const last = lastFetch.get(active) ?? 0;
      // Une commande en cours : on réessaie au prochain passage, pas dans N minutes.
      if (Date.now() - last < minutes * 60_000 || useOps.getState().running[active]) return;
      lastFetch.set(active, Date.now());
      useOps.getState().fetch(active, true);
    };
    tick();
    const id = setInterval(tick, FETCH_TICK_MS);
    return () => clearInterval(id);
  }, [active, minutes]);

  // Les autres onglets aussi, deux fois moins souvent et un seul à la fois : leur retard (↓
  // dans l'onglet, à l'accueil) reste à jour sans les ouvrir. Juste le fetch et le résumé,
  // pas le graphe : rien à recharger tant que l'onglet n'est pas affiché.
  const tabs = useApp((s) => s.tabs);
  useEffect(() => {
    if (minutes <= 0) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      const app = useApp.getState();
      const due = dueTab(tabs, app.active, (p) => !!useOps.getState().running[p], (p) => lastFetch.get(p) ?? 0, Date.now(), 2 * minutes * 60_000);
      if (!due) return;
      busy = true;
      lastFetch.set(due, Date.now());
      try {
        await api.fetch(due);
        await useApp.getState().refreshSummary(due);
      } catch {
        // Silencieux, comme le fetch automatique du dépôt affiché.
      } finally {
        busy = false;
      }
    };
    // Premier passage après un moment : l'ouverture de l'app reste légère.
    const first = setTimeout(() => void tick(), FETCH_TICK_MS);
    const id = setInterval(() => void tick(), FETCH_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [tabs, minutes]);
}

/** Pas de menu du navigateur (Recharger, Inspecter…) : nos propres menus le remplacent.
 *  Gardé dans les champs de saisie, pour copier / coller. */
function useNoBrowserMenu() {
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);
}

/** Message d'information ; ceux qui ne sont pas `sticky` disparaissent seuls, sauf tant que
 *  la souris est dessus ou qu'un de ses boutons a le focus (le temps d'y aller : F6). */
function Notice() {
  const { t } = useTranslation();
  const notice = useApp((s) => s.notice);
  const dismiss = useApp((s) => s.dismissNotice);
  const [held, setHeld] = useState(false);
  // Nouveau message : le précédent, retiré sous la souris ou avec le focus, ne le retient plus.
  useEffect(() => setHeld(false), [notice?.id]);
  useEffect(() => {
    if (!notice || notice.sticky || held) return;
    // Avec des boutons : le temps de les lire et d'y aller.
    const id = setTimeout(dismiss, notice.actions?.length ? 10000 : 4000);
    return () => clearTimeout(id);
  }, [notice, dismiss, held]);
  if (!notice) return null;
  return (
    <div
      className={notice.sticky ? "toast info warn" : "toast info"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHeld(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.nativeEvent.stopPropagation();
          dismiss();
        }
      }}
    >
      <Icon name={notice.sticky ? "alert" : "check"} />
      <span>{notice.text}</span>
      {notice.actions?.map((a) => (
        <button
          key={a.label}
          className="link notice-action"
          onClick={() => {
            a.onClick();
            if (!a.keep) dismiss();
          }}
        >
          {a.label}
        </button>
      ))}
      <button className="link" onClick={dismiss}>
        {t("errors.dismiss")}
      </button>
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const ready = useApp((s) => s.ready);
  // Notifications des providers : lancées une fois l'état (comptes, réglages) chargé.
  useEffect(() => {
    if (ready) startNotifications();
  }, [ready]);
  // Mises à jour de GitGR : une vérification silencieuse au démarrage ; la version
  // téléchargée s'installe à la fermeture de la fenêtre.
  useEffect(() => {
    if (!ready) return;
    void useUpdates.getState().check(true);
    let unlisten: (() => void) | null = null;
    let gone = false;
    // Jamais d'erreur renvoyée : Tauri attend ce gestionnaire avant de fermer la fenêtre.
    const onClose = () => useUpdates.getState().installOnClose().catch(() => {});
    void api.window.onCloseRequested(onClose).then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [ready]);
  const git = useApp((s) => s.git);
  const active = useApp((s) => s.active);
  const error = useApp((s) => s.error);
  const dismissError = useApp((s) => s.dismissError);
  const errorActions = useApp((s) => (s.errorActions && s.errorActions.for === s.error ? s.errorActions.actions : null));
  const init = useApp((s) => s.init);
  const profilesOpen = useProfiles((s) => s.pageOpen);
  const settingsOpen = useApp((s) => s.settingsOpen);

  useEffect(() => {
    init();
  }, [init]);
  useTheme();
  useLanguage();
  useShortcuts();
  useRefreshOnFocus();
  useWatchActiveRepo();
  useAutoFetch();
  useNoBrowserMenu();

  return (
    <div className="app">
      <TitleBar />
      <main className="content">
        {ready && (settingsOpen ? <SettingsPage /> : profilesOpen ? <ProfilesPage /> : active ? <RepoView key={active} path={active} /> : <Welcome />)}
      </main>

      {/* Messages en bas, empilés (une erreur ne cache pas un « Annuler » en cours). La zone
          reste dans la page : les lecteurs d'écran annoncent ce qui y apparaît. */}
      <div className="toast-stack">
        <div>
          {error && (
            <div className="toast error" role="alert">
              <Icon name="alert" />
              <span>{errorMessage(t, error)}</span>
              {errorActions?.map((a) => (
                <button
                  key={a.label}
                  className="link notice-action"
                  onClick={() => {
                    dismissError();
                    a.onClick();
                  }}
                >
                  {a.label}
                </button>
              ))}
              <button className="link" onClick={dismissError}>
                {t("errors.dismiss")}
              </button>
            </div>
          )}
        </div>
        <div role="status" aria-live="polite">
          <Notice />
        </div>
      </div>

      <PullDialogHost />
      <PublishDialogHost />
      <DialogHost />
      <QuickOpenHost />
      <CommandPaletteHost />
      <ReleaseDialogHost />
      <BranchColorPopoverHost />
      <ContextMenuHost />
      {ready && git && !git.found && <GitMissing />}
    </div>
  );
}
