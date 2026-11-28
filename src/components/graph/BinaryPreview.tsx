// Aperçu d'un fichier binaire dans le diff : une image avant / après (côte à côte ou en fondu,
// dimensions et poids), ou, pour les autres binaires, leur taille. Les versions sont lues par
// `blob_preview` (commit, index ou copie de travail).

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { BlobPreview, BlobSide } from "../../lib/types";

export interface BinarySides {
  path: string;
  /** Version de gauche (avant) ; `null` : le fichier est ajouté. */
  old: BlobSide | null;
  /** Version de droite (après) ; `null` : le fichier est supprimé. */
  new: BlobSide | null;
}

/** Taille lisible : « 812 o », « 12,4 Ko », « 3,1 Mo » (dans la langue de l'interface). */
export function formatSize(bytes: number, lang: string, units: [string, string, string]): string {
  const [b, k, m] = units;
  if (bytes < 1024) return `${bytes} ${b}`;
  const fmt = (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024)} ${k}`;
  return `${fmt(bytes / (1024 * 1024))} ${m}`;
}

type Loaded = { old: BlobPreview | null; new: BlobPreview | null };

export function BinaryPreview({ sides, labels }: { sides: BinarySides; labels?: [string, string] }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<{ key: string; data?: Loaded; error?: string } | null>(null);
  const [mode, setMode] = useState<"side" | "fade">("side");
  const [fade, setFade] = useState(50);
  const [dims, setDims] = useState<{ old?: [number, number]; new?: [number, number] }>({});
  // Images que la WebView n'a pas su décoder (fichier abîmé, format non pris en charge).
  const [broken, setBroken] = useState<{ old?: boolean; new?: boolean }>({});
  const [reload, setReload] = useState(0);
  const fadeId = useId();
  const key = JSON.stringify(sides);

  useEffect(() => {
    let live = true;
    setDims({});
    setBroken({});
    const read = (s: BlobSide | null) => (s ? api.blobPreview(sides.path, s) : Promise.resolve(null));
    Promise.all([read(sides.old), read(sides.new)]).then(
      ([o, n]) => live && setState({ key, data: { old: o, new: n } }),
      (e) => live && setState({ key, error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
    // `key` résume `sides` (nouvel objet à chaque rendu chez l'appelant).
  }, [key, reload]);

  const units: [string, string, string] = [t("binary.bytes"), t("binary.kb"), t("binary.mb")];
  const size = (n: number) => formatSize(n, i18n.language, units);

  if (!state || state.key !== key) return <p className="muted">{t("diff.loading")}</p>;
  if (state.error)
    return (
      <div className="notice error" role="alert">
        <span>{errorMessage(t, state.error)}</span>
        <button type="button" className="link notice-action" onClick={() => setReload((n) => n + 1)}>
          {t("graph.retry")}
        </button>
      </div>
    );
  const { old: before, new: after } = state.data!;
  const image = (before?.mime ?? after?.mime) != null;

  // Ligne des tailles : « 12,4 Ko → 14,1 Ko (+1,7 Ko) ».
  const delta = before && after ? after.size - before.size : null;
  const sizes = (
    <p className="bin-sizes">
      {before ? size(before.size) : t("binary.none")}
      {" → "}
      {after ? size(after.size) : t("binary.none")}
      {delta !== null && delta !== 0 && (
        <span className="bin-delta"> ({delta > 0 ? "+" : "−"}{size(Math.abs(delta))})</span>
      )}
    </p>
  );

  if (!image)
    return (
      <div className="bin-preview">
        <p className="muted">{t("binary.noPreview")}</p>
        {sizes}
      </div>
    );

  const tooBig = (b: BlobPreview | null) => !!b && !b.data;
  const side = (which: "old" | "new", b: BlobPreview | null) => {
    const d = dims[which];
    return (
      <figure className="bin-side">
        <figcaption>
          <span className="bin-label">{labels ? labels[which === "old" ? 0 : 1] : t(which === "old" ? "binary.before" : "binary.after")}</span>
          {b && (
            <span className="muted">
              {d ? `${d[0]} × ${d[1]} px · ` : ""}
              {size(b.size)}
            </span>
          )}
        </figcaption>
        <div className="bin-frame">
          {!b ? (
            <span className="muted">{t(which === "old" ? "binary.added" : "binary.deleted")}</span>
          ) : tooBig(b) ? (
            <span className="muted">{t("binary.tooBig")}</span>
          ) : broken[which] ? (
            <span className="muted">{t("binary.unreadable")}</span>
          ) : (
            <img
              src={b.data!}
              alt={labels ? labels[which === "old" ? 0 : 1] : t(which === "old" ? "binary.beforeAlt" : "binary.afterAlt")}
              onLoad={(e) => {
                const img = e.currentTarget;
                setDims((x) => ({ ...x, [which]: [img.naturalWidth, img.naturalHeight] }));
              }}
              onError={() => setBroken((x) => ({ ...x, [which]: true }))}
            />
          )}
        </div>
      </figure>
    );
  };
  const canFade = !!before?.data && !!after?.data && !broken.old && !broken.new;

  return (
    <div className="bin-preview">
      <div className="bin-bar">
        {sizes}
        {canFade && (
          <div className="view-toggle" role="group" aria-label={t("binary.mode")}>
            {(["side", "fade"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : undefined} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`binary.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {canFade && mode === "fade" ? (
        <figure className="bin-side bin-fade">
          <figcaption>
            <span className="bin-label" aria-hidden="true">
              {t("binary.before")}
            </span>
            <input id={fadeId} aria-label={t("binary.fadeLabel")} type="range" min={0} max={100} value={fade} onChange={(e) => setFade(Number(e.target.value))} aria-valuetext={t("binary.fadeValue", { value: fade })} />
            <span className="bin-label" aria-hidden="true">
              {t("binary.after")}
            </span>
          </figcaption>
          <div className="bin-frame bin-stack">
            <img src={before!.data!} alt={t("binary.beforeAlt")} />
            <img src={after!.data!} alt={t("binary.afterAlt")} style={{ opacity: fade / 100 }} />
          </div>
        </figure>
      ) : (
        <div className="bin-sides">
          {side("old", before)}
          {side("new", after)}
        </div>
      )}
    </div>
  );
}

interface SideFile {
  status: string;
  path: string;
  oldPath: string | null;
}

/** Versions d'un fichier dans un commit (`base` : début d'une plage ; sinon le premier parent). */
export function commitSides(path: string, file: SideFile, sha: string, base?: string | null): BinarySides {
  return {
    path,
    old: file.status === "A" ? null : { rev: base ?? `${sha}^`, file: file.oldPath ?? file.path },
    new: file.status === "D" ? null : { rev: sha, file: file.path },
  };
}

/** Versions d'un fichier de la copie de travail : indexé (HEAD → index), non indexé (index →
 *  disque), non suivi (rien → disque). `undefined` pour un conflit (vue dédiée). */
export function workSides(path: string, file: SideFile, area: string): BinarySides | undefined {
  const added = file.status === "A" || file.status === "?";
  const deleted = file.status === "D";
  if (area === "staged") return { path, old: added ? null : { rev: "HEAD", file: file.oldPath ?? file.path }, new: deleted ? null : { rev: "", file: file.path } };
  if (area === "unstaged") return { path, old: { rev: "", file: file.path }, new: deleted ? null : { rev: null, file: file.path } };
  if (area === "untracked") return { path, old: null, new: { rev: null, file: file.path } };
  return undefined;
}
