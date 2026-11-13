import { expect, test } from "@playwright/test";
import { homeButton, openRepos, tab } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 3);
});

test("le logo ramène à l'accueil sans fermer les onglets", async ({ page }) => {
  await homeButton(page).click();
  await expect(page.getByRole("heading", { name: "Dépôts" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(0);
});

test("fermer l'onglet actif active son voisin", async ({ page }) => {
  await tab(page, "api-backend").click();
  await page.getByRole("button", { name: "Fermer l’onglet api-backend" }).click();
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "dotfiles"]);
  await expect(tab(page, "dotfiles")).toHaveAttribute("aria-selected", "true");
});

test("raccourcis : Ctrl+Tab, Ctrl+Maj+Tab, Ctrl+1, Ctrl+W, Ctrl+T", async ({ page }) => {
  const selected = page.getByRole("tab", { selected: true });

  await page.keyboard.press("Control+1");
  await expect(selected).toHaveText("GitGR");

  await page.keyboard.press("Control+Tab");
  await expect(selected).toHaveText("api-backend");

  await page.keyboard.press("Control+Shift+Tab");
  await page.keyboard.press("Control+Shift+Tab");
  // Avant le premier onglet : l'accueil.
  await expect(page.getByRole("heading", { name: "Dépôts" })).toBeVisible();

  await page.keyboard.press("Control+3");
  await page.keyboard.press("Control+w");
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "api-backend"]);

  await page.keyboard.press("Control+t");
  await expect(page.getByRole("heading", { name: "Dépôts" })).toBeVisible();
});

test("les onglets et l'onglet actif sont restaurés au redémarrage", async ({ page }) => {
  await tab(page, "api-backend").click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "api-backend", "dotfiles"]);
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
});
