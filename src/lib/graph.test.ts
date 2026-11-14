import { describe, expect, it } from "vitest";
import { layoutGraph, type GraphCommit } from "./graph";

const c = (sha: string, ...parents: string[]): GraphCommit => ({ sha, parents });
/** Colonnes seules d'une liste à plat [colonne, couleur…]. */
const cols = (flat: number[]) => flat.filter((_, i) => i % 2 === 0);

describe("layoutGraph", () => {
  it("historique linéaire : une seule colonne", () => {
    const { rows, width } = layoutGraph([c("c", "b"), c("b", "a"), c("a")]);
    expect(width).toBe(1);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(cols(rows[0].in)).toEqual([]); // pointe de branche
    expect(cols(rows[1].in)).toEqual([0]);
    expect(cols(rows[1].out)).toEqual([0]);
    expect(cols(rows[2].out)).toEqual([]); // commit racine
    expect(rows.every((r) => r.color === rows[0].color)).toBe(true);
  });

  it("branche puis fusion", () => {
    //  m        (fusion de main et feature)
    //  | f
    //  b |
    //  |/
    //  a
    const { rows, width } = layoutGraph([c("m", "b", "f"), c("f", "a"), c("b", "a"), c("a")]);
    expect(width).toBe(2);
    const [m, f, b, a] = rows;
    expect(m.col).toBe(0);
    expect(cols(m.out)).toEqual([0, 1]); // vers b et vers f (nouvelle colonne)
    expect(f.col).toBe(1);
    expect(cols(f.pass)).toEqual([0]); // la colonne de b traverse
    expect(b.col).toBe(0);
    expect(cols(b.pass)).toEqual([1]);
    expect(a.col).toBe(0);
    expect(cols(a.in)).toEqual([0, 1]); // les deux colonnes convergent
    expect(m.color).not.toBe(f.color);
  });

  it("deux pointes de branche qui partagent un parent", () => {
    const { rows } = layoutGraph([c("x", "a"), c("y", "a"), c("a")]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0]);
    expect(cols(rows[1].pass)).toEqual([0]);
    expect(cols(rows[2].in)).toEqual([0, 1]);
  });

  it("une colonne libérée est réutilisée et la largeur reste minimale", () => {
    // Deux branches successives, chacune fusionnée puis terminée.
    const { rows, width } = layoutGraph([
      c("m2", "m1", "f2"),
      c("f2", "m1"),
      c("m1", "a", "f1"),
      c("f1", "a"),
      c("a"),
    ]);
    expect(width).toBe(2);
    expect(rows[1].col).toBe(1);
    expect(rows[3].col).toBe(1);
  });

  it("la fusion rejoint une colonne qui attend déjà le parent", () => {
    // f est déjà attendu (colonne 1, pointe de feature) quand la fusion le référence.
    const { rows } = layoutGraph([c("t", "f"), c("m", "b", "f"), c("f", "a"), c("b", "a"), c("a")]);
    const m = rows[1];
    expect(m.col).toBe(1); // nouvelle pointe
    expect(cols(m.out)).toEqual([1, 0]); // le parent f est déjà attendu en colonne 0
    expect(rows[2].col).toBe(0);
  });

  it("parents absents (page suivante pas encore chargée) : les colonnes restent ouvertes", () => {
    const { rows, width } = layoutGraph([c("b", "a"), c("z", "y")]);
    expect(width).toBe(2);
    expect(cols(rows[1].pass)).toEqual([0]);
  });

  it("tient la charge sur un long historique", () => {
    const commits: GraphCommit[] = [];
    for (let i = 0; i < 50_000; i++) commits.push(c(`c${i}`, ...(i < 49_999 ? [`c${i + 1}`] : [])));
    const t0 = performance.now();
    const { rows, width } = layoutGraph(commits);
    expect(rows).toHaveLength(50_000);
    expect(width).toBe(1);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
