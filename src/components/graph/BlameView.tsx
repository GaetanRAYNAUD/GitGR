// Blame d'un fichier, ouvert à la place du graphe (clic droit sur un fichier, historique du
// fichier) : chaque ligne avec le commit qui l'a écrite (`git blame`), à un commit donné ou
// sur la copie de travail. Les lignes consécutives d'un même commit forment un bloc, dont la
// première ligne porte le commit. Clic : ses détails ; double-clic : le montrer dans le
// graphe ; clic droit : ses actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { relativeTime } from "../../lib/format";
import type { Blame, BlameCommit } from "../../lib/types";
import { useGraph } from "../../store/graph";
import { useBlameView, useFileHistoryView, type BlameTarget } from "../../store/range";
import { openContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
import { useEscape } from "./DiffBody";
import { BackButton } from "./DiffView";
import { commitMenu, fileMenu } from "./menus";

/** SHA des lignes pas encore commitées (copie de travail). */
const uncommitted = (sha: string) => /^0+$/.test(sha);

export function BlameView({ path, target }: { path: string; target: BlameTarget }) {
  const { t } = useTranslation();
  const close = useBlameView((s) => s.close);
  const back = useCallback(() => close(path), [close, path]);
  useEscape(back);
  const { file, rev } = target;
  const refs = useGraph((s) => s.graphs[path]?.refs ?? null);
  const selected = useGraph((s) => s.graphs[path]?.selected ?? null);
  const [blame, setBlame] = useState<Blame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  // Relu quand les refs changent ; celui de la copie de travail aussi à chaque ouverture.
  useEffect(() => {
    let live = true;
    api.blame(path, file, rev).then(
      (b) => {
        if (!live) return;
        setBlame(b);
        setError(null);
      },
      (e) => {
        if (!live) return;
        setBlame(null);
        setError(errorCode(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, file, rev, refs]);

  const commits = useMemo(() => new Map((blame?.commits ?? []).map((c) => [c.sha, c])), [blame]);
  const ago = (s: number) => {
    const r = relativeTime(s * 1000);
    return t(`time.${r.key}`, { count: r.count });
  };
  const reveal = (sha: string) =>
    void useGraph.getState().reveal(path, sha).then((ok) => {
      if (ok) back();
      else setMissing(sha);
    });
  const pick = (c: BlameCommit) => {
    setMissing(null);
    if (!uncommitted(c.sha)) useGraph.getState().select(path, c.sha);
  };
  const menu = (ev: React.MouseEvent, c: BlameCommit) => {
    if (uncommitted(c.sha)) return;
    useGraph.getState().select(path, c.sha);
    openContextMenu(ev, [
      { label: t("reflog.showInGraph"), onClick: () => reveal(c.sha) },
      { label: t("blame.atCommit"), onClick: () => useBlameView.getState().show(path, { file: c.filename || file, rev: c.sha }) },
      "sep",
      ...commitMenu(t, path, c.sha, refs),
    ]);
  };

  return (
    <section className="pull-view blame-view" aria-label={t("blame.label")}>
      <header className="diff-head">
        <BackButton onClick={back} />
        <Icon name="user" size={15} />
        <span className="pull-view-title mono" onContextMenu={(e) => openContextMenu(e, fileMenu(t, path, file))}>
          {t("blame.title", { file })}
        </span>
        <span className="mono muted diff-sha">{rev ? rev.slice(0, 7) : t("blame.workingCopy")}</span>
        <button className="btn sm" onClick={() => useFileHistoryView.getState().show(path, file)}>
          {t("fileHistory.menu")}
        </button>
      </header>
      {missing && (
        <p className="details-note muted" role="status">
          {t("reflog.notInGraph")}
        </p>
      )}
      {error ? (
        <p className="details-note" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : !blame ? (
        <p className="muted pull-pad">{t("details.loading")}</p>
      ) : blame.lines.length === 0 ? (
        <p className="muted pull-pad">{t("blame.empty")}</p>
      ) : (
        <div className="blame-body">
          <table className="blame-table mono">
            <tbody>
              {blame.lines.map((l, i) => {
                const c = commits.get(l.sha);
                const start = i === 0 || blame.lines[i - 1].sha !== l.sha;
                const mine = uncommitted(l.sha);
                return (
                  <tr key={i} className={[start ? "start" : "", selected === l.sha ? "on" : "", mine ? "wip" : ""].join(" ").trim() || undefined}>
                    <td
                      className="blame-commit"
                      title={c && !mine ? `${c.summary}\n${c.author} <${c.email}>\n${c.sha.slice(0, 7)}` : undefined}
                      onClick={() => c && pick(c)}
                      onDoubleClick={() => c && !mine && reveal(c.sha)}
                      onContextMenu={(ev) => c && menu(ev, c)}
                    >
                      {start && c && (
                        <>
                          <span className="blame-summary">{mine ? t("blame.uncommitted") : c.summary}</span>
                          {!mine && <span className="muted blame-meta">{`${c.author} · ${ago(c.time)}`}</span>}
                        </>
                      )}
                    </td>
                    <td className="ln muted">{i + 1}</td>
                    <td className="blame-text">{l.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {blame.truncated && <p className="details-note muted">{t("blame.truncated")}</p>}
        </div>
      )}
    </section>
  );
}
