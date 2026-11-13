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
