// Sélection de plusieurs commits dans la vraie app : fichiers et diff cumulés d'une plage,
// cherry-pick du lot sur la branche courante.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("plage de commits : fichiers cumulés, diff de la plage, puis cherry-pick sur main", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "checkout", "-q", "-b", "sujet");
  sandbox.commit(mine, "b.txt", "b\n", "ajout de b");
  sandbox.commit(mine, "b.txt", "b\nb2\n", "suite de b");
  sandbox.commit(mine, "c.txt", "c\n", "ajout de c");
  git(mine, "checkout", "-q", "main");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    const panel = page.getByRole("complementary", { name: "Commits sélectionnés" });
    await graph.getByRole("option", { name: /ajout de c/ }).click();
    await graph.getByRole("option", { name: /ajout de b/ }).click({ modifiers: ["Shift"] });
    await expect(panel).toContainText("3 commits sélectionnés");
    await expect(panel).toContainText("Plage contiguë");
    await expect(panel.locator(".file-row")).toHaveCount(2);

    // Diff cumulé de b.txt : ses deux lignes ajoutées, depuis le parent du plus ancien.
    await panel.locator(".file-row", { hasText: "b.txt" }).click();
    const diff = page.getByRole("region", { name: "Diff de b.txt" });
    await expect(diff.locator("tr.add")).toHaveCount(2);
    await page.keyboard.press("Escape");

    // « ajout de b » déjà sur main : sauté ; les deux autres appliqués.
    git(mine, "cherry-pick", git(mine, "rev-parse", "sujet~2"));
    await page.getByRole("button", { name: "Actualiser" }).click();
    await graph.getByRole("option", { name: /ajout de c/ }).click();
    await graph.getByRole("option", { name: /suite de b/ }).click({ modifiers: ["Control"] });
    await graph.getByRole("option", { name: /ajout de b/ }).last().click({ modifiers: ["Control"] });
    await panel.getByRole("button", { name: "Cherry-pick des 3 commits sur main" }).click();
    await expect(page.getByText("Cherry-pick de 3 commits sur main terminé.")).toBeVisible();
    expect(git(mine, "log", "--format=%s", "-n", "3", "main").split("\n")).toEqual(["ajout de c", "suite de b", "ajout de b"]);
    expect(readFileSync(join(mine, "b.txt"), "utf8")).toBe("b\nb2\n");
  } finally {
    await app.close();
  }
});
