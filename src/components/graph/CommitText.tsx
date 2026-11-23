// Message de commit avec ses liens (cf. lib/commitLinks) : une adresse s'ouvre dans le
// navigateur, un SHA chargé dans le graphe le sélectionne, `#12` / `!5` / `owner/repo#12`
// ouvrent la PR / MR dans GitGR quand c'est possible, sinon la page du provider.

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

export function CommitText({ path, text }: { path: string; text: string }) {
  const { t } = useTranslation();
  const segments = useMemo(() => commitSegments(text), [text]);
  const commits = useGraph((s) => s.graphs[path]?.commits);
  const reveal = useGraph((s) => s.reveal);
  const contexts = usePullContexts(path);
  const ctx = contexts.find((c) => c.remote === "origin") ?? contexts[0];
  const openPulls = usePullList((s) => (ctx ? s.lists[pullCtxKey(ctx)]?.list?.pulls : undefined));
  const show = usePullList((s) => s.show);

  const link = (key: number, label: string, title: string, onClick: () => void) => (
    <a
      key={key}
      href="#"
      className="commit-link"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </a>
  );

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.t === "text") return seg.v;
        if (seg.t === "url") return link(i, seg.v, seg.v, () => void api.openUrl(seg.v).catch(() => {}));
        if (seg.t === "sha") {
          const full = commits?.find((c) => c.sha.startsWith(seg.v))?.sha;
          return full ? link(i, seg.v, t("details.selectCommit"), () => void reveal(path, full)) : seg.v;
        }
        const target = refTarget(seg, ctx, (openPulls ?? []).map((p) => p.number));
        if (!target) return seg.v;
        if ("show" in target) return link(i, seg.v, t("details.openPull"), () => show(path, ctx!, target.show));
        return link(i, seg.v, target.url, () => void api.openUrl(target.url).catch(() => {}));
      })}
    </>
  );
}
