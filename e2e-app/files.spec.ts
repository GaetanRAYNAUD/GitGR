// Clic droit sur un fichier d'un commit, dans la vraie app : la commande Rust vérifie le
// chemin. Seul le cas sans effet de bord est joué ici (fichier disparu : rien n'est lancé).

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("ouvrir un fichier supprimé par le commit : message, aucun programme lancé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "vieux.txt", "x\n", "ajout de vieux.txt");
  git(mine, "rm", "-q", "vieux.txt");
  git(mine, "commit", "-q", "-m", "suppression de vieux.txt");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { name: /suppression de vieux\.txt/ }).click();
    const file = page.getByRole("complementary", { name: "Détails du commit" }).locator(".file-row", { hasText: "vieux.txt" });
    await file.click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Ouvrir avec le programme par défaut" }).click();
    await expect(page.getByRole("alert")).toContainText("Ce fichier n’existe pas (ou plus) dans la copie de travail.");
  } finally {
    await app.close();
  }
});

test("ignorer un fichier non suivi : ligne ajoutée au .gitignore, le fichier quitte la liste", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  mkdirSync(join(mine, "build"));
  sandbox.write(mine, "build/sortie.log", "x\n");
  sandbox.write(mine, "notes.txt", "y\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const unstaged = page.getByRole("complementary", { name: "Modifications en cours" }).getByRole("listbox", { name: "Non indexés", exact: true });
    await unstaged.getByText("sortie.log").click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Ignorer le dossier build/" }).click();
    await expect(unstaged.getByText("sortie.log")).toHaveCount(0);
    await expect(unstaged.getByText("notes.txt")).toBeVisible();
    expect(readFileSync(join(mine, ".gitignore"), "utf8")).toBe("/build/\n");
    expect(git(mine, "status", "--porcelain")).toBe("?? .gitignore\n?? notes.txt");
  } finally {
    await app.close();
  }
});

test("ne plus suivre un fichier modifié : retiré de l'index, gardé sur le disque, ignoré", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "app.log", "1\n", "ajout de app.log");
  sandbox.write(mine, "app.log", "2\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const changes = page.getByRole("complementary", { name: "Modifications en cours" });
    const unstaged = changes.getByRole("listbox", { name: "Non indexés", exact: true });
    await unstaged.getByText("app.log").click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Ne plus suivre et ignorer app.log" }).click();
    await expect(changes.getByRole("listbox", { name: "Indexés", exact: true }).getByText("app.log")).toBeVisible();
    expect(readFileSync(join(mine, "app.log"), "utf8")).toBe("2\n");
    expect(readFileSync(join(mine, ".gitignore"), "utf8")).toBe("/app.log\n");
    expect(git(mine, "status", "--porcelain")).toBe("D  app.log\n?? .gitignore");
  } finally {
    await app.close();
  }
});

test("arborescence et sélection multiple : ignorer un dossier, indexer deux fichiers d'un coup", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "a\n", "ajout de a.txt");
  sandbox.commit(mine, "b.txt", "b\n", "ajout de b.txt");
  mkdirSync(join(mine, "logs"));
  sandbox.write(mine, "logs/un.log", "1\n");
  sandbox.write(mine, "logs/deux.log", "2\n");
  sandbox.write(mine, "a.txt", "a modifié\n");
  sandbox.write(mine, "b.txt", "b modifié\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    // En arborescence, les listes sont des arbres (listbox en vue liste).
    const unstaged = panel.getByRole("tree", { name: "Non indexés", exact: true });
    const menu = page.getByRole("menu");
    await panel.getByRole("button", { name: "Arborescence" }).click();
    await unstaged.locator(".file-dir-row", { hasText: "logs" }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Ignorer le dossier logs/" }).click();
    await expect(unstaged).not.toContainText("un.log");
    expect(readFileSync(join(mine, ".gitignore"), "utf8")).toContain("/logs/");

    await unstaged.locator(".file-row", { hasText: "a.txt" }).click();
    await unstaged.locator(".file-row", { hasText: "b.txt" }).click({ modifiers: ["Control"] });
    await unstaged.locator(".file-row", { hasText: "b.txt" }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Indexer 2 fichiers" }).click();
    await expect(panel.getByRole("tree", { name: "Indexés", exact: true })).toContainText("b.txt");
    expect(git(mine, "diff", "--cached", "--name-only").split("\n").sort()).toEqual(["a.txt", "b.txt"]);
  } finally {
    await app.close();
  }
});

test("ligne « en cours » du graphe : tout indexer puis stasher au clic droit", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "1\n", "ajout de a.txt");
  sandbox.write(mine, "a.txt", "2\n");
  sandbox.write(mine, "b.txt", "nouveau\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const wip = page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { name: /^Modifications en cours/ });
    // Le menu est calculé à l'ouverture : on attend que l'état de la copie de travail soit lu.
    const changes = page.getByRole("complementary", { name: "Modifications en cours" });
    await expect(changes.getByRole("listbox", { name: "Non indexés", exact: true }).getByText("b.txt")).toBeVisible();
    await wip.click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Tout indexer" }).click();
    await expect(changes.getByRole("listbox", { name: "Indexés", exact: true }).getByText("b.txt")).toBeVisible();
    expect(git(mine, "status", "--porcelain")).toBe("M  a.txt\nA  b.txt");

    await wip.click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Stasher les modifications" }).click();
    // On attend l'interface, pas `git status` en boucle : il prendrait index.lock pendant le stash.
    await expect(wip).toHaveCount(0);
    expect(git(mine, "status", "--porcelain")).toBe("");
    expect(git(mine, "stash", "list")).toContain("modifications mises de côté");
  } finally {
    await app.close();
  }
});
