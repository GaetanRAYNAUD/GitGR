// Section « Stashes » dans la vraie app : la pile entière lue par git, appliquer un stash qui
// n'est pas le dernier, en supprimer un.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("stashes : toute la pile, appliquer le plus ancien sans le retirer, supprimer le dernier", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "a\n", "ajout de a.txt");
  sandbox.write(mine, "a.txt", "ancien\n");
  git(mine, "stash", "push", "-q", "-m", "le plus ancien");
  sandbox.write(mine, "a.txt", "récent\n");
  git(mine, "stash", "push", "-q", "-m", "le plus récent");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const stashes = page.getByRole("navigation", { name: "Branches et tags" }).getByRole("list", { name: "Stashes" });
    await expect(stashes.getByRole("button")).toHaveText([/le plus récent/, /le plus ancien/]);
    const menu = page.getByRole("menu");

    await stashes.getByRole("button", { name: /le plus ancien/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Appliquer (le garder)" }).click();
    await expect(page.getByRole("complementary", { name: "Modifications en cours" })).toContainText("a.txt");
    expect(readFileSync(join(mine, "a.txt"), "utf8")).toBe("ancien\n");
    expect(git(mine, "stash", "list").split("\n")).toHaveLength(2);

    await stashes.getByRole("button", { name: /le plus récent/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Supprimer…" }).click();
    await page.getByRole("alertdialog", { name: "Supprimer ce stash ?" }).getByRole("button", { name: "Supprimer" }).click();
    await expect(stashes.getByRole("button")).toHaveText([/le plus ancien/]);
    expect(git(mine, "stash", "list")).toContain("le plus ancien");
  } finally {
    await app.close();
  }
});
