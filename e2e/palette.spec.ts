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
