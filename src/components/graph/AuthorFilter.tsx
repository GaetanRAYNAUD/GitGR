// Filtre du graphe par auteurs (dans la barre de recherche) : liste des auteurs de
// l'historique, l'identité du dépôt en tête ; les commits des auteurs choisis sont mis en avant,
// les autres estompés (y compris au-delà des commits chargés, cf. `author_commits`).

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorCode } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import type { Author } from "../../lib/types";
import { useGraphFind } from "../../store/graphFind";
import { MultiPicker, type PickOption } from "../MultiPicker";

/** Auteurs, avec l'e-mail de l'identité du dépôt (s'il y en a une) en tête. */
export function authorOptions(authors: Author[], me: string | null, commits: (n: number) => string): PickOption[] {
  const mine = me?.toLowerCase();
  const sorted = mine ? [...authors.filter((a) => a.email.toLowerCase() === mine), ...authors.filter((a) => a.email.toLowerCase() !== mine)] : authors;
  return sorted.map((a) => ({ id: a.email, label: a.name || a.email, detail: `${a.email} · ${commits(a.count)}` }));
}

export function AuthorFilter({ path, selected }: { path: string; selected: string[] }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ authors: Author[]; me: string | null } | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.repoAuthors(path), api.commitIdentity(path).catch(() => null)]).then(
      ([authors, me]) => live && setData({ authors, me: me?.email ?? null }),
      (e) => live && setData({ error: errorCode(e) }),
    );
    return () => {
      live = false;
    };
  }, [path]);

  const options = useMemo(
    () => (data && "authors" in data ? authorOptions(data.authors, data.me, (n) => t("authorFilter.commits", { count: n })) : []),
    [data, t],
  );

  if (data && "error" in data) return <span className="graph-find-set">{errorMessage(t, data.error)}</span>;
  return (
    <div className="author-filter">
      <MultiPicker
        label={t("authorFilter.label")}
        options={options}
        selected={selected}
        onChange={(ids) => useGraphFind.getState().showAuthors(path, ids)}
        disabled={!data}
        placeholder={data ? t("authorFilter.placeholder") : t("authorFilter.loading")}
      />
    </div>
  );
}
