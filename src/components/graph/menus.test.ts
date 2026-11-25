import { beforeEach, describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { GitRef } from "../../lib/types";
import { useApp } from "../../store/app";
import { useBranchColorPopover } from "../BranchColorPopover";
import { type MenuAction, type MenuItem, useContextMenu } from "../ContextMenu";
import { absolutePath, branchColorItems, refMenu } from "./menus";

const t = ((key: string) => key) as unknown as TFunction;
const ref = (kind: GitRef["kind"], short: string): GitRef => ({
  name: kind === "remote" ? `refs/remotes/${short}` : `refs/heads/${short}`,
  short,
  kind,
  target: "abc",
  upstream: null,
  ahead: 0,
  behind: 0,
  gone: false,
});
const labels = (items: MenuItem[]) => items.filter((i): i is MenuAction => i !== "sep" && !("items" in i)).map((i) => i.label);

describe("absolutePath", () => {
  it("joins with the separator of the repository path", () => {
    expect(absolutePath("C:\\dev\\repo", "src/a.ts")).toBe("C:\\dev\\repo\\src\\a.ts");
    expect(absolutePath("C:\\dev\\repo\\", "a.ts")).toBe("C:\\dev\\repo\\a.ts");
    expect(absolutePath("/home/me/repo/", "src/a.ts")).toBe("/home/me/repo/src/a.ts");
  });
});

describe("branchColorItems", () => {
  const settings = useApp.getState().settings;
  beforeEach(() => {
    useApp.setState({ settings: { ...settings, branchColors: undefined, branchColorsOff: false } });
    useBranchColorPopover.setState({ open: null });
  });

  it("ouvre le choix de couleur au point du clic, pour le nom sans le remote", () => {
    useContextMenu.getState().open(40, 60, []);
    useContextMenu.getState().close();
    const [item] = branchColorItems(t, ref("remote", "origin/feature/x")) as MenuAction[];
    expect(item.label).toBe("menu.branchColor");
    expect(item.disabled).toBe(false);
    item.onClick();
    expect(useBranchColorPopover.getState().open).toMatchObject({ x: 40, y: 60, name: "feature/x" });
  });

  it("propose de retirer la règle quand elle porte le nom exact", () => {
    const none = branchColorItems(t, ref("local", "feature/x")) as MenuAction[];
    expect(none.map((i) => i.label)).toEqual(["menu.branchColor"]);
    expect(none[0].swatch).toBeNull();
    // « main » a une règle exacte dans les règles par défaut.
    const items = branchColorItems(t, ref("local", "main")) as MenuAction[];
    expect(items.map((i) => i.label)).toEqual(["menu.branchColor", "menu.branchColorRemove"]);
    expect(items[0].swatch).toBe("var(--g0)");
    items[1].onClick();
    const rules = useApp.getState().settings.branchColors ?? [];
    expect(rules.some((r) => r.pattern === "main")).toBe(false);
    expect(rules.some((r) => r.pattern === "master")).toBe(true);
  });

  it("grise les entrées, avec la raison, quand les couleurs fixes sont désactivées", () => {
    useApp.setState({ settings: { ...settings, branchColorsOff: true } });
    const items = branchColorItems(t, ref("local", "main")) as MenuAction[];
    expect(items.every((i) => i.disabled && i.title === "menu.why.branchColorsOff")).toBe(true);
    expect(items[0].swatch).toBeNull();
  });

  it("figure dans le menu des branches, pas dans celui des tags", () => {
    expect(labels(refMenu(t, "/r", ref("local", "main"), null))).toContain("menu.branchColor");
    expect(labels(refMenu(t, "/r", ref("remote", "origin/main"), null))).toContain("menu.branchColor");
    expect(labels(refMenu(t, "/r", ref("tag", "v1"), null))).not.toContain("menu.branchColor");
  });
});
