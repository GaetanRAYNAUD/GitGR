// Conflits qu'on ne règle pas ligne à ligne, dans la vraie app : image binaire modifiée des deux
// côtés, fichier modifié ici et supprimé de l'autre côté.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

// PNG 2×1 et 1×1.
const PNG2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGAAm8gP9CtIkSQAAAABJRU5ErkJggg==", "base64");
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("merge en conflit : image gardée de l'autre côté, fichier supprimé de l'autre côté gardé ici", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  writeFileSync(join(mine, "logo.png"), PNG1);
  writeFileSync(join(mine, "d.txt"), "1\n");
  git(mine, "add", ".");
  git(mine, "commit", "-qm", "base");
  git(mine, "switch", "-q", "-c", "sujet");
  writeFileSync(join(mine, "logo.png"), PNG2);
  git(mine, "rm", "-q", "d.txt");
  git(mine, "commit", "-qam", "sujet");
  git(mine, "switch", "-q", "main");
  writeFileSync(join(mine, "logo.png"), Buffer.concat([PNG1, Buffer.from([0])]));
  writeFileSync(join(mine, "d.txt"), "2\n");
  git(mine, "commit", "-qam", "nous");
  try {
    git(mine, "merge", "-q", "sujet");
  } catch {
    // Conflit attendu.
  }

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const conflicts = page.getByRole("complementary", { name: "Modifications en cours" }).getByRole("listbox", { name: "Conflits" });
    await conflicts.getByRole("option").filter({ hasText: "logo.png" }).click();
    const view = page.getByRole("region", { name: "Résolution du conflit de logo.png" });
    await expect(view.getByRole("img", { name: "Branche fusionnée" })).toBeVisible();
    await expect(view).toContainText("2 × 1 px");
    await view.getByRole("button", { name: "Garder : Branche fusionnée" }).click();

    const next = page.getByRole("region", { name: "Résolution du conflit de d.txt" });
    await expect(next).toContainText("supprimé de « Branche fusionnée »");
    await next.getByRole("button", { name: "Garder : Notre branche" }).click();
    await expect(next).toHaveCount(0);

    expect(readFileSync(join(mine, "logo.png")).equals(PNG2)).toBe(true);
    expect(existsSync(join(mine, "d.txt"))).toBe(true);
    expect(git(mine, "diff", "--name-only", "--diff-filter=U")).toBe("");
  } finally {
    await app.close();
  }
});

test("merge lancé depuis GitGR qui s'arrête en conflit : la résolution s'ouvre d'office", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "switch", "-q", "-c", "sujet");
  sandbox.commit(mine, "a.txt", "sujet\n2\n3\n4\n5\n", "sujet");
  git(mine, "switch", "-q", "main");
  sandbox.commit(mine, "a.txt", "main\n2\n3\n4\n5\n", "main");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
    await locals.getByRole("treeitem", { name: /^sujet/ }).click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Merge dans main" }).click();
    const view = page.getByRole("region", { name: "Résolution du conflit de a.txt" });
    await expect(view).toBeVisible();
    await expect(view.getByRole("group", { name: /^Conflit 1 \/ 1/ })).toBeVisible();
  } finally {
    await app.close();
  }
});
