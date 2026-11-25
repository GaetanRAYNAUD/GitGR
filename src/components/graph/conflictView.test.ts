import { describe, expect, it } from "vitest";
import { sidesKey } from "./ConflictView";

describe("noms des côtés d'un conflit selon l'opération", () => {
  it("suit merge, rebase, cherry-pick et revert ; à défaut, notre / l'autre version", () => {
    expect(sidesKey("merge")).toBe("merge");
    expect(sidesKey("rebase")).toBe("rebase");
    expect(sidesKey("cherry-pick")).toBe("pick");
    expect(sidesKey("revert")).toBe("revert");
    expect(sidesKey(null)).toBe("none");
    expect(sidesKey(undefined)).toBe("none");
  });
});
