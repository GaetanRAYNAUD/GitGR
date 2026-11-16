import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /^(Réglages|Settings)$/ }).click();
  return page.getByRole("region", { name: /^(Réglages|Settings)$/ });
}

test("le thème suit le système par défaut", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("forcer le thème clair, conservé après redémarrage", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const menu = await openSettings(page);
  await menu.getByRole("radio", { name: "Clair" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("passer en anglais, conservé après redémarrage", async ({ page }) => {
  const menu = await openSettings(page);
  await expect(menu.getByRole("radio", { name: "Système" }).last()).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("radio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
});

test("la page se ferme avec Échap ou le bouton Réglages", async ({ page }) => {
  let settings = await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  settings = await openSettings(page);
  await expect(settings).toBeVisible();
  await page.getByRole("button", { name: "Réglages" }).click();
  await expect(settings).toHaveCount(0);
});

test("aucun libellé des choix ne déborde, en français comme en anglais", async ({ page }) => {
  for (const lang of ["English", "Français"]) {
    const dialog = await openSettings(page);
    const radios = dialog.locator(".segmented").getByRole("radio");
    for (let i = 0; i < (await radios.count()); i++) {
      const fits = await radios.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
      expect(fits, await radios.nth(i).textContent()).toBe(true);
    }
    await dialog.getByRole("radio", { name: lang }).click();
    await page.keyboard.press("Escape");
  }
});
