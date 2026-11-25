// Lignes ajoutées / supprimées d'un fichier, en tête de son diff.

import { useTranslation } from "react-i18next";
import type { FileDiff } from "../../lib/types";

export function diffStats(diff: FileDiff): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of diff.hunks)
    for (const l of h.lines) {
      if (l.kind === "+") added++;
      else if (l.kind === "-") removed++;
    }
  return { added, removed };
}

/** « +12 −3 » ; un compteur nul n'est pas affiché (un fichier ajouté n'a pas de « −0 »). */
export function DiffStats({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  if (diff.binary) return null;
  const { added, removed } = diffStats(diff);
  if (!added && !removed) return null;
  const label = [added && t("diff.added", { count: added }), removed && t("diff.removed", { count: removed })].filter(Boolean).join(", ");
  return (
    <span className="diff-stats mono" title={label}>
      <span className="visually-hidden">{label}</span>
      {added > 0 && (
        <span className="add" aria-hidden="true">
          +{added}
        </span>
      )}
      {removed > 0 && (
        <span className="del" aria-hidden="true">
          −{removed}
        </span>
      )}
    </span>
  );
}
