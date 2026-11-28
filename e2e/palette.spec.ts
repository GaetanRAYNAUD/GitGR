import { expect, test } from "@playwright/test";
import { openNextRepo } from "./fixtures";

test("palette de commandes : Ctrl+P, recherche floue, raccourci affiché, checkout d'une branche", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  await expect(page.locator(".branch-chip-label")).toHaveText("main");

  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Palette de commandes" });
  const input = palette.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("push");
  const first = palette.getByRole("option").first();
  await expect(first).toContainText("Push");
  await expect(first).toContainText("CtrlMajK");

  // Une branche locale : son checkout.
  await input.fill("checkout profils");
  await expect(palette.getByRole("option").first()).toContainText("Checkout : feature/profils");
  await input.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.locator(".branch-chip-label")).toHaveText("feature/profils");

  // Grisée : dit pourquoi, la palette reste ouverte.
  await page.keyboard.press("Control+p");
  await input.fill("pop");
  await expect(palette.getByRole("option").first()).toHaveAttribute("aria-disabled", "true");
  await input.press("Enter");
  await expect(page.getByText("Aucun stash à réappliquer.")).toBeVisible();
  // Ctrl+P referme.
  await page.keyboard.press("Control+p");
  await expect(palette).toHaveCount(0);
});

test("palette : actions du commit sélectionné, dernières commandes en tête", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  await page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option").nth(1).click();

  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Palette de commandes" });
  const input = palette.getByRole("combobox");
  await input.fill("revert");
  const revert = palette.getByRole("option").first();
  await expect(revert).toContainText("Revert");
  await expect(revert).toContainText(/Commit [0-9a-f]{7}/);

  // Lancer « Réglages » : elle revient en tête à la prochaine ouverture, sans recherche.
  await input.fill("réglages");
  await input.press("Enter");
  await expect(palette).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  await expect(palette.getByRole("option").first()).toContainText("Réglages");
});

test("palette : actions du fichier ouvert (blame depuis son diff)", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  await page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option").nth(1).click();
  await page.getByRole("complementary", { name: "Détails du commit" }).locator(".file-row").first().click();
  const diff = page.getByRole("region", { name: /^Diff de / });
  const name = (await diff.getAttribute("aria-label"))!.replace(/^Diff de /, "");

  await page.keyboard.press("Control+p");
  const palette = page.getByRole("dialog", { name: "Palette de commandes" });
  const input = palette.getByRole("combobox");
  await input.fill("blame");
  const blame = palette.getByRole("option").first();
  await expect(blame).toContainText(`Fichier ${name}`);
  await input.press("Enter");
  await expect(page.getByRole("region", { name: "Blame" })).toContainText(`Blame de ${name}`);

  // Depuis le blame : l'historique du même fichier.
  await page.keyboard.press("Control+p");
  await input.fill("historique du fichier");
  await expect(palette.getByRole("option").first()).toContainText(`Fichier ${name}`);
  await input.press("Enter");
  await expect(page.getByRole("region", { name: /^Historique/ })).toBeVisible();
});
