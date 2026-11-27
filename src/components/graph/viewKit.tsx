// Briques communes des vues ouvertes à la place du graphe (historique, blame, reflog,
// recherche, plage, stash) : date courte d'un commit, bandeau d'erreur avec « Réessayer »,
// clavier d'une liste de commits à une tabulation.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { commitDate } from "../../lib/format";
import { Icon } from "../Icon";

/** Date d'un commit comme dans le graphe : relative sur les 7 derniers jours, sinon courte ;
 *  `full` : la date complète (infobulle). */
export function useCommitWhen() {
  const { t, i18n } = useTranslation();
  const when = (seconds: number) => {
    const d = commitDate(seconds * 1000, i18n.language);
    return d.key === "date" ? d.text : t(`time.${d.key}`, { count: d.count });
  };
  const full = (seconds: number) => new Date(seconds * 1000).toLocaleString(i18n.language);
  return { when, full };
}

/** Erreur en bandeau au-dessus du contenu déjà affiché, avec « Réessayer ». */
export function RetryNotice({ error, onRetry, children }: { error: string; onRetry?: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="notice error blame-error" role="alert">
      <Icon name="alert" />
      <span>{errorMessage(t, error)}</span>
      {children}
      {onRetry && (
        <button type="button" className="link notice-action" onClick={onRetry}>
          {t("graph.retry")}
        </button>
      )}
    </div>
  );
}

/** Clavier d'une liste à une tabulation (`role="listbox"`, ligne active `active`) :
 *  ↑ / ↓ / Pg↑ / Pg↓ / Début / Fin → `go(i)`, Entrée → `enter(shift)`, Maj+F10 ou touche
 *  Menu → `menu()`. Renvoie le gestionnaire `onKeyDown` de la liste. */
export function listKeys(count: number, active: number, h: { go: (i: number) => void; enter?: (shift: boolean) => void; menu?: () => void; space?: () => void }) {
  return (e: React.KeyboardEvent) => {
    if (count === 0 || e.target !== e.currentTarget) return;
    const to: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + 10, PageUp: active - 10, Home: 0, End: count - 1 };
    if (e.key in to && !e.ctrlKey && !e.altKey) h.go(Math.max(0, Math.min(count - 1, to[e.key])));
    else if (e.key === "Enter" && h.enter) h.enter(e.shiftKey);
    else if (e.key === " " && h.space) h.space();
    else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && h.menu) h.menu();
    else return;
    e.preventDefault();
  };
}

/** Rend visible la ligne `id` de la liste qui défile. */
export const scrollRow = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "nearest" });
