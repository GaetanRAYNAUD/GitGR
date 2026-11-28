import { describe, expect, it } from "vitest";
import { authorOptions } from "./AuthorFilter";

describe("authorOptions", () => {
  const authors = [
    { name: "Bob", email: "bob@x.fr", count: 9 },
    { name: "Moi", email: "Moi@x.fr", count: 2 },
    { name: "", email: "anon@x.fr", count: 1 },
  ];
  it("l'identité du dépôt en tête (sans casse), puis l'ordre reçu", () => {
    const opts = authorOptions(authors, "moi@X.fr", (n) => `${n} c`);
    expect(opts.map((o) => o.id)).toEqual(["Moi@x.fr", "bob@x.fr", "anon@x.fr"]);
    expect(opts[1].detail).toBe("bob@x.fr · 9 c");
    expect(opts[2].label).toBe("anon@x.fr");
  });
  it("sans identité : l'ordre reçu", () => {
    expect(authorOptions(authors, null, String).map((o) => o.id)).toEqual(["bob@x.fr", "Moi@x.fr", "anon@x.fr"]);
  });
});
