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

/** Glisse l'onglet `name` au centre du titre de l'onglet `target`, décalé de `past` px
 *  (il faut dépasser le milieu de l'onglet entier, bouton ✕ compris). */
async function dragTab(page: import("@playwright/test").Page, name: string, target: string, past: number) {
  const from = (await tab(page, name).boundingBox())!;
  const to = (await tab(page, target).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2 + past, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("glisser-déposer un onglet par son titre change l'ordre", async ({ page }) => {
  await dragTab(page, "GitGR", "dotfiles", 40);
  await expect(page.getByRole("tab")).toHaveText(["api-backend", "dotfiles", "GitGR"]);

  await dragTab(page, "GitGR", "api-backend", -40);
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "api-backend", "dotfiles"]);

  // L'ordre survit au redémarrage.
  await dragTab(page, "dotfiles", "GitGR", -40);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText(["dotfiles", "GitGR", "api-backend"]);
});

test("un simple clic sur un onglet ne le déplace pas", async ({ page }) => {
  await tab(page, "GitGR").click();
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "api-backend", "dotfiles"]);
  await expect(tab(page, "GitGR")).toHaveAttribute("aria-selected", "true");
});

test("Ctrl+Maj+PageUp / PageDown déplacent l'onglet actif", async ({ page }) => {
  // dotfiles est actif (dernier ouvert).
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "dotfiles", "api-backend"]);
  await page.keyboard.press("Control+Shift+PageUp");
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(page.getByRole("tab")).toHaveText(["dotfiles", "GitGR", "api-backend"]);
  await page.keyboard.press("Control+Shift+PageDown");
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "dotfiles", "api-backend"]);
});

test("les onglets et l'onglet actif sont restaurés au redémarrage", async ({ page }) => {
  await tab(page, "api-backend").click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText(["GitGR", "api-backend", "dotfiles"]);
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
});
