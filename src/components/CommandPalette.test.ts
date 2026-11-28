import { describe, expect, it } from "vitest";
import { type Command, withRecentFirst } from "./CommandPalette";

const c = (id: string): Command => ({ id, label: id, group: "g", run: () => {} });

describe("withRecentFirst", () => {
  it("met les récentes en tête dans leur ordre, ignore celles qui n'existent plus", () => {
    const list = [c("a"), c("b"), c("c"), c("d")];
    expect(withRecentFirst(list, ["c", "zz", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(withRecentFirst(list, []).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});
