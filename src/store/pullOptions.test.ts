import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { PullOptions } from "../lib/types";
import { isStale, optionsKey, ownerKey, resetPullOptions, STALE_SECONDS, usePullOptions } from "./pullOptions";

const ctx = { kind: "github" as const, url: "https://github.com", repo: "Org/Front", account: "github|https://github.com|moi" };
const now = () => Math.floor(Date.now() / 1000);
const opts = (p: Partial<PullOptions> = {}): PullOptions => ({ people: [{ id: 1, login: "alix" }], labels: [], fetchedAt: now(), fromOwner: false, truncated: false, ...p });
const entry = () => usePullOptions.getState().entries[optionsKey(ctx)];

beforeEach(() => {
  resetPullOptions();
  vi.restoreAllMocks();
});

describe("usePullOptions", () => {
  it("cache récent : affiché, pas relu", async () => {
    vi.spyOn(api, "cachedPullOptions").mockResolvedValue(opts());
    const refresh = vi.spyOn(api, "refreshPullOptions");
    await usePullOptions.getState().ensure(ctx);
    expect(entry().options?.people[0].login).toBe("alix");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("liste empruntée aux autres dépôts du propriétaire : affichée, puis remplacée par la vraie", async () => {
    vi.spyOn(api, "cachedPullOptions").mockResolvedValue(opts({ fromOwner: true }));
    let resolve!: (o: PullOptions) => void;
    vi.spyOn(api, "refreshPullOptions").mockReturnValue(new Promise((r) => (resolve = r)));
    const done = usePullOptions.getState().ensure(ctx);
    await vi.waitFor(() => expect(entry()?.loading).toBe(true));
    expect(entry().options?.fromOwner).toBe(true);
    // Une seconde demande pendant la lecture ne relance rien.
    await usePullOptions.getState().ensure(ctx);
    resolve(opts({ people: [{ id: 2, login: "max" }] }));
    await done;
    expect(entry()).toMatchObject({ loading: false, error: null });
    expect(entry().options?.people[0].login).toBe("max");
    expect(api.refreshPullOptions).toHaveBeenCalledTimes(1);
  });

  it("erreur de lecture : le cache reste, l'erreur est dite ; sans compte, rien n'est lu", async () => {
    vi.spyOn(api, "cachedPullOptions").mockResolvedValue(opts({ fetchedAt: now() - STALE_SECONDS - 1 }));
    vi.spyOn(api, "refreshPullOptions").mockRejectedValue("provider_unreachable");
    await usePullOptions.getState().ensure(ctx);
    expect(entry()).toMatchObject({ loading: false, error: "provider_unreachable" });
    expect(entry().options?.people).toHaveLength(1);

    resetPullOptions();
    await usePullOptions.getState().ensure({ ...ctx, account: null });
    expect(api.refreshPullOptions).toHaveBeenCalledTimes(1);
  });

  it("force : relit même un cache récent", async () => {
    vi.spyOn(api, "cachedPullOptions").mockResolvedValue(opts());
    vi.spyOn(api, "refreshPullOptions").mockResolvedValue(opts());
    await usePullOptions.getState().ensure(ctx, true);
    expect(api.refreshPullOptions).toHaveBeenCalledTimes(1);
  });

  it("clés et fraîcheur", () => {
    expect(optionsKey(ctx)).toBe("github|https://github.com|org/front");
    expect(ownerKey({ ...ctx, repo: "groupe/sous/projet" })).toBe("github|https://github.com|groupe/sous");
    expect(isStale(null, 0)).toBe(true);
    expect(isStale(opts({ fetchedAt: 100 }), 100 + STALE_SECONDS)).toBe(false);
    expect(isStale(opts({ fetchedAt: 100 }), 101 + STALE_SECONDS)).toBe(true);
  });
});
