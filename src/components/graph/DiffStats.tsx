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

export function DiffStats({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  if (diff.binary) return null;
  const { added, removed } = diffStats(diff);
  return (
    <span className="diff-stats mono" title={t("diff.stats", { added, removed })}>
      <span className="add">+{added}</span>
      <span className="del">−{removed}</span>
    </span>
  );
}
