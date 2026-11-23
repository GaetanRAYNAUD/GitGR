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

test("stash partiel : un seul fichier mis de côté, les autres restent", async ({ page }) => {
  await unstaged(page).getByText("notes.txt").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Mettre de côté (stash)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté notes.txt" });
  await dialog.getByRole("textbox").fill("juste les notes");
  await dialog.getByRole("button", { name: "Mettre de côté" }).click();
  await expect(unstaged(page)).not.toContainText("notes.txt");
  await expect(unstaged(page)).toContainText("render.ts");
  const stashes = page.getByRole("navigation", { name: "Branches et tags" }).getByRole("list", { name: "Stashes" });
  await expect(stashes).toContainText("juste les notes");
});

test("stash partiel de plusieurs fichiers : cochés dans la fenêtre, puis une ligne dans le graphe", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Mettre de côté des fichiers (stash)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté des fichiers" });
  const submit = dialog.getByRole("button", { name: "Mettre de côté" });
  // Rien de coché au départ : rien à mettre de côté.
  await expect(submit).toBeDisabled();
  await expect(dialog.locator("li", { hasText: "lanes.ts" })).toContainText("indexé");
  await expect(dialog.locator("li", { hasText: "notes.txt" })).toContainText("non suivi");
  await dialog.getByRole("checkbox", { name: /notes\.txt/ }).check();
  await dialog.getByRole("checkbox", { name: /render\.ts/ }).check();
  await dialog.getByRole("textbox").fill("deux fichiers");
  await submit.click();
  await expect(unstaged(page)).not.toContainText("notes.txt");
  await expect(unstaged(page)).not.toContainText("render.ts");
  await expect(staged(page)).toContainText("lanes.ts");

  // Ligne discrète du stash, juste au-dessus du commit d'où il part (HEAD) ; clic : son contenu.
  const row = graph(page).getByRole("option", { name: /deux fichiers/ });
  await expect(row).toHaveClass(/stash/);
  await expect(graph(page).getByRole("option").nth(2)).toHaveClass(/head/);
  await row.click();
  const view = page.getByRole("region", { name: /^Stash/ });
  await expect(view.locator(".file-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await row.click({ button: "right" });
  await expect(page.getByRole("menu")).toContainText("Appliquer et retirer (pop)");
});

test("sélection multiple : Ctrl+clic puis clic droit, les actions portent sur toute la sélection", async ({ page }) => {
  await unstaged(page).locator(".file-row", { hasText: "render.ts" }).click();
  await unstaged(page).locator(".file-row", { hasText: "notes.txt" }).click({ modifiers: ["Control"] });
  await expect(unstaged(page).locator(".file-row.picked")).toHaveCount(2);
  await unstaged(page).locator(".file-row", { hasText: "notes.txt" }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Annuler les modifications de 2 fichiers…" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Indexer 2 fichiers" }).click();
  await expect(staged(page)).toContainText("render.ts");
  await expect(staged(page)).toContainText("notes.txt");
  await expect(unstaged(page)).toContainText("log.rs");
});

test("Maj+clic prend la plage, puis stash de la sélection avec les fichiers déjà cochés", async ({ page }) => {
  const rows = unstaged(page).locator(".file-row");
  await rows.first().click();
  await rows.last().click({ modifiers: ["Shift"] });
  await expect(unstaged(page).locator(".file-row.picked")).toHaveCount(await rows.count());
  await rows.first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Mettre de côté des fichiers (stash)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté des fichiers" });
  await expect(dialog.getByRole("checkbox", { name: /notes\.txt/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /render\.ts/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /lanes\.ts/ })).not.toBeChecked();
});

test("arborescence : clic droit sur un dossier, actions sur ses fichiers", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Arborescence" }).click();
  const dir = unstaged(page).locator(".file-dir-row", { hasText: "graph" });
  await dir.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Ouvrir le dossier" })).toBeVisible();
  // Fichiers suivis : pas d'« ignorer le dossier ».
  await expect(menu.getByRole("menuitem", { name: /Ignorer/ })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Indexer le fichier" }).click();
  await expect(staged(page)).toContainText("render.ts");
  await expect(unstaged(page)).not.toContainText("render.ts");
});
