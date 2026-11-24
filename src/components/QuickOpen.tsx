// Sélecteur rapide de dépôts (Ctrl+E) : recherche floue parmi tous les dépôts connus (nom
// puis chemin), ↑ / ↓ pour choisir, Entrée pour ouvrir (ou revenir à son onglet), Échap pour
// fermer.

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { fuzzyFilter } from "../lib/fuzzy";
import { useDismiss } from "../lib/useDismiss";
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

  // Requête vide : les dépôts récents, sans celui de l'onglet actif (on veut en changer).
  const results = useMemo(
    () => fuzzyFilter(q.trim() ? repos : repos.filter((r) => r.path !== active), q, repoName, (r) => r.path),
    [repos, q, active],
  );
  const at = Math.min(cursor, Math.max(0, results.length - 1));
  const choose = (path: string) => {
    hide();
    const app = useApp.getState();
    if (app.tabs.includes(path)) app.activate(path);
    else void app.openPath(path);
  };

  return (
    <div className="overlay quick-overlay">
      <div className="dialog quick-open" role="dialog" aria-modal="true" aria-label={t("quickOpen.title")} ref={ref}>
        <label className="search quick-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={q}
            placeholder={t("quickOpen.placeholder")}
            aria-label={t("quickOpen.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-open-list"
            aria-activedescendant={results[at] ? `quick-${at}` : undefined}
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = results.length;
                if (n) setCursor((at + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[at]) choose(results[at].path);
              }
            }}
          />
        </label>
        {results.length === 0 ? (
          <p className="muted quick-empty">{repos.length ? t("quickOpen.none") : t("welcome.empty")}</p>
        ) : (
          <ul className="quick-list" id="quick-open-list" role="listbox" aria-label={t("quickOpen.title")}>
            {results.map((r, i) => (
              <li
                key={r.path}
                id={`quick-${i}`}
                role="option"
                aria-selected={i === at}
                className={i === at ? "quick-item on" : "quick-item"}
                onMouseMove={() => i !== at && setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r.path);
                }}
              >
                <span className="dot" style={{ background: repoColor(r.path, r.color) }} />
                <span className="quick-name">{repoName(r)}</span>
                <span className="quick-path mono">{r.path}</span>
                {tabs.includes(r.path) && <span className="quick-tag">{r.path === active ? t("quickOpen.current") : t("quickOpen.open")}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted quick-hint">{t("quickOpen.hint")}</p>
      </div>
    </div>
  );
}
