// Message de commit avec ses liens (cf. lib/commitLinks) : une adresse s'ouvre dans le
// navigateur, un SHA chargé dans le graphe le sélectionne, `#12` / `!5` / `owner/repo#12`
// ouvrent la PR / MR dans GitGR quand c'est possible, sinon la page du provider.
// `jumpTo` : passer à un autre commit depuis le panneau de détails (parent, SHA cité), avec
// le focus sur le titre du nouveau commit et Alt+← pour revenir.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { commitSegments, type CommitSegment } from "../../lib/commitLinks";
import { useGraph } from "../../store/graph";
import { pullCtxKey, usePullContexts, usePullList, type PullContext } from "../../store/pullList";

type Ref = Extract<CommitSegment, { t: "ref" }>;

/** Où mène une référence : la vue d'une PR / MR dans GitGR, une page web, ou rien (`!` sur
 *  GitHub, aucun remote connu). */
export function refTarget(seg: Ref, ctx: PullContext | undefined, openPulls: number[]): { show: number } | { url: string } | null {
  if (!ctx) return null;
  if (ctx.kind === "github" && seg.sigil === "!") return null;
  const repo = seg.repo ?? ctx.repo;
  const same = repo.toLowerCase() === ctx.repo.toLowerCase();
  const isPull = seg.sigil === "!" || (ctx.kind === "github" && openPulls.includes(seg.number));
  if (same && ctx.account && isPull) return { show: seg.number };
  const base = `${ctx.url.replace(/\/+$/, "")}/${repo}`;
  // GitHub renvoie /issues/N vers /pull/N quand c'est une PR.
  if (ctx.kind === "github") return { url: `${base}/issues/${seg.number}` };
  return { url: `${base}/-/${seg.sigil === "!" ? "merge_requests" : "issues"}/${seg.number}` };
}

/** Navigation depuis le panneau de détails, par commit attendu : `focus` (son titre prend
 *  le focus une fois affiché), `target` (sélection voulue : le chemin de retour est gardé) ;
 *  `back` : commits d'où l'on vient, par dépôt (Alt+←) ; `seq` : change quand la sélection
 *  est changée ailleurs, ce qui annule les sauts en cours. */
export const panelNav = { focus: null as string | null, target: null as string | null, back: new Map<string, string[]>(), seq: 0 };

/** Sélectionne `sha` ; depuis le panneau (`from` : commit affiché), il est empilé pour Alt+←
 *  (sauf en revenant) et `focus` amène le focus sur le titre du nouveau commit.
 *  `false` : commit introuvable dans l'historique. */
export async function jumpTo(path: string, from: string | null, sha: string, { back = false, focus = true } = {}): Promise<boolean> {
  if (useGraph.getState().graphs[path]?.selected === sha) return true;
  const id = ++panelNav.seq;
  panelNav.focus = focus ? sha : null;
  panelNav.target = sha;
  const ok = await useGraph.getState().reveal(path, sha);
  if (!ok) {
    if (panelNav.focus === sha) panelNav.focus = null;
    if (panelNav.target === sha) panelNav.target = null;
    return false;
  }
  // Sélection changée ailleurs pendant le chargement : rien à retenir.
  if (id !== panelNav.seq) return true;
  const stack = panelNav.back.get(path) ?? [];
  if (back) panelNav.back.set(path, stack.slice(0, -1));
  else if (from && from !== sha) panelNav.back.set(path, [...stack, from].slice(-50));
  return true;
}

/** Alt+← dans le panneau : retour au commit d'où l'on vient (retiré de la pile une fois
 *  atteint). */
export function jumpBack(path: string): boolean {
  const stack = panelNav.back.get(path) ?? [];
  const prev = stack[stack.length - 1];
  if (!prev) return false;
  void jumpTo(path, null, prev, { back: true });
  return true;
}

export function CommitText({ path, text, sha }: { path: string; text: string; sha?: string }) {
  const { t } = useTranslation();
  const segments = useMemo(() => commitSegments(text), [text]);
  const commits = useGraph((s) => s.graphs[path]?.commits);
  const contexts = usePullContexts(path);
  const ctx = contexts.find((c) => c.remote === "origin") ?? contexts[0];
  const openPulls = usePullList((s) => (ctx ? s.lists[pullCtxKey(ctx)]?.list?.pulls : undefined));
  const show = usePullList((s) => s.show);

  // Action dans GitGR : bouton ; page web : vrai lien (adresse lue au survol et par les lecteurs d'écran).
  const action = (key: number, label: string, title: string, onClick: () => void) => (
    <button key={key} type="button" className="commit-link" title={title} onClick={onClick}>
      {label}
    </button>
  );
  const web = (key: number, label: string, url: string) => (
    <a
      key={key}
      href={url}
      className="commit-link"
      title={url}
      onClick={(e) => {
        e.preventDefault();
        void api.openUrl(url).catch(() => {});
      }}
    >
      {label}
    </a>
  );

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.t === "text") return seg.v;
        if (seg.t === "url") return web(i, seg.v, seg.v);
        if (seg.t === "sha") {
          const full = commits?.find((c) => c.sha.startsWith(seg.v))?.sha;
          if (!full)
            return (
              <span key={i} title={t("details.shaNotLoaded")}>
                {seg.v}
              </span>
            );
          return action(i, seg.v, t("details.selectCommit"), () => void jumpTo(path, sha ?? null, full, { focus: sha !== undefined }));
        }
        const target = refTarget(seg, ctx, (openPulls ?? []).map((p) => p.number));
        if (!target) return seg.v;
        if ("show" in target) return action(i, seg.v, t("details.openPull"), () => show(path, ctx!, target.show));
        return web(i, seg.v, target.url);
      })}
    </>
  );
}
