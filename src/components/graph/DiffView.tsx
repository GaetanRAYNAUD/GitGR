// Diff d'un fichier, affiché à la place du graphe (Échap ou « Retour » pour revenir).

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import { useGraph, type OpenDiff } from "../../store/graph";
import { Icon } from "../Icon";
import { StatusBadge } from "./CommitPanel";

export function DiffView({ path, diff }: { path: string; diff: OpenDiff }) {
  const { t } = useTranslation();
  const close = useGraph((s) => s.closeDiff);
  const { file, data, error } = diff;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, path]);

  let body;
  if (error) {
    body = (
      <div className="notice error" role="alert">
        <Icon name="alert" />
        {errorMessage(t, error)}
      </div>
    );
  } else if (!data) {
    body = <p className="muted">{t("diff.loading")}</p>;
  } else if (data.binary) {
    body = <p className="muted">{t("diff.binary")}</p>;
  } else if (data.hunks.length === 0) {
    body = <p className="muted">{t("diff.empty")}</p>;
  } else {
    body = (
      <>
        <table className="diff-table">
          <tbody>
            {data.hunks.map((h, hi) => [
              <tr key={`h${hi}`} className="diff-hunk">
                <td colSpan={3}>{h.header}</td>
              </tr>,
              ...h.lines.map((l, li) => (
                <tr key={`${hi}-${li}`} className={l.kind === "+" ? "add" : l.kind === "-" ? "del" : undefined}>
                  <td className="ln">{l.old ?? ""}</td>
                  <td className="ln">{l.new ?? ""}</td>
                  <td className="code">
                    <span className="sign" aria-hidden="true">
                      {l.kind}
                    </span>
                    {l.text}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {data.truncated && <p className="notice diff-truncated">{t("diff.truncated")}</p>}
      </>
    );
  }

  return (
    <section className="diff-view" aria-label={t("diff.label", { file: file.path })}>
      <header className="diff-head">
        <button
          className="icon-btn bordered"
          onClick={() => close(path)}
          aria-label={t("diff.back")}
          title={`${t("diff.back")} (Esc)`}
        >
          <Icon name="back" size={16} />
        </button>
        <StatusBadge status={file.status} />
        <span className="diff-path mono">
          {file.oldPath && <span className="muted">{file.oldPath} → </span>}
          {file.path}
        </span>
        <span className="mono muted diff-sha">{diff.sha.slice(0, 7)}</span>
      </header>
      <div className="diff-body">{body}</div>
    </section>
  );
}
