// Clic droit sur un fichier d'un commit, dans la vraie app : la commande Rust vérifie le
// chemin. Seul le cas sans effet de bord est joué ici (fichier disparu : rien n'est lancé).

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
