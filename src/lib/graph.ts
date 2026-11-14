// Calcul des « lanes » du graphe des commits (fonction pure, testée dans graph.test.ts).
//
// Les commits arrivent du plus récent au plus ancien, chaque commit avant ses parents
// (`git log --date-order`). On garde une liste de colonnes actives ; chaque colonne
// « attend » un commit (le parent du dernier commit vu dans cette colonne).
//
// Pour chaque ligne, on produit de quoi dessiner sa moitié haute et sa moitié basse :
// - `pass` : colonnes qui traversent la ligne sans toucher le nœud (trait vertical complet) ;
// - `in`   : colonnes qui arrivent d'en haut sur le nœud (enfants du commit) ;
// - `out`  : colonnes qui partent du nœud vers le bas (parents du commit).
// Les colonnes ne bougent jamais d'une ligne à l'autre : une colonne libérée est
// réutilisée par la prochaine branche qui en a besoin.

export interface GraphCommit {
  sha: string;
  parents: string[];
}

export interface GraphRow {
  /** Colonne du nœud. */
  col: number;
  /** Indice de couleur du nœud (à prendre modulo la palette). */
  color: number;
  /** Paires à plat [colonne, couleur, colonne, couleur…]. */
  pass: number[];
  /** Paires à plat [colonne d'origine, couleur] : traits du haut de la ligne vers le nœud. */
  in: number[];
  /** Paires à plat [colonne d'arrivée, couleur] : traits du nœud vers le bas de la ligne. */
  out: number[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Nombre maximal de colonnes utilisées simultanément (largeur du graphe). */
  width: number;
}

export const PALETTE_SIZE = 8;

export function layoutGraph(commits: GraphCommit[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let width = 0;
  const rows: GraphRow[] = new Array(commits.length);

  const alloc = (sha: string): number => {
    let i = lanes.indexOf(null);
    if (i < 0) i = lanes.length;
    lanes[i] = sha;
    colors[i] = nextColor++ % PALETTE_SIZE;
    return i;
  };

  for (let r = 0; r < commits.length; r++) {
    const c = commits[r];

    // Colonnes qui attendaient ce commit (un ou plusieurs enfants).
    const incoming: number[] = [];
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === c.sha) incoming.push(j);

    const before = lanes.length;
    const isTip = incoming.length === 0;
    const col = isTip ? alloc(c.sha) : incoming[0];
    const color = colors[col];

    const row: GraphRow = { col, color, pass: [], in: [], out: [] };
    for (const j of incoming) row.in.push(j, colors[j]);

    // Les autres colonnes qui attendaient ce commit se terminent ici.
    for (const j of incoming) if (j !== col) lanes[j] = null;

    // Colonnes qui traversent : actives avant cette ligne et qui attendent un autre commit.
    for (let j = 0; j < before; j++) {
      if (lanes[j] !== null && !incoming.includes(j) && !(isTip && j === col)) row.pass.push(j, colors[j]);
    }

    // Parents : le premier prolonge la colonne du nœud, les autres (fusion) rejoignent
    // la colonne qui les attend déjà, ou en ouvrent une nouvelle.
    if (c.parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = c.parents[0];
      row.out.push(col, color);
      for (let k = 1; k < c.parents.length; k++) {
        const p = c.parents[k];
        let j = lanes.indexOf(p);
        if (j < 0) j = alloc(p);
        row.out.push(j, colors[j]);
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }
    width = Math.max(width, before, lanes.length, col + 1);
    rows[r] = row;
  }

  return { rows, width };
}
