import { expect, test } from "@playwright/test";
import { homeButton, openNextRepo, openRepos, tab } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("accueil vide au premier lancement", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Dépôts" })).toBeVisible();
  await expect(page.getByText(/Aucun dépôt pour l’instant/)).toBeVisible();
  await expect(page.getByText(/Git .* détecté/)).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("ouvrir un dépôt l'affiche dans un onglet avec son graphe", async ({ page }) => {
  await openNextRepo(page, "GitGR");
  await expect(page.getByRole("listbox", { name: "Historique des commits" })).toBeVisible();
  await expect(page.getByText("C:/Users/demo/Projects/GitGR").first()).toBeVisible();
  // Barre d'outils active, avec le nombre de commits à pousser.
  await expect(page.getByRole("button", { name: /^Push/ })).toBeEnabled();
  await expect(page.locator(".tool-badged", { has: page.getByRole("button", { name: /^Push/ }) })).toContainText("1");
});

test("un dossier qui n'est pas un dépôt affiche une erreur", async ({ page }) => {
  await openRepos(page, 3);
  await homeButton(page).click();
  await page.getByRole("button", { name: /Ouvrir un dépôt/ }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Ce dossier n’est pas un dépôt Git.");
  await expect(page.getByRole("tab")).toHaveCount(3);

  await alert.getByRole("button", { name: "Fermer" }).click();
  await expect(alert).toHaveCount(0);
});

test("les dépôts ouverts apparaissent dans les récents, filtrables", async ({ page }) => {
  await openRepos(page, 3);
  await homeButton(page).click();

  const list = page.locator(".repo-list");
  await expect(list.locator(".repo-name")).toHaveText(["dotfiles", "api-backend", "GitGR"]);

  await page.getByRole("textbox", { name: "Rechercher un dépôt" }).fill("api");
  await expect(list.locator(".repo-name")).toHaveText(["api-backend"]);
});

test("état des dépôts récents à l'accueil : branche, commits à pousser, fichiers pas encore commités", async ({ page }) => {
  await openRepos(page, 2);
  await homeButton(page).click();
  const row = (name: string) => page.locator(".repo-row", { hasText: name });
  await expect(row("GitGR").locator(".repo-branch")).toHaveText("main");
  await expect(row("GitGR").locator(".repo-sync")).toHaveText("↑1");
  await expect(row("api-backend").locator(".repo-pending")).toContainText(/fichiers? pas encore commités?/);
});

test("retirer un dépôt des récents ferme aussi son onglet", async ({ page }) => {
  await openRepos(page, 2);
  await homeButton(page).click();

  await page.locator(".repo-row", { hasText: "GitGR" }).hover();
  await page.getByRole("button", { name: "Retirer GitGR de la liste" }).click();

  await expect(page.locator(".repo-name")).toHaveText(["api-backend"]);
  await expect(tab(page, "GitGR")).toHaveCount(0);
});

test("cliquer sur un récent rouvre son onglet", async ({ page }) => {
  await openRepos(page, 2);
  await homeButton(page).click();
  await page.locator(".repo-open", { hasText: "GitGR" }).click();
  await expect(tab(page, "GitGR")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("barre du bas : le dossier s'ouvre dans l'explorateur, origin dans le navigateur", async ({ page }) => {
  await openNextRepo(page, "GitGR");
  const bar = page.locator(".statusbar");
  await bar.getByRole("button", { name: /GitGR/ }).first().click();
  const opened = await page.evaluate(() => (window as unknown as { __mockOpened: { path: string; file: string; how: string }[] }).__mockOpened);
  expect(opened).toEqual([{ path: expect.stringContaining("GitGR"), file: "", how: "open" }]);

  await page.context().route("https://gitlab.exemple.fr/**", (r) => r.fulfill({ body: "ok" }));
  const popup = page.waitForEvent("popup");
  await bar.getByRole("button", { name: /origin · gitlab\.exemple\.fr/ }).click();
  expect((await popup).url()).toBe("https://gitlab.exemple.fr/demo/GitGR");
});
