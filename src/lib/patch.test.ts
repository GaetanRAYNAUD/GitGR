import { describe, expect, it } from "vitest";
import { filePatch, linesPatch } from "./patch";
import type { FileDiff } from "./types";

const diff: FileDiff = {
  binary: false,
  truncated: false,
  fingerprint: "x",
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@ fn",
      lines: [
        { kind: " ", old: 1, new: 1, text: "a" },
        { kind: "-", old: 2, new: null, text: "b" },
        { kind: "+", old: null, new: 2, text: "B", noEol: true },
      ],
    },
    { header: "@@ -10 +10 @@", lines: [{ kind: "+", old: null, new: 10, text: "z" }] },
  ],
};

describe("patch", () => {
  it("fichier entier : en-têtes git, blocs, « No newline »", () => {
    expect(filePatch({ path: "x.ts", oldPath: null, status: "M" }, diff)).toBe(
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+B\n\ No newline at end of file\n@@ -10 +10 @@\n+z\n",
    );
  });
  it("un seul bloc ; ajout, suppression, renommage", () => {
    expect(filePatch({ path: "n.ts", oldPath: null, status: "A" }, diff, [1])).toBe("diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -10 +10 @@\n+z\n");
    expect(filePatch({ path: "n.ts", oldPath: null, status: "D" }, diff, [1])).toContain("deleted file mode 100644\n--- a/n.ts\n+++ /dev/null\n");
    expect(filePatch({ path: "n.ts", oldPath: "o.ts", status: "R" }, diff, [1])).toContain("diff --git a/o.ts b/n.ts\nrename from o.ts\nrename to n.ts\n--- a/o.ts\n+++ b/n.ts\n");
  });
  it("lignes choisies, dans l'ordre du diff", () => {
    expect(linesPatch(diff, [{ hunk: 1, line: 0 }, { hunk: 0, line: 1 }])).toBe("-b\n+z\n");
  });
});
