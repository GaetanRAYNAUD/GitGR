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
  sandbox.write(mine, "neuf.txt", "n\n");
  git(mine, "stash", "push", "-q", "-u", "-m", "le plus récent");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const stashes = page.getByRole("navigation", { name: "Branches et tags" }).getByRole("group", { name: "Stashes" });
    await expect(stashes.getByRole("treeitem")).toHaveText([/le plus récent/, /le plus ancien/]);
    const menu = page.getByRole("menu");

    // Contenu du plus récent : le fichier suivi et le non suivi, chacun avec son diff.
    await stashes.getByRole("treeitem", { name: /le plus récent/ }).click();
    const view = page.getByRole("region", { name: "Stash « le plus récent »" });
    await view.locator(".file-row", { hasText: "neuf.txt" }).click();
    await expect(view.locator(".pull-file-diff tr.add")).toHaveCount(1);
    await view.locator(".file-row", { hasText: "a.txt" }).click();
    await expect(view.locator(".pull-file-diff tr.add")).toContainText("récent");
    await page.keyboard.press("Escape");

    await stashes.getByRole("treeitem", { name: /le plus ancien/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Appliquer (le garder)" }).click();
    await expect(page.getByRole("complementary", { name: "Modifications en cours" })).toContainText("a.txt");
    expect(readFileSync(join(mine, "a.txt"), "utf8")).toBe("ancien\n");
    expect(git(mine, "stash", "list").split("\n")).toHaveLength(2);

    // Renommer le plus ancien : nouveau message, en haut de la pile, même contenu.
    await stashes.getByRole("treeitem", { name: /le plus ancien/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Renommer…" }).click();
    const rename = page.getByRole("dialog", { name: "Renommer le stash" });
    await rename.getByRole("textbox").fill("ancien renommé");
    await rename.getByRole("button", { name: "Renommer" }).click();
    await expect(stashes.getByRole("treeitem")).toHaveText([/ancien renommé/, /le plus récent/]);
    expect(git(mine, "stash", "list", "--format=%gs").split("\n")).toEqual(["On main: ancien renommé", "On main: le plus récent"]);

    await stashes.getByRole("treeitem", { name: /le plus récent/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Supprimer…" }).click();
    await page.getByRole("alertdialog", { name: "Supprimer ce stash ?" }).getByRole("button", { name: "Supprimer" }).click();
    await expect(stashes.getByRole("treeitem")).toHaveText([/ancien renommé/]);
    expect(git(mine, "stash", "list")).toContain("ancien renommé");
  } finally {
    await app.close();
  }
});

test("stash partiel de deux fichiers sur trois, et sa ligne dans le graphe sous le commit suivant", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "a\n", "ajout de a.txt");
  sandbox.commit(mine, "b.txt", "b\n", "ajout de b.txt");
  sandbox.write(mine, "a.txt", "a modifié\n");
  sandbox.write(mine, "b.txt", "b modifié\n");
  sandbox.write(mine, "neuf.txt", "n\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    await panel.getByRole("button", { name: "Stash…" }).click();
    const dialog = page.getByRole("dialog", { name: "Mettre de côté des fichiers" });
    await dialog.getByRole("checkbox", { name: /a\.txt/ }).check();
    await dialog.getByRole("checkbox", { name: /neuf\.txt/ }).check();
    await dialog.getByRole("textbox").fill("a et neuf");
    await dialog.getByRole("button", { name: "Mettre de côté" }).click();
    await expect(panel).not.toContainText("neuf.txt");
    await expect(panel).toContainText("b.txt");
    expect(readFileSync(join(mine, "a.txt"), "utf8")).toBe("a\n");
    expect(git(mine, "stash", "show", "--include-untracked", "--name-only", "stash@{0}").split("\n").sort()).toEqual(["a.txt", "neuf.txt"]);

    // Un commit de plus : la ligne du stash reste au-dessus du commit d'où il part.
    git(mine, "commit", "-qam", "b modifié");
    await page.getByRole("button", { name: "Actualiser" }).click();
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    const rows = graph.getByRole("option");
    await expect(rows.nth(0)).toContainText("b modifié");
    await expect(rows.nth(1)).toContainText("a et neuf");
    await expect(rows.nth(1)).toHaveClass(/stash/);
    await expect(rows.nth(2)).toContainText("ajout de b.txt");

    await rows.nth(1).click();
    await expect(page.getByRole("region", { name: "Stash « a et neuf »" }).locator(".file-row")).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test("raccourcis de la barre d'outils : Ctrl+Maj+S stashe, Ctrl+Maj+P réapplique", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "a\n", "ajout de a.txt");
  sandbox.write(mine, "a.txt", "modifié\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const pop = page.getByRole("toolbar", { name: "Actions du dépôt" }).getByRole("button", { name: /^Pop/ });
    await expect(page.locator(".changes-pill")).toBeVisible();
    await page.keyboard.press("Control+Shift+S");
    // On attend l'interface (pas `git` en boucle, qui prendrait index.lock pendant le stash).
    await expect(pop).toHaveAttribute("aria-label", "Pop, 1 stash en réserve");
    expect(git(mine, "stash", "list").split("\n")).toHaveLength(1);
    expect(readFileSync(join(mine, "a.txt"), "utf8")).toBe("a\n");

    // Le compteur de Pop arrive avant la fin du stash (relecture) : Pop serait refusé
    // (« une commande est en cours »).
    await expect(page.locator(".tools > [role=status]")).toHaveText("");
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator(".changes-pill")).toBeVisible();
    expect(readFileSync(join(mine, "a.txt"), "utf8")).toBe("modifié\n");
  } finally {
    await app.close();
  }
});
