import { describe, expect, it } from "vitest";
import { ignoreChoices } from "./gitignore";

describe("ignoreChoices", () => {
  it("proposes the file, its extension and its folder, anchored at the root", () => {
    expect(ignoreChoices("logs/app.log")).toEqual([
      { kind: "file", pattern: "/logs/app.log", label: "app.log" },
      { kind: "ext", pattern: "*.log", label: "*.log" },
      { kind: "dir", pattern: "/logs/", label: "logs/" },
    ]);
  });

  it("has no extension for dotfiles and no folder at the root", () => {
    expect(ignoreChoices(".env")).toEqual([{ kind: "file", pattern: "/.env", label: ".env" }]);
  });

  it("escapes glob characters and trailing spaces", () => {
    expect(ignoreChoices("a[1]*.txt ")[0].pattern).toBe("/a\\[1\\]\\*.txt\\ ");
  });
});
