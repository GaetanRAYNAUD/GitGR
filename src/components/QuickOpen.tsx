// Sélecteur rapide de dépôts (Ctrl+E) : recherche floue parmi tous les dépôts connus (nom
// puis chemin), ↑ / ↓ (Début, Fin, Pg↑, Pg↓) pour choisir, Entrée pour ouvrir (ou revenir à son
// onglet), Échap pour fermer. Tab reste dans la fenêtre ; le focus revient, à la fermeture, à
// ce qui l'avait.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { trapTab } from "../lib/focusTrap";
import { fuzzyFilter } from "../lib/fuzzy";
import { useDismiss } from "../lib/useDismiss";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { repoColor, repoName, useApp } from "../store/app";
import { Icon } from "./Icon";

export const useQuickOpen = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function QuickOpenHost() {
  const open = useQuickOpen((s) => s.open);
  return open ? <QuickOpen /> : null;
}

const PAGE = 8;

function QuickOpen() {
  const { t } = useTranslation();
  const hide = useQuickOpen((s) => s.hide);
  const repos = useApp((s) => s.repos);
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  useDismiss(ref, true, hide);
  useRestoreFocus();

  // Requête vide : les dépôts récents, sans celui de l'onglet actif (on veut en changer).
  const results = useMemo(
    () => fuzzyFilter(q.trim() ? repos : repos.filter((r) => r.path !== active), q, repoName, (r) => r.path),
    [repos, q, active],
  );
  const at = Math.min(cursor, Math.max(0, results.length - 1));
  // La ligne active reste visible quand la liste défile.
  useEffect(() => {
    document.getElementById(`quick-${at}`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const choose = (path: string) => {
    hide();
    const app = useApp.getState();
    if (app.tabs.includes(path)) app.activate(path);
    else void app.openPath(path);
  };
  const open = () => {
    hide();
    useApp.getState().pickAndOpen(t("welcome.pickTitle"));
  };

  /** Aucun résultat : rien de connu, rien d'autre que l'onglet actif, ou rien qui correspond. */
  const empty = !repos.length ? t("welcome.empty") : !q.trim() ? t("quickOpen.noOther") : t("quickOpen.none");

  return (
    <div className="overlay quick-overlay">
      <div className="dialog quick-open" role="dialog" aria-modal="true" aria-label={t("quickOpen.title")} ref={ref} onKeyDown={(e) => trapTab(e, ref.current)}>
        <label className="search quick-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={q}
            placeholder={t("quickOpen.placeholder")}
            aria-label={t("quickOpen.placeholder")}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={results.length ? "quick-open-list" : undefined}
            aria-activedescendant={results[at] ? `quick-${at}` : undefined}
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              const n = results.length;
              const move: Record<string, number> = { ArrowDown: (at + 1) % (n || 1), ArrowUp: (at + n - 1) % (n || 1), PageDown: Math.min(n - 1, at + PAGE), PageUp: Math.max(0, at - PAGE), Home: 0, End: n - 1 };
              // Début / Fin dans un champ non vide : ils déplacent le curseur du texte.
              if ((e.key === "Home" || e.key === "End") && e.currentTarget.value) return;
              if (e.key in move) {
                e.preventDefault();
                if (n) setCursor(Math.max(0, move[e.key]));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[at]) choose(results[at].path);
                else if (!repos.length) open();
              }
            }}
          />
        </label>
        {results.length === 0 ? (
          <div className="quick-empty">
            <p className="muted">{empty}</p>
            <button type="button" className="link" onClick={open}>
              {t("quickOpen.openOther")}
            </button>
          </div>
        ) : (
          <ul className="quick-list" id="quick-open-list" role="listbox" aria-label={t("quickOpen.title")}>
            {results.map((r, i) => (
              <li
                key={r.path}
                id={`quick-${i}`}
                role="option"
                aria-selected={i === at}
                className={i === at ? "quick-item on" : "quick-item"}
                title={r.path}
                onMouseMove={() => i !== at && setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r.path);
                }}
              >
                <span className="dot" style={{ background: repoColor(r.path, r.color) }} />
                <span className="quick-name">{repoName(r)}</span>
                {/* Chemin coupé au début : la fin (le dossier du dépôt) reste lisible. */}
                <span className="quick-path mono path-tail">
                  <bdi>{r.path}</bdi>
                </span>
                {tabs.includes(r.path) && <span className="quick-tag">{r.path === active ? t("quickOpen.current") : t("quickOpen.open")}</span>}
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && <p className="muted quick-hint">{t("quickOpen.hint")}</p>}
      </div>
    </div>
  );
}
