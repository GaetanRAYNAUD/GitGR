import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("recherche floue", () => {
  it("trouve les lettres dans l'ordre, sans tenir compte de la casse", () => {
    expect(fuzzyScore("gtg", "GitGR")).not.toBeNull();
    expect(fuzzyScore("rg", "GitGR")).toBeNull();
    expect(fuzzyScore("", "x")).toBe(0);
    expect(fuzzyScore("api back", "api-backend")).not.toBeNull();
  });

  it("préfère les lettres consécutives et les débuts de mot", () => {
    expect(fuzzyScore("back", "api-backend")!).toBeGreaterThan(fuzzyScore("back", "bigrackend")!);
    expect(fuzzyScore("ab", "api-backend")!).toBeGreaterThan(fuzzyScore("ab", "xaxxxb")!);
  });

  it("classe d'après le nom avant le chemin, ordre d'origine à égalité", () => {
    const repos = [
      { name: "dotfiles", path: "C:/Users/demo/dotfiles" },
      { name: "api-backend", path: "C:/Users/demo/work/api-backend" },
      { name: "GitGR", path: "C:/Users/demo/Projects/GitGR" },
    ];
    const names = (q: string) => fuzzyFilter(repos, q, (r) => r.name, (r) => r.path).map((r) => r.name);
    expect(names("")).toEqual(["dotfiles", "api-backend", "GitGR"]);
    expect(names("git")).toEqual(["GitGR"]);
    expect(names("work")).toEqual(["api-backend"]);
    expect(names("demo")).toHaveLength(3);
    expect(names("zzz")).toEqual([]);
  });
});
