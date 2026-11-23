import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("parseMarkdown", () => {
  it("drops HTML comments from PR templates, keeps them inside code blocks", () => {
    const tree = parseMarkdown("<!-- Describe your change -->\nFix\n<!--\nmulti\nline -->\n```\n<!-- kept -->\n```");
    expect(tree).toEqual([
      { t: "p", c: [{ t: "text", v: "Fix" }] },
      { t: "code", lang: "", v: "<!-- kept -->" },
    ]);
    expect(parseMarkdown("<!-- only a template -->\n\n<!-- nothing else -->")).toEqual([]);
  });

  it("reads headings, fenced code with language, quotes and rules", () => {
    const tree = parseMarkdown("## Summary\n\n```ts\nconst a = 1;\n  b();\n```\n> quoted\n> **text**\n\n---");
    expect(tree).toEqual([
      { t: "h", level: 2, c: [{ t: "text", v: "Summary" }] },
      { t: "code", lang: "ts", v: "const a = 1;\n  b();" },
      { t: "quote", c: [{ t: "p", c: [{ t: "text", v: "quoted" }, { t: "br" }, { t: "strong", c: [{ t: "text", v: "text" }] }] }] },
      { t: "hr" },
    ]);
  });

  it("reads lists with task boxes, nesting and numbering", () => {
    const tree = parseMarkdown("- [x] done\n- [ ] todo\n  - nested\n\n3. three\n4. four");
    expect(tree).toEqual([
      {
        t: "list",
        ordered: false,
        start: 1,
        items: [
          { task: true, c: [{ t: "p", c: [{ t: "text", v: "done" }] }] },
          {
            task: false,
            c: [
              { t: "p", c: [{ t: "text", v: "todo" }] },
              { t: "list", ordered: false, start: 1, items: [{ task: null, c: [{ t: "p", c: [{ t: "text", v: "nested" }] }] }] },
            ],
          },
        ],
      },
      {
        t: "list",
        ordered: true,
        start: 3,
        items: [
          { task: null, c: [{ t: "p", c: [{ t: "text", v: "three" }] }] },
          { task: null, c: [{ t: "p", c: [{ t: "text", v: "four" }] }] },
        ],
      },
    ]);
  });

  it("keeps a list together across blank lines between items", () => {
    const tree = parseMarkdown("- a\n\n- b");
    expect(tree).toHaveLength(1);
    expect(tree[0].t === "list" && tree[0].items).toHaveLength(2);
  });

  it("reads tables with alignment", () => {
    const tree = parseMarkdown("| a | b |\n|:--|--:|\n| 1 | `x\\|y` |");
    expect(tree).toEqual([
      {
        t: "table",
        align: ["left", "right"],
        head: [[{ t: "text", v: "a" }], [{ t: "text", v: "b" }]],
        rows: [[[{ t: "text", v: "1" }], [{ t: "code", v: "x|y" }]]],
      },
    ]);
  });
});

describe("parseInline", () => {
  it("reads code, emphasis and strike, not snake_case", () => {
    expect(parseInline("`a*b*` **bold** *it* ~~old~~ snake_case_name")).toEqual([
      { t: "code", v: "a*b*" },
      { t: "text", v: " " },
      { t: "strong", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "it" }] },
      { t: "text", v: " " },
      { t: "del", c: [{ t: "text", v: "old" }] },
      { t: "text", v: " snake_case_name" },
    ]);
  });

  it("reads links, bare URLs and images as links; refuses other schemes", () => {
    expect(parseInline("[doc](https://x.dev/a_(b)) see https://ex.com/p. ![shot](https://img/x.png) [bad](javascript:alert(1))")).toEqual([
      { t: "link", href: "https://x.dev/a_(b)", c: [{ t: "text", v: "doc" }] },
      { t: "text", v: " see " },
      { t: "link", href: "https://ex.com/p", c: [{ t: "text", v: "https://ex.com/p" }] },
      { t: "text", v: ". " },
      { t: "link", href: "https://img/x.png", c: [{ t: "text", v: "shot" }], image: true },
      { t: "text", v: " " },
      { t: "link", href: null, c: [{ t: "text", v: "bad" }] },
    ]);
  });

  it("drops HTML tags but keeps their text; <br> and block ends as line breaks", () => {
    expect(parseInline("<details><summary>More</summary>a<br/>b</details>")).toEqual([
      { t: "text", v: "More" },
      { t: "br" },
      { t: "text", v: "a" },
      { t: "br" },
      { t: "text", v: "b" },
    ]);
  });

  it("keeps escaped characters and lone markers as text", () => {
    expect(parseInline("\\*not\\* 2 * 3 a < b")).toEqual([{ t: "text", v: "*not* 2 * 3 a < b" }]);
  });
});

describe("long texts", () => {
  it("stay fast (no copy of the rest of the text at each character)", () => {
    const line = "see https://h.dev/x <b>bold</b> `code` hhh ";
    const start = performance.now();
    const tree = parseMarkdown(line.repeat(5000));
    expect(tree).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("safeHref", () => {
  it("allows only http(s) and mailto", () => {
    expect(safeHref("https://a")).toBe("https://a");
    expect(safeHref("mailto:x@y")).toBe("mailto:x@y");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("../blob/main/x")).toBeNull();
  });
});
