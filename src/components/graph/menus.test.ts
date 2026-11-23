import { describe, expect, it } from "vitest";
import { absolutePath } from "./menus";

describe("absolutePath", () => {
  it("joins with the separator of the repository path", () => {
    expect(absolutePath("C:\\dev\\repo", "src/a.ts")).toBe("C:\\dev\\repo\\src\\a.ts");
    expect(absolutePath("C:\\dev\\repo\\", "a.ts")).toBe("C:\\dev\\repo\\a.ts");
    expect(absolutePath("/home/me/repo/", "src/a.ts")).toBe("/home/me/repo/src/a.ts");
  });
});
