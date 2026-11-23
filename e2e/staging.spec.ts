import { expect, test, type Page } from "@playwright/test";
import { openRepos, tab } from "./fixtures";

// « api-backend » (2e dépôt simulé) a des modifications en cours : 3 fichiers non indexés
// (dont un non suivi) et 2 indexés ; voir src/lib/mockWorktree.ts.

const panel = (page: Page) => page.getByRole("complementary", { name: "Modifications en cours" });
const unstaged = (page: Page) => panel(page).getByRole("list", { name: "Non indexés", exact: true });
const staged = (page: Page) => panel(page).getByRole("list", { name: "Indexés", exact: true });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 2);
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
});

test("la ligne « en cours » est sélectionnée d'office et liste les fichiers", async ({ page }) => {
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("Modifications en cours — 4 fichiers");
  await expect(panel(page)).toContainText("sur main · 4 fichiers");
  await expect(unstaged(page)).toContainText("render.ts");
  await expect(unstaged(page)).toContainText("notes.txt");
  await expect(staged(page)).toContainText("lanes.ts");
});

test("indexer des lignes choisies depuis le diff, puis commiter", async ({ page }) => {
  await unstaged(page).getByText("render.ts").click();
  const diff = page.getByRole("region", { name: "Diff de src/graph/render.ts" });
  await expect(diff).toContainText("Non indexé");

  // Sélection d'une plage (clic puis Maj+clic) puis indexation.
  await diff.locator("tr", { hasText: "rows.length * 34" }).click();
  await diff.locator("tr", { hasText: "const width" }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 lignes sélectionnées")).toBeVisible();
  await page.getByRole("button", { name: "Indexer 3 lignes" }).click();

  // Tout le fichier est indexé : le diff passe côté « Indexé ».
  await expect(diff).toContainText("Indexé");
  await expect(staged(page)).toContainText("render.ts");
  await expect(unstaged(page)).not.toContainText("render.ts");

  await page.getByPlaceholder("Résumé").fill("feat: rendu du canvas");
  await page.getByPlaceholder("Description (optionnelle)").fill("Largeur calculée à partir des lanes.");
  await page.getByRole("button", { name: "Commiter 3 fichiers" }).click();

  await expect(staged(page)).toHaveCount(0);
  await expect(panel(page)).toContainText("Rien d’indexé pour l’instant.");
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("");
  await expect(graph(page).getByRole("option").nth(1)).toContainText("feat: rendu du canvas");
});

test("indexer / retirer des fichiers et tout indexer", async ({ page }) => {
  const row = unstaged(page).locator("li", { hasText: "notes.txt" });
  await row.hover();
  await row.getByRole("button", { name: "Indexer" }).click();
  await expect(staged(page)).toContainText("notes.txt");

  await panel(page).getByRole("button", { name: "Tout retirer" }).click();
  await expect(panel(page)).toContainText("Rien d’indexé pour l’instant.");
  await panel(page).getByRole("button", { name: "Tout indexer" }).click();
  await expect(panel(page)).toContainText("Rien à indexer.");
});

test("tout annuler (avec confirmation) nettoie la copie de travail", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Tout annuler" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Annuler toutes les modifications ?" });
  await expect(dialog).toContainText("irréversible");
  await dialog.getByRole("button", { name: "Tout annuler" }).click();

  // Plus rien en cours : la ligne disparaît et le commit courant est sélectionné.
  await expect(graph(page).getByRole("option").first()).not.toContainText("Modifications en cours");
  await expect(page.getByRole("complementary", { name: "Détails du commit" })).toBeVisible();
});

test("amend : reprend le message du dernier commit", async ({ page }) => {
  await panel(page).getByRole("checkbox", { name: "Amend" }).check();
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("fix: correctif local pas encore poussé");
  await expect(panel(page).getByRole("button", { name: "Modifier le dernier commit" })).toBeEnabled();
  await panel(page).getByRole("checkbox", { name: "Amend" }).uncheck();
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("");
});

test("clic droit sur un fichier : indexer, retirer, ignorer un fichier non suivi", async ({ page }) => {
  const menu = page.getByRole("menu");
  await unstaged(page).getByText("render.ts").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(staged(page)).toContainText("render.ts");
  await staged(page).getByText("render.ts").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Retirer" }).click();
  await expect(unstaged(page)).toContainText("render.ts");

  // Non suivi : ce fichier, son extension (pas de dossier : il est à la racine).
  await unstaged(page).getByText("notes.txt").click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: /^Ignorer/ })).toHaveText(["Ignorer notes.txt", "Ignorer les fichiers *.txt"]);
  await menu.getByRole("menuitem", { name: "Ignorer les fichiers *.txt" }).click();
  expect(await page.evaluate(() => (window as unknown as { __mockIgnored: string[] }).__mockIgnored)).toEqual(["*.txt"]);
  // Fichier suivi : pas de choix « Ignorer ».
  await unstaged(page).getByText("render.ts").click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: /^Ignorer/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Copier le chemin", exact: true })).toBeVisible();
  // … mais « ne plus suivre et ignorer » : rm --cached, puis le fichier dans le .gitignore.
  await menu.getByRole("menuitem", { name: /^Ne plus suivre et ignorer/ }).click();
  expect(await page.evaluate(() => (window as unknown as { __mockUntracked: string[] }).__mockUntracked)).toEqual([expect.stringMatching(/render\.ts$/)]);
  expect(await page.evaluate(() => (window as unknown as { __mockIgnored: string[] }).__mockIgnored)).toEqual(["*.txt", expect.stringMatching(/^\/.*render\.ts$/)]);
});
