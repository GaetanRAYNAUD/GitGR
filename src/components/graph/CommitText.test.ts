import { describe, expect, it } from "vitest";
import type { PullContext } from "../../store/pullList";
import { refTarget } from "./CommitText";

const gh: PullContext = { remote: "origin", kind: "github", url: "https://github.com", repo: "me/app", account: "github|https://github.com|me" };
const gl: PullContext = { ...gh, kind: "gitlab", url: "https://gitlab.ex.fr/", repo: "grp/app" };
const ref = (v: string, sigil: "#" | "!", number: number, repo: string | null = null) => ({ t: "ref" as const, v, sigil, number, repo });

describe("refTarget", () => {
  it("GitHub: open PR in GitGR, anything else on the web (issues/N redirects PRs)", () => {
    expect(refTarget(ref("#3", "#", 3), gh, [3])).toEqual({ show: 3 });
    expect(refTarget(ref("#4", "#", 4), gh, [3])).toEqual({ url: "https://github.com/me/app/issues/4" });
    expect(refTarget(ref("o/x#3", "#", 3, "o/x"), gh, [3])).toEqual({ url: "https://github.com/o/x/issues/3" });
    expect(refTarget(ref("!3", "!", 3), gh, [3])).toBeNull();
  });

  it("GitLab: !N in GitGR, #N issue on the web", () => {
    expect(refTarget(ref("!5", "!", 5), gl, [])).toEqual({ show: 5 });
    expect(refTarget(ref("#5", "#", 5), gl, [])).toEqual({ url: "https://gitlab.ex.fr/grp/app/-/issues/5" });
    expect(refTarget(ref("o/y!5", "!", 5, "o/y"), gl, [])).toEqual({ url: "https://gitlab.ex.fr/o/y/-/merge_requests/5" });
  });

  it("without account: on the web; without remote: no link", () => {
    expect(refTarget(ref("!5", "!", 5), { ...gl, account: null }, [])).toEqual({ url: "https://gitlab.ex.fr/grp/app/-/merge_requests/5" });
    expect(refTarget(ref("#5", "#", 5), undefined, [])).toBeNull();
  });
});
