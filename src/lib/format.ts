// Petites fonctions de mise en forme, pures (testées dans format.test.ts).

/** Hôte lisible d'une URL de remote : https://host/..., ssh://user@host:port/..., git@host:... */
export function remoteHost(url: string): string {
  const m = url.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i) ?? url.match(/^[^@/]+@([^:]+):/);
  return m ? m[1] : url;
}

export type RelativeTime = { key: "justNow" | "minutes" | "hours" | "days"; count: number };

/** Durée écoulée depuis `ms`, à traduire avec les clés `time.*`. */
export function relativeTime(ms: number, now: number = Date.now()): RelativeTime {
  const min = Math.floor((now - ms) / 60000);
  if (min < 1) return { key: "justNow", count: 0 };
  if (min < 60) return { key: "minutes", count: min };
  const h = Math.floor(min / 60);
  if (h < 24) return { key: "hours", count: h };
  return { key: "days", count: Math.floor(h / 24) };
}

export type CommitDate = RelativeTime | { key: "date"; text: string };

/** Date d'un commit dans la liste : relative sur les 7 derniers jours, sinon date courte. */
export function commitDate(ms: number, lang: string, now: number = Date.now()): CommitDate {
  const rel = relativeTime(ms, now);
  if (rel.key !== "days" || rel.count < 7) return rel;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return {
    key: "date",
    text: d.toLocaleDateString(lang, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" }),
  };
}

/** Initiales d'un nom (avatar) : « Camille Dupont » → « CD ». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = [...parts[0]][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}
