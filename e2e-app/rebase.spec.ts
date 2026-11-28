// Rebase interactif dans la vraie app : `git rebase -i` piloté par la liste de GitGR.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("rebase interactif : un commit retiré, un renommé, deux inversés ; vrai historique réécrit", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  for (const name of ["x", "y", "z"]) sandbox.commit(mine, `${name}.txt`, `${name}\n`, `ajout de ${name}`);

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option", { name: /^ajout de x/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rebase interactif à partir d’ici…" }).click();
    const view = page.getByRole("region", { name: "Rebase interactif" });
    const list = view.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(3);
    await expect(list).toBeFocused();

    // x : retiré ; y : renommé ; z remonté avant y.
    await page.keyboard.press("d");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("r");
    await page.keyboard.press("Enter");
    await view.getByRole("textbox").fill("y, renommé");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+ArrowUp");
    await view.getByRole("button", { name: "Lancer le rebase" }).click();
    await expect(page.getByText("Rebase de main terminé.")).toBeVisible();

    expect(git(mine, "log", "--format=%s", "-n", "3").split("\n")).toEqual(["y, renommé", "ajout de z", "init"]);
    expect(existsSync(join(mine, "x.txt"))).toBe(false);
    expect(git(mine, "status", "--porcelain")).toBe("");
  } finally {
    await app.close();
  }
});
