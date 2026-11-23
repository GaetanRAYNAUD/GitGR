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
    const unstaged = page.getByRole("complementary", { name: "Modifications en cours" }).getByRole("list", { name: "Non indexés", exact: true });
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
    const unstaged = changes.getByRole("list", { name: "Non indexés", exact: true });
    await unstaged.getByText("app.log").click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Ne plus suivre et ignorer app.log" }).click();
    await expect(changes.getByRole("list", { name: "Indexés", exact: true }).getByText("app.log")).toBeVisible();
    expect(readFileSync(join(mine, "app.log"), "utf8")).toBe("2\n");
    expect(readFileSync(join(mine, ".gitignore"), "utf8")).toBe("/app.log\n");
    expect(git(mine, "status", "--porcelain")).toBe("D  app.log\n?? .gitignore");
  } finally {
    await app.close();
  }
});
