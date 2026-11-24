// Sélection de plusieurs commits dans la vraie app : fichiers et diff cumulés d'une plage,
// cherry-pick du lot sur la branche courante.

import { readFileSync, writeFileSync } from "node:fs";
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

test("reset hard, puis le reflog retrouve le commit perdu et une branche le récupère", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "perdu.txt", "p\n", "commit à retrouver");
  const lost = git(mine, "rev-parse", "HEAD");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option").nth(1).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Reset de main ici…" }).click();
    await page.getByRole("alertdialog", { name: /^Reset de main sur/ }).getByRole("button", { name: "Hard (tout abandonner)" }).click();
    await expect(graph).not.toContainText("commit à retrouver");
    expect(git(mine, "status", "--porcelain")).toBe("");

    await page.getByRole("button", { name: "Reflog" }).click();
    const list = page.getByRole("region", { name: "Reflog" }).getByRole("list", { name: "Reflog" });
    await expect(list.getByRole("listitem").first()).toContainText("reset");
    const entry = list.getByRole("listitem").filter({ hasText: "commit à retrouver" }).first();
    await expect(entry).toContainText("hors des branches");
    await entry.getByRole("button").click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Nouvelle branche ici…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await dialog.getByLabel("Nom de la branche").fill("retrouvee");
    await dialog.getByLabel("Passer sur la nouvelle branche").uncheck();
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(entry).not.toContainText("hors des branches");
    expect(git(mine, "rev-parse", "retrouvee")).toBe(lost);
  } finally {
    await app.close();
  }
});

test("chercher quand un texte a été ajouté puis retiré, limité à un fichier", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "aiguille\n", "ajout de l'aiguille");
  sandbox.commit(mine, "b.txt", "aiguille aussi\n", "aiguille dans b");
  sandbox.commit(mine, "a.txt", "rien\n", "retrait de l'aiguille");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("button", { name: "Chercher", exact: true }).click();
    const view = page.getByRole("region", { name: "Recherche dans les modifications" });
    await view.getByLabel("Texte cherché").fill("aiguille");
    await view.getByLabel("Fichier ou dossier (facultatif)").fill("a.txt");
    await view.getByRole("button", { name: "Chercher" }).click();
    const results = view.getByRole("list", { name: /commits?$/ }).getByRole("listitem");
    await expect(results).toHaveText([/retrait de l'aiguille/, /ajout de l'aiguille/]);
    await view.getByLabel("Fichier ou dossier (facultatif)").fill("");
    await view.getByRole("button", { name: "Chercher" }).click();
    await expect(results).toHaveCount(3);
    await results.nth(1).getByRole("button").dblclick();
    await expect(view).toHaveCount(0);
    await expect(page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { selected: true })).toContainText("aiguille dans b");
  } finally {
    await app.close();
  }
});

test("historique d'un fichier renommé : ses commits avant et après le renommage", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\nquatre\n", "création de a");
  sandbox.commit(mine, "b.txt", "autre\n", "autre fichier");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\nquatre\ncinq\n", "a modifié");
  git(mine, "mv", "a.txt", "c.txt");
  git(mine, "commit", "-qm", "a renommé en c");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option").first().click();
    const panel = page.getByRole("complementary", { name: "Détails du commit" });
    await panel.locator(".file-row", { hasText: "c.txt" }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Historique du fichier" }).click();
    const view = page.getByRole("region", { name: "Historique du fichier" });
    const rows = view.getByRole("list", { name: /commits?$/ }).getByRole("listitem");
    await expect(rows).toHaveText([/a renommé en c.*renommé depuis a\.txt/, /a modifié/, /création de a/, /init/]);
    await rows.nth(1).getByRole("button").dblclick();
    const diff = page.getByRole("region", { name: /^Diff de / });
    await expect(diff.locator("tr.add")).toContainText("cinq");
  } finally {
    await app.close();
  }
});

test("blame de la copie de travail : chaque ligne avec son commit, les nouvelles pas encore commitées", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "un\ndeux\n", "première version");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\n", "ajout de trois");
  writeFileSync(join(mine, "a.txt"), "un\ndeux\ntrois\nquatre\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const staging = page.getByRole("complementary", { name: "Modifications en cours" });
    await staging.locator(".file-row", { hasText: "a.txt" }).first().click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Blame", exact: true }).click();
    const view = page.getByRole("region", { name: "Blame" });
    await expect(view).toContainText("copie de travail");
    const rows = view.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator(".blame-commit")).toContainText("première version");
    await expect(rows.nth(2).locator(".blame-commit")).toContainText("ajout de trois");
    await expect(rows.nth(3).locator(".blame-commit")).toContainText("Pas encore commité");
    await expect(rows.nth(3).locator(".blame-text")).toHaveText("quatre");
  } finally {
    await app.close();
  }
});

test("revert de deux commits sélectionnés : leurs fichiers retirés par deux nouveaux commits", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "x.txt", "x\n", "ajout de x");
  sandbox.commit(mine, "y.txt", "y\n", "ajout de y");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option", { name: /ajout de y/ }).click();
    await graph.getByRole("option", { name: /ajout de x/ }).click({ modifiers: ["Shift"] });
    await graph.getByRole("option", { name: /ajout de x/ }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Revert des 2 commits" }).click();
    await expect(page.getByText("Revert de 2 commits sur main terminé.")).toBeVisible();
    expect(git(mine, "log", "--format=%s", "-n", "2").split("\n")).toEqual(['Revert "ajout de x"', 'Revert "ajout de y"']);
    expect(git(mine, "ls-files").split("\n")).not.toContain("x.txt");
  } finally {
    await app.close();
  }
});

test("squash de deux commits au milieu de la branche : le suivant rejoué, un commit de moins", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "p.txt", "p\n", "partie 1");
  sandbox.commit(mine, "q.txt", "q\n", "partie 2");
  sandbox.commit(mine, "r.txt", "r\n", "suite");
  const before = Number(git(mine, "rev-list", "--count", "HEAD"));

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option", { name: /partie 2/ }).click();
    await graph.getByRole("option", { name: /partie 1/ }).click({ modifiers: ["Control"] });
    await graph.getByRole("option", { name: /partie 1/ }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Squash des 2 commits…" }).click();
    const dialog = page.getByRole("dialog", { name: "Squash de 2 commits" });
    await expect(dialog.getByRole("textbox")).toHaveValue("partie 1");
    await dialog.getByRole("textbox").fill("les deux parties");
    await dialog.getByRole("button", { name: "Réunir" }).click();
    await expect(page.getByText("2 commits réunis en un seul.")).toBeVisible();
    expect(Number(git(mine, "rev-list", "--count", "HEAD"))).toBe(before - 1);
    expect(git(mine, "log", "--format=%s", "-n", "2").split("\n")).toEqual(["suite", "les deux parties"]);
    expect(git(mine, "log", "-1", "--format=%b", "HEAD~1")).toContain("* partie 2");
  } finally {
    await app.close();
  }
});
