// Liste des raccourcis clavier (Réglages → Raccourcis clavier, F1) : groupés par zone, avec une
// recherche sur le libellé ou les touches.

import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { filterShortcuts, keyLabel, keyParts, SHORTCUTS, ZONES, type Shortcut } from "../lib/shortcuts";

export function Keys({ combo }: { combo: string }) {
  const { t } = useTranslation();
  const names = t("shortcuts.keyNames", { returnObjects: true }) as Record<string, string>;
  const parts = keyParts(combo);
  return (
    <span className="kbd-combo">
      {parts.map((k, i) => (
        <kbd key={i}>{keyLabel(k, names)}</kbd>
      ))}
    </span>
  );
}

export function ShortcutsList() {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState("");
  const names = t("shortcuts.keyNames", { returnObjects: true }) as Record<string, string>;
  const label = (s: Shortcut) => t(`shortcuts.items.${s.id}`);
  const combo = (k: string) => keyParts(k).map((p) => keyLabel(p, names)).join("+");
  const shown = useMemo(() => filterShortcuts(SHORTCUTS, query, label, combo), [query, t]);

  return (
    <div className="shortcuts">
      <input
        className="pf-input shortcuts-search"
        type="search"
        value={query}
        placeholder={t("shortcuts.search")}
        aria-label={t("shortcuts.search")}
        aria-controls={`${id}-list`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Échap vide la recherche avant de fermer la page.
          if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      <div id={`${id}-list`} role="status" className="visually-hidden">
        {query ? t("shortcuts.count", { count: shown.length }) : ""}
      </div>
      {shown.length === 0 && <p className="muted">{t("shortcuts.none")}</p>}
      {ZONES.map((zone) => {
        const rows = shown.filter((s) => s.zone === zone);
        if (!rows.length) return null;
        return (
          <section key={zone} className="shortcuts-zone" aria-labelledby={`${id}-${zone}`}>
            <h3 id={`${id}-${zone}`} className="eyebrow">
              {t(`shortcuts.zones.${zone}`)}
            </h3>
            <table className="shortcuts-table">
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>{label(s)}</td>
                    <td className="shortcuts-keys">
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="muted"> {t("shortcuts.or")} </span>}
                          <Keys combo={k} />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
