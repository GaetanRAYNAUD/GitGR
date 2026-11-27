// Marge de blame dans un diff (« Annoter », comme l'annotate d'IntelliJ) : à gauche de chaque
// ligne de la nouvelle version, le commit qui l'a écrite (`git blame` au commit affiché, ou sur
// la copie de travail). Sur la première ligne d'un bloc du même commit : nom + date courte,
// initiales + date si ça ne tient pas dans la marge ; marque d'âge grise. Survol : résumé,
// e-mail, date, SHA ; clic : détails ; double-clic : dans le graphe ; clic droit : actions.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import { commitDate, initials } from "../../lib/format";
import type { BlameCommit } from "../../lib/types";
import { useApp } from "../../store/app";
import { useGraph } from "../../store/graph";
import { useWork } from "../../store/worktree";
import { useBlameView } from "../../store/range";
import type { MenuItem } from "../ContextMenu";
import { commitMenu } from "./menus";

/** Largeur de la marge (cf. `.diff-table .ann`). */
export const MARGIN_W = 160;
/** Place pour le texte : la marge moins ses marges intérieures et la marque d'âge. */
const TEXT_W = MARGIN_W - 22;

/** Ce dont la marge a besoin : le fichier et la version montrée à droite du diff. */
export interface BlameSource {
  path: string;
  file: string;
  /** Commit de la nouvelle version ; `null` : la copie de travail. */
  rev: string | null;
  /** Raison pour laquelle la marge n'est pas possible ici (côté indexé…), à afficher. */
  unavailable?: string;
  /** Avant de montrer un commit dans le graphe (ferme la vue qui le cache). */
  beforeReveal?: () => void;
}

/** SHA des lignes pas encore commitées (copie de travail). */
export const uncommitted = (sha: string) => /^0+$/.test(sha);

export interface BlameMarginData {
  /** Commit de la ligne `n` (1 = première) de la nouvelle version. */
  at(n: number | null | undefined): BlameCommit | undefined;
  /** 0 : le plus ancien du fichier, 1 : le plus récent. */
  age(c: BlameCommit): number;
  label(c: BlameCommit): string;
  title(c: BlameCommit): string;
  /** Clic, double-clic, clic droit (items du menu). */
  pick(c: BlameCommit): void;
  reveal(c: BlameCommit): void;
  menu(c: BlameCommit): MenuItem[];
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Largeur d'un texte dans la police de la marge (12px Inter). */
function textWidth(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = '12px "Inter Variable", Inter, system-ui, sans-serif';
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 7;
}

/** Nom + date, ou initiales + date si ça ne tient pas dans la marge. */
export function marginLabel(author: string, date: string, fits: (s: string) => boolean = (s) => textWidth(s) <= TEXT_W): string {
  const full = `${author} · ${date}`;
  return fits(full) ? full : `${initials(author)} · ${date}`;
}

/** Données de la marge quand « Annoter » est actif et possible ici ; `null` sinon. Relue quand
 *  les refs changent (et la copie de travail, pour un blame sur elle). */
export function useBlameMargin(src: BlameSource | undefined): BlameMarginData | null {
  const { t, i18n } = useTranslation();
  const on = useApp((s) => !!s.settings.diffBlame);
  const path = src?.path ?? "";
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const work = useWork((s) => (src && !src.rev ? (s.repos[path]?.status ?? null) : null));
  const [blame, setBlame] = useState<{ key: string; lines: string[]; commits: Map<string, BlameCommit> } | null>(null);
  const active = on && !!src && !src.unavailable;
  const key = src ? `${src.path}|${src.file}|${src.rev ?? ""}` : "";

  useEffect(() => {
    if (!active || !src) return;
    let live = true;
    api.blame(src.path, src.file, src.rev).then(
      (b) => live && setBlame({ key, lines: b.lines.map((l) => l.sha), commits: new Map(b.commits.map((c) => [c.sha, c])) }),
      // Pas de marge si le blame échoue (fichier binaire, supprimé…) : le diff reste lisible.
      () => live && setBlame(null),
    );
    return () => {
      live = false;
    };
    // `src` est lu par ses champs (clé).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, refs, work]);

  return useMemo(() => {
    if (!active || !src || !blame || blame.key !== key) return null;
    const times = [...blame.commits.values()].filter((c) => !uncommitted(c.sha)).map((c) => c.time);
    const min = Math.min(...times);
    const span = Math.max(...times) - min;
    const when = (c: BlameCommit) => {
      const d = commitDate(c.time * 1000, i18n.language);
      return d.key === "date" ? d.text : t(`time.${d.key}`, { count: d.count });
    };
    const reveal = (c: BlameCommit) => {
      if (uncommitted(c.sha)) return;
      src.beforeReveal?.();
      void useGraph.getState().reveal(src.path, c.sha);
    };
    return {
      at: (n) => (n ? blame.commits.get(blame.lines[n - 1] ?? "") : undefined),
      age: (c) => (uncommitted(c.sha) || span <= 0 ? 1 : (c.time - min) / span),
      label: (c) => (uncommitted(c.sha) ? t("blame.uncommitted") : marginLabel(c.author, when(c))),
      title: (c) =>
        uncommitted(c.sha)
          ? t("blame.uncommittedHint")
          : `${c.summary}\n${c.author} <${c.email}>\n${new Date(c.time * 1000).toLocaleString(i18n.language)}\n${c.sha.slice(0, 7)}`,
      pick: (c) => {
        // Le diff reste ouvert : seul le panneau des détails change de commit.
        if (!uncommitted(c.sha)) useGraph.getState().showDetails(src.path, c.sha);
      },
      reveal,
      menu: (c) => marginMenu(t, src, c, () => reveal(c)),
    };
  }, [active, src, blame, key, t, i18n.language]);
}

/** Actions d'un commit de la marge (clic droit, Maj+B). */
function marginMenu(t: TFunction, src: BlameSource, c: BlameCommit, reveal: () => void): MenuItem[] {
  if (uncommitted(c.sha)) return [];
  const refs = useGraph.getState().graphs[src.path]?.refs ?? null;
  return [
    { label: t("reflog.showInGraph"), onClick: reveal },
    {
      label: t("blame.before"),
      disabled: !c.previous,
      title: c.previous ? t("blame.beforeHint", { sha: c.previous.sha.slice(0, 7) }) : t("blame.beforeNone"),
      onClick: () => {
        if (!c.previous) return;
        src.beforeReveal?.();
        useBlameView.getState().show(src.path, { file: c.previous.filename, rev: c.previous.sha, historyFile: src.file });
      },
    },
    "sep",
    ...commitMenu(t, src.path, c.sha, refs),
  ];
}
