import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Bisect simulé (src/lib/mockBranches.ts) : la plage est calculée sur l'historique simulé.

const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
const banner = (page: Page) => page.locator(".bisect-banner");

test("bisect : un mauvais, un bon, des verdicts jusqu'au premier mauvais commit, puis Terminer", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  await expect(page.locator(".branch-chip-label")).toHaveText("main");

  await graph(page).getByRole("option").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bisect : marquer comme mauvais" }).click();
  await expect(banner(page)).toContainText("marquez un commit bon");
  await expect(graph(page).locator(".bisect-mark.bad")).toHaveText("mauvais");

  await graph(page).getByRole("option").nth(12).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Bisect : marquer comme bon" }).click();
  await expect(banner(page)).toContainText(/testez [0-9a-f]{7} \(extrait\)/);
  await expect(page.locator(".branch-chip-label")).toHaveText("HEAD détachée");
  await expect(graph(page).locator(".bisect-mark.current")).toHaveCount(1);
  await expect(graph(page).locator(".commit-row.dim").first()).toBeVisible();

  // Toujours « Bon » : le mauvais connu finit par être le premier.
  for (let i = 0; i < 8 && !(await banner(page).textContent())?.includes("terminé"); i++) {
    await banner(page).getByRole("button", { name: "Bon" }).click();
    await expect(banner(page).getByRole("button", { name: /^(Arrêter|Terminer)$/ })).toBeEnabled();
  }
  await expect(banner(page)).toContainText("est le premier mauvais commit");
  await expect(graph(page).locator(".bisect-mark.firstBad")).toHaveText("premier mauvais");

  await banner(page).getByRole("button", { name: "Terminer" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator(".branch-chip-label")).toHaveText("main");
  await expect(graph(page).locator(".bisect-mark")).toHaveCount(0);
});
