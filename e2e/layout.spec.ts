import { expect, test, type Page } from "@playwright/test";
import { homeButton, openRepos, tab } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** Glisse le centre d'un élément de (dx, dy) à la souris. */
async function drag(page: Page, name: string, dx: number, dy: number) {
  const box = (await page.getByRole("separator", { name, exact: true }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}

const width = (page: Page, selector: string) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);

test("le logo est l'onglet Accueil, actif sur l'accueil", async ({ page }) => {
  await expect(homeButton(page)).toHaveAttribute("aria-current", "page");
  await openRepos(page, 1);
  await expect(homeButton(page)).not.toHaveAttribute("aria-current", "page");
  await homeButton(page).click();
  await expect(homeButton(page)).toHaveAttribute("aria-current", "page");
});

test("largeur des panneaux réglée à la souris, conservée après redémarrage", async ({ page }) => {
  await openRepos(page, 1);
  const sidebar = await width(page, ".refs-sidebar");
  await drag(page, "Largeur de la barre latérale", 60, 0);
  expect(await width(page, ".refs-sidebar")).toBeCloseTo(sidebar + 60, -1);

  const panel = await width(page, ".commit-panel");
  await drag(page, "Largeur du panneau de droite", -50, 0);
  expect(await width(page, ".commit-panel")).toBeCloseTo(panel + 50, -1);

  await page.reload();
  await expect(tab(page, "GitGR")).toHaveAttribute("aria-selected", "true");
  expect(await width(page, ".refs-sidebar")).toBeCloseTo(sidebar + 60, -1);

  // Double-clic : retour à la taille par défaut.
  await page.getByRole("separator", { name: "Largeur de la barre latérale", exact: true }).dblclick();
  expect(await width(page, ".refs-sidebar")).toBeCloseTo(sidebar, -1);
});

test("hauteur d'une section de la barre latérale", async ({ page }) => {
  await openRepos(page, 1);
  const name = "Hauteur de la section « Local »";
  const block = page.getByRole("separator", { name, exact: true }).locator("xpath=preceding-sibling::*[1]");
  const before = (await block.boundingBox())!.height;
  await drag(page, name, 0, -30);
  expect((await block.boundingBox())!.height).toBeCloseTo(before - 30, -1);
  await expect(block).toHaveClass(/sized/);
});
