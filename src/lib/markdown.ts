// Markdown des descriptions et commentaires de PR / MR (GitHub, GitLab), lu en un arbre que
// `Markdown.tsx` rend en éléments React : aucun HTML injecté. Le HTML brut du texte n'est
// pas interprété : commentaires `<!-- … -->` (modèles de PR) retirés, balises retirées
// (leur texte reste), `<br>` en retour à la ligne.
//
// Couvre ce qu'on trouve dans une PR : titres, paragraphes, listes (imbriquées, cases à
// cocher), citations, blocs de code, tableaux, filets ; en ligne : code, gras, italique,
// barré, liens (et adresses nues), images (montrées comme des liens : rien n'est chargé).

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "br" }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  /** `href` absent : adresse refusée (autre chose que http(s) / mailto), texte seul. */
  | { t: "link"; href: string | null; c: Inline[]; image?: boolean };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: { task: boolean | null; c: Block[] }[] }
  | { t: "table"; align: ("left" | "center" | "right" | null)[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*)|$)/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const blank = (l: string) => l.trim() === "";

/** Retire les commentaires HTML hors des blocs de code (ils peuvent tenir sur plusieurs lignes). */
function stripComments(lines: string[]): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  let chunk: string[] = [];
  const flush = () => {
    if (chunk.length) out.push(...chunk.join("\n").replace(/<!--[\s\S]*?(?:-->|$)/g, "").split("\n"));
    chunk = [];
  };
  for (const l of lines) {
    const m = FENCE.exec(l);
    if (fence) {
      out.push(l);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]) fence = null;
    } else if (m) {
      flush();
      out.push(l);
      fence = m[1];
    } else chunk.push(l);
  }
  flush();
  return out;
}

/** Cellules d'une ligne de tableau (`|` échappés gardés). */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Une ligne qui commence un autre bloc : elle termine le paragraphe en cours. */
function startsBlock(l: string): boolean {
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || /^ {0,3}([-*+]|1[.)])\s+\S/.test(l);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(l);
    if (fence) {
      const indent = l.length - l.trimStart().length;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const m = FENCE.exec(lines[i]);
        if (m && m[1][0] === fence[1][0] && m[1].length >= fence[1].length && !m[2]) {
          i++;
          break;
        }
        // Le retrait de la clôture ouvrante est retiré des lignes du bloc.
        body.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ""));
        i++;
      }
      blocks.push({ t: "code", lang: fence[2], v: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(l);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, c: parseInline(h[2] ?? "") });
      i++;
      continue;
    }
    if (HR.test(l)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(l)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || body.length > 0)) {
        if (!QUOTE.test(lines[i]) && startsBlock(lines[i])) break;
        body.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      blocks.push({ t: "quote", c: parseBlocks(body) });
      continue;
    }
    const item = ITEM.exec(l);
    if (item) {
      i = parseList(lines, i, blocks);
      continue;
    }
    if (l.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = cells(l);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        const r = cells(lines[i]);
        rows.push(head.map((_, k) => parseInline(r[k] ?? "")));
        i++;
      }
      blocks.push({ t: "table", align, head: head.map(parseInline), rows });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]))) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

/** Une liste à partir de la ligne `i` ; rend l'indice de la ligne qui suit. Un élément garde
 *  les lignes plus en retrait que son marqueur (paragraphes suivants, sous-listes). */
function parseList(lines: string[], i: number, blocks: Block[]): number {
  const first = ITEM.exec(lines[i])!;
  const ordered = /\d/.test(first[2]);
  const base = first[1].length;
  const items: { task: boolean | null; c: Block[] }[] = [];
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const content = base + m[2].length + 1;
    const body = [m[3] ?? ""];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      const indent = l.length - l.trimStart().length;
      if (blank(l)) {
        // Ligne vide : l'élément continue si la suivante est en retrait.
        const next = lines[i + 1];
        if (next !== undefined && !blank(next) && next.length - next.trimStart().length > base) {
          body.push("");
          i++;
          continue;
        }
        break;
      }
      if (indent > base) {
        body.push(l.slice(Math.min(indent, content)));
        i++;
        continue;
      }
      // Ligne de continuation sans retrait (paragraphe paresseux), sauf un nouveau bloc.
      if (!startsBlock(l) && !ITEM.test(l) && !blank(body[body.length - 1])) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    let task: boolean | null = null;
    const tm = /^\[([ xX])\]\s+/.exec(body[0]);
    if (tm) {
      task = tm[1] !== " ";
      body[0] = body[0].slice(tm[0].length);
    }
    items.push({ task, c: parseBlocks(body) });
    // Une ligne vide entre deux éléments ne coupe pas la liste.
    if (i < lines.length && blank(lines[i]) && i + 1 < lines.length) {
      const n = ITEM.exec(lines[i + 1]);
      if (n && n[1].length === base && /\d/.test(n[2]) === ordered) i++;
    }
  }
  blocks.push({ t: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items });
  return i;
}

/** Adresse d'un lien, seulement http(s) et mailto ; le reste (relatif, javascript:…) refusé. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>";

/** Fin du lien `](url "titre")` à partir de `i` (sur le `(`) : [url, indice après `)`]. */
function linkTarget(s: string, i: number): [string, number] | null {
  if (s[i] !== "(") return null;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "\\") k++;
    else if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) {
      const inner = s.slice(i + 1, k).trim();
      const url = inner.startsWith("<") ? inner.slice(1, inner.indexOf(">") >>> 0) : inner.split(/\s+/)[0];
      return [url, k + 1];
    }
  }
  return null;
}

/** `]` qui ferme le `[` en `i` (crochets imbriqués comptés). */
function closingBracket(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "\\") k++;
    else if (s[k] === "`") {
      const end = s.indexOf("`", k + 1);
      if (end > 0) k = end;
    } else if (s[k] === "[") depth++;
    else if (s[k] === "]" && --depth === 0) return k;
  }
  return -1;
}

// Lues à une position donnée (drapeau `y`), sans recopier la fin du texte à chaque caractère.
const BACKTICKS = /`+/y;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?\/?>/y;
const BARE_URL = /https?:\/\/[^\s<>]+/iy;

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (n: Inline) => {
    if (text) out.push({ t: "text", v: text });
    text = "";
    out.push(n);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      push({ t: "br" });
      i++;
      continue;
    }
    if (c === "`") {
      const run = at(BACKTICKS, s, i)![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0 && s[end + run.length] !== "`") {
        let v = s.slice(i + run.length, end).replace(/\n/g, " ");
        if (v.length > 1 && v.startsWith(" ") && v.endsWith(" ")) v = v.slice(1, -1);
        push({ t: "code", v });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }
    if (c === "<") {
      const auto = at(AUTOLINK, s, i);
      if (auto) {
        push({ t: "link", href: auto[1], c: [{ t: "text", v: auto[1] }] });
        i += auto[0].length;
        continue;
      }
      // Balise HTML : retirée (son texte reste) ; `<br>` et la fin d'un bloc (`</summary>`,
      // `</p>`…) en retour à la ligne, sauf en fin de texte.
      const tag = at(TAG, s, i);
      if (tag) {
        const name = tag[2].toLowerCase();
        const breaks = name === "br" || (tag[1] === "/" && /^(summary|p|div|li|tr|h[1-6])$/.test(name));
        if (breaks && s.slice(i + tag[0].length).replace(/<[^<>]*>/g, "").trim()) push({ t: "br" });
        i += tag[0].length;
        continue;
      }
    }
    const image = c === "!" && s[i + 1] === "[";
    if (c === "[" || image) {
      const open = image ? i + 1 : i;
      const close = closingBracket(s, open);
      const target = close > 0 ? linkTarget(s, close + 1) : null;
      if (target) {
        const label = s.slice(open + 1, close);
        const inner = image ? [{ t: "text" as const, v: label || target[0] }] : parseInline(label);
        push({ t: "link", href: safeHref(target[0]), c: inner, image: image || undefined });
        i = target[1];
        continue;
      }
    }
    if (c === "h" || c === "H") {
      const bare = at(BARE_URL, s, i);
      if (bare && !wordChar(s[i - 1])) {
        // Ponctuation finale hors du lien, parenthèse fermante seulement si non ouverte dedans.
        let url = bare[0].replace(/[.,;:!?'"*_~]+$/, "");
        while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
        push({ t: "link", href: url, c: [{ t: "text", v: url }] });
        i += url.length;
        continue;
      }
    }
    if (c === "*" || c === "_" || c === "~") {
      const run = c === "~" ? (s.startsWith("~~", i) ? "~~" : "") : s.startsWith(c + c, i) ? c + c : c;
      // `_` seulement en bord de mot (pas `snake_case`) ; jamais suivi d'un espace.
      const opens = run && s[i + run.length] && !/\s/.test(s[i + run.length]) && !(c === "_" && wordChar(s[i - 1]));
      if (opens) {
        let end = i + run.length;
        let found = -1;
        while ((end = s.indexOf(run, end + 1)) > 0) {
          if (!/\s/.test(s[end - 1]) && !(c === "_" && wordChar(s[end + run.length])) && s[end + run.length] !== c) {
            found = end;
            break;
          }
        }
        if (found > 0) {
          const kind = c === "~" ? "del" : run.length === 2 ? "strong" : "em";
          push({ t: kind, c: parseInline(s.slice(i + run.length, found)) });
          i = found + run.length;
          continue;
        }
      }
    }
    text += c;
    i++;
  }
  if (text) out.push({ t: "text", v: text });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(stripComments(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")));
}
