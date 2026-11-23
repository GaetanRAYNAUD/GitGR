// Rendu du Markdown d'une PR / MR (description, commentaires) : l'arbre de `lib/markdown`
// en éléments React, sans HTML injecté. Les liens s'ouvrent dans le navigateur ; les images
// ne sont pas chargées (montrées comme des liens).

import { type ReactNode, useMemo } from "react";
import { api } from "../lib/api";
import { type Block, type Inline, parseMarkdown } from "../lib/markdown";

/** Rendu d'un morceau de texte brut (hors code et hors lien), ex. pour y repérer `#12`. */
export type RenderText = (text: string, key: number) => ReactNode;

function inlines(nodes: Inline[], rt?: RenderText): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return rt ? rt(n.v, i) : n.v;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "br":
        return <br key={i} />;
      case "strong":
        return <strong key={i}>{inlines(n.c, rt)}</strong>;
      case "em":
        return <em key={i}>{inlines(n.c, rt)}</em>;
      case "del":
        return <del key={i}>{inlines(n.c, rt)}</del>;
      case "link":
        if (!n.href) return <span key={i}>{inlines(n.c)}</span>;
        return (
          <a
            key={i}
            href={n.href}
            title={n.href}
            className={n.image ? "md-image" : undefined}
            onClick={(e) => {
              e.preventDefault();
              void api.openUrl(n.href!).catch(() => {});
            }}
          >
            {inlines(n.c)}
          </a>
        );
    }
  });
}

function blocks(nodes: Block[], rt?: RenderText): ReactNode[] {
  return nodes.map((b, i) => {
    switch (b.t) {
      case "p":
        return <p key={i}>{inlines(b.c, rt)}</p>;
      case "h": {
        const H = `h${Math.min(6, b.level + 2)}` as "h3";
        return (
          <H key={i} className={`md-h md-h${b.level}`}>
            {inlines(b.c, rt)}
          </H>
        );
      }
      case "code":
        return (
          <pre key={i} data-lang={b.lang || undefined}>
            <code>{b.v}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={i}>{blocks(b.c, rt)}</blockquote>;
      case "hr":
        return <hr key={i} />;
      case "list": {
        const items = b.items.map((it, k) => (
          <li key={k} className={it.task === null ? undefined : "md-task"}>
            {it.task !== null && <input type="checkbox" checked={it.task} disabled readOnly />}
            {blocks(it.c, rt)}
          </li>
        ));
        return b.ordered ? (
          <ol key={i} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={i} className="md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, k) => (
                    <th key={k} style={{ textAlign: b.align[k] ?? undefined }}>
                      {inlines(c, rt)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                        {inlines(c, rt)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** `empty` : affiché à la place quand il ne reste rien (texte vide ou fait seulement de
 *  commentaires HTML, comme un modèle de PR laissé tel quel). */
export function Markdown({ text, className, empty, renderText }: { text: string; className?: string; empty?: ReactNode; renderText?: RenderText }) {
  const tree = useMemo(() => parseMarkdown(text), [text]);
  if (tree.length === 0 && empty !== undefined) return <>{empty}</>;
  return <div className={className ? `md ${className}` : "md"}>{blocks(tree, renderText)}</div>;
}
