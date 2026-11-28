// Palette de commandes (Ctrl+P) : toutes les actions de l'app au même endroit, recherche floue,
// raccourci affiché à droite ; dépôt ouvert : ses actions, le checkout de ses branches, les
// autres onglets. ↑ / ↓ (Début, Fin, Pg↑, Pg↓), Entrée pour lancer, Échap pour fermer.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { create } from "zustand";
import { trapTab } from "../lib/focusTrap";
import { fuzzyFilter } from "../lib/fuzzy";
import { SHORTCUTS } from "../lib/shortcuts";
import { useDismiss } from "../lib/useDismiss";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { repoName, useApp } from "../store/app";
import { useBisect } from "../store/bisect";
import { useGraph } from "../store/graph";
import { useGraphFind } from "../store/graphFind";
import { useNotifications } from "../store/notifications";
import { useOps } from "../store/ops";
import { useProfiles } from "../store/profiles";
import { usePublishDialog } from "../store/publish";
import { usePullDialog } from "../store/pulls";
import { useReflogView, useSearchView } from "../store/range";
import { useWork } from "../store/worktree";
import { Icon } from "./Icon";
import { useQuickOpen } from "./QuickOpen";
import { Keys } from "./ShortcutsList";

export const usePalette = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export interface Command {
  id: string;
  label: string;
  /** Groupe affiché à droite (Dépôt, Branches, Onglets…), aussi cherché. */
  group: string;
  /** Raccourci (forme canonique), lu dans la table des raccourcis. */
  keys?: string;
  /** Raison pour laquelle la commande est impossible (grisée, lue). */
  why?: string;
  run(): void;
}

const keysOf = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys[0];

/** Commandes possibles maintenant (onglet actif, branches, état du dépôt). */
export function buildCommands(t: TFunction): Command[] {
  const app = useApp.getState();
  const path = app.active && !app.settingsOpen ? app.active : null;
  const ops = useOps.getState();
  const cmd = (id: string, label: string, group: string, run: () => void, why?: string | null): Command => ({
    id,
    label,
    group,
    keys: keysOf(id),
    why: why ?? undefined,
    run,
  });
  const g = t("palette.groups.app");
  const appCommands: Command[] = [
    cmd("openRepo", t("shortcuts.items.openRepo"), g, () => app.pickAndOpen(t("welcome.pickTitle"))),
    cmd("quickOpen", t("shortcuts.items.quickOpen"), g, () => useQuickOpen.getState().show()),
    cmd("home", t("shortcuts.items.home"), g, () => app.activate(null)),
    cmd("settings", t("palette.settings"), g, () => app.openSettings()),
    cmd("profiles", t("palette.profiles"), g, () => useProfiles.getState().openPage()),
    cmd("shortcuts", t("shortcuts.items.shortcuts"), g, () => {
      useApp.setState({ settingsSection: "keys", settingsOpen: false });
      requestAnimationFrame(() => useApp.getState().openSettings());
    }),
    cmd("notifications", t("shortcuts.items.notifications"), g, () => useNotifications.getState().setPanel(true)),
  ];
  // Dépôt ouvert : ses commandes d'abord (le plus utile sans rien taper), puis celles de l'app.
  const list: Command[] = [];
  if (path) {
    const r = t("palette.groups.repo");
    const refs = useGraph.getState().graphs[path]?.refs ?? null;
    const running = ops.running[path];
    const operation = useWork.getState().repos[path]?.status?.operation ?? null;
    const busy = running ? t("repo.busy") : null;
    const blocked = busy ?? (operation ? t("repo.blockedBy", { op: t(`op.${operation}`) }) : null);
    const detached = !!refs && !refs.headBranch;
    const noRemote = !!refs && refs.remotes.length === 0;
    list.push(
      cmd("refresh", t("shortcuts.items.refresh"), r, () => app.refreshRepo(path)),
      cmd("undo", t("shortcuts.items.undo"), r, () => void ops.replay(path, "undo"), busy),
      cmd("redo", t("shortcuts.items.redo"), r, () => void ops.replay(path, "redo"), busy),
      cmd("fetch", t("shortcuts.items.fetch"), r, () => void ops.fetch(path), noRemote ? t("palette.noRemote") : busy),
      cmd("pull", t("shortcuts.items.pull"), r, () => void ops.pull(path), noRemote ? t("palette.noRemote") : detached ? t("errors.detached_head") : blocked),
      noRemote
        ? cmd("publish", t("publish.button"), r, () => usePublishDialog.getState().show(path), busy)
        : cmd("push", t("shortcuts.items.push"), r, () => void ops.push(path), detached ? t("errors.detached_head") : blocked),
      cmd("branch", t("shortcuts.items.branch"), r, () => void ops.newBranch(path, null, refs?.headBranch ?? "HEAD"), blocked),
      cmd("stash", t("shortcuts.items.stash"), r, () => void ops.stash(path), blocked),
      cmd("pop", t("shortcuts.items.pop"), r, () => void ops.pop(path), refs?.stashes ? blocked : t("palette.noStash")),
      cmd("find", t("shortcuts.items.find"), r, () => useGraphFind.getState().open(path)),
      cmd("authorFilter", t("authorFilter.byAuthorButton"), r, () => useGraphFind.getState().showAuthors(path, [])),
      cmd("searchChanges", t("palette.searchChanges"), r, () => useSearchView.getState().show(path)),
      cmd("reflog", t("palette.reflog"), r, () => useReflogView.getState().show(path, "HEAD")),
      cmd("createPull", t("palette.createPull"), r, () => usePullDialog.getState().show(path), noRemote ? t("palette.noRemote") : null),
    );
    if (useBisect.getState().states[path]) list.push(cmd("bisectStop", t("palette.bisectStop"), r, () => void ops.bisectReset(path), busy));
    const b = t("palette.groups.branches");
    for (const ref of refs?.refs ?? []) {
      if (ref.kind !== "local" || ref.short === refs?.headBranch) continue;
      list.push(cmd(`checkout:${ref.short}`, t("palette.checkout", { branch: ref.short }), b, () => void ops.checkout(path, ref.short), blocked));
    }
  }
  list.push(...appCommands);
  const tabsGroup = t("palette.groups.tabs");
  for (const tab of app.tabs) {
    if (tab === path) continue;
    const entry = app.repos.find((x) => x.path === tab);
    list.push(cmd(`tab:${tab}`, t("palette.goTab", { name: entry ? repoName(entry) : tab }), tabsGroup, () => app.activate(tab)));
  }
  return list;
}

export function CommandPaletteHost() {
  const open = usePalette((s) => s.open);
  return open ? <CommandPalette /> : null;
}

const PAGE = 8;

function CommandPalette() {
  const { t } = useTranslation();
  const hide = usePalette((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  useDismiss(ref, true, hide);
  useRestoreFocus();
  // Lues à l'ouverture : la palette se ferme avant d'agir, rien ne change pendant qu'elle est là.
  const all = useMemo(() => buildCommands(t), [t]);
  const results = useMemo(() => fuzzyFilter(all, q, (c) => c.label, (c) => c.group), [all, q]);
  const at = Math.min(cursor, Math.max(0, results.length - 1));
  useEffect(() => {
    document.getElementById(`palette-${at}`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (c: Command) => {
    if (c.why) {
      useApp.getState().notify(c.why);
      return;
    }
    hide();
    // Après la fermeture (focus rendu) : une fenêtre ouverte par la commande garde le sien.
    requestAnimationFrame(() => c.run());
  };

  return (
    <div className="overlay quick-overlay">
      <div className="dialog quick-open palette" role="dialog" aria-modal="true" aria-label={t("palette.title")} ref={ref} onKeyDown={(e) => trapTab(e, ref.current)}>
        <label className="search quick-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={q}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={results.length ? "palette-list" : undefined}
            aria-activedescendant={results[at] ? `palette-${at}` : undefined}
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              const n = results.length;
              const move: Record<string, number> = { ArrowDown: (at + 1) % (n || 1), ArrowUp: (at + n - 1) % (n || 1), PageDown: Math.min(n - 1, at + PAGE), PageUp: Math.max(0, at - PAGE), Home: 0, End: n - 1 };
              if ((e.key === "Home" || e.key === "End") && e.currentTarget.value) return;
              if (e.key in move) {
                e.preventDefault();
                if (n) setCursor(Math.max(0, move[e.key]));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[at]) run(results[at]);
              }
            }}
          />
        </label>
        {results.length === 0 ? (
          <div className="quick-empty">
            <p className="muted">{t("palette.none")}</p>
          </div>
        ) : (
          <ul className="quick-list" id="palette-list" role="listbox" aria-label={t("palette.title")}>
            {results.map((c, i) => (
              <li
                key={c.id}
                id={`palette-${i}`}
                role="option"
                aria-selected={i === at}
                aria-disabled={c.why ? true : undefined}
                aria-description={c.why}
                className={[i === at ? "quick-item on" : "quick-item", c.why && "disabled"].filter(Boolean).join(" ")}
                title={c.why}
                onMouseMove={() => i !== at && setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(c);
                }}
              >
                <span className="quick-name">{c.label}</span>
                <span className="quick-path">{c.group}</span>
                {c.keys && <Keys combo={c.keys} />}
              </li>
            ))}
          </ul>
        )}
        <p className="muted quick-hint">{t("palette.hint")}</p>
      </div>
    </div>
  );
}
