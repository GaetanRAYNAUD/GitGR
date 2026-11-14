import { describe, expect, it } from "vitest";
import { fileTree, type FileNode } from "./fileTree";
import type { FileChange } from "./types";

const f = (path: string): FileChange => ({ status: "M", path, oldPath: null });
const shape = (nodes: FileNode<FileChange>[]): unknown[] =>
  nodes.map((n) => (n.type === "dir" ? { [n.name]: shape(n.children), count: n.count } : n.name));

describe("fileTree", () => {
  it("dossiers d'abord, puis fichiers, triés", () => {
    const tree = fileTree([f("README.md"), f("src/b.ts"), f("src/a.ts"), f("docs/x.md"), f("Cargo.toml")]);
    expect(shape(tree)).toEqual([
      { docs: ["x.md"], count: 1 },
      { src: ["a.ts", "b.ts"], count: 2 },
      "Cargo.toml",
      "README.md",
    ]);
  });

  it("fusionne les dossiers à enfant unique", () => {
    const tree = fileTree([f("src/components/graph/A.tsx"), f("src/components/graph/B.tsx"), f("src/lib/x.ts")]);
    expect(shape(tree)).toEqual([
      { src: [{ "components/graph": ["A.tsx", "B.tsx"], count: 2 }, { lib: ["x.ts"], count: 1 }], count: 3 },
    ]);
    const graph = tree[0].type === "dir" ? tree[0].children[0] : null;
    expect(graph?.type === "dir" && graph.path).toBe("src/components/graph");
  });

  it("une chaîne entière jusqu'au fichier tient sur une ligne", () => {
    expect(shape(fileTree([f("src-tauri/src/history.rs")]))).toEqual([{ "src-tauri/src": ["history.rs"], count: 1 }]);
  });

  it("garde l'objet du fichier (statut, ancien chemin)", () => {
    const r: FileChange = { status: "R", path: "a/new.ts", oldPath: "a/old.ts" };
    const tree = fileTree([r]);
    const leaf = tree[0].type === "dir" ? tree[0].children[0] : null;
    expect(leaf?.type === "file" && leaf.file).toBe(r);
  });

  it("liste vide", () => {
    expect(fileTree([])).toEqual([]);
  });
});
