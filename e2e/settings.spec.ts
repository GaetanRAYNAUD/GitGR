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

test("version de GitGR en bas de la page, avec les notes de version", async ({ page }) => {
  const pkg = new URL("../package.json", import.meta.url);
  const version = JSON.parse(await (await import("node:fs/promises")).readFile(pkg, "utf8")).version;
  const menu = await openSettings(page);
  await expect(menu.getByText(`GitGR ${version}`)).toBeVisible();
  await expect(menu.getByRole("button", { name: "Notes de version" })).toBeVisible();
});

test.describe("mises à jour", () => {
  test("rechercher depuis les Réglages : à jour", async ({ page }) => {
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Rechercher les mises à jour" }).click();
    await expect(settings.getByText("GitGR est à jour.")).toBeVisible();
  });

  type UpdateWindow = { __mockUpdate: unknown; __mockInstalled?: boolean; __mockRelaunched?: boolean; __mockCloseRequested?: () => Promise<void> };
  const withUpdate = (page: import("@playwright/test").Page) =>
    page.addInitScript(() => {
      (window as unknown as UpdateWindow).__mockUpdate = { version: "9.9.0", notes: null, date: null };
    });

  test("nouvelle version téléchargée au démarrage, installée à la fermeture sans relance", async ({ page }) => {
    await withUpdate(page);
    await page.reload();
    const notice = page.getByRole("status").filter({ hasText: "GitGR 9.9.0 est prête : elle s'installera à la fermeture de GitGR." });
    await expect(notice).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as UpdateWindow).__mockInstalled)).toBeUndefined();

    // Fermeture de la fenêtre : installation, sans relance.
    await page.evaluate(() => (window as unknown as UpdateWindow).__mockCloseRequested!());
    expect(await page.evaluate(() => (window as unknown as UpdateWindow).__mockInstalled)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as UpdateWindow).__mockRelaunched)).toBeUndefined();
  });

  test("« Redémarrer maintenant » installe tout de suite", async ({ page }) => {
    await withUpdate(page);
    await page.reload();
    const notice = page.getByRole("status").filter({ hasText: "GitGR 9.9.0 est prête" });
    await notice.getByRole("button", { name: "Redémarrer maintenant" }).click();
    await expect(page.getByText("Mise à jour installée, redémarrage de GitGR…")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as UpdateWindow).__mockRelaunched)).toBe(true);
  });

  test("installation automatique décochée : la version est annoncée, installée à la demande", async ({ page }) => {
    let settings = await openSettings(page);
    const box = settings.getByRole("checkbox", { name: "Installer les mises à jour automatiquement, à la fermeture de GitGR" });
    await expect(box).toBeChecked();
    await box.uncheck();

    await withUpdate(page);
    await page.reload();
    const notice = page.getByRole("status").filter({ hasText: "GitGR 9.9.0 est disponible." });
    await expect(notice).toBeVisible();
    settings = await openSettings(page);
    await expect(settings.getByRole("checkbox", { name: /Installer les mises à jour automatiquement/ })).not.toBeChecked();
    await page.evaluate(() => (window as unknown as UpdateWindow).__mockCloseRequested!());
    expect(await page.evaluate(() => (window as unknown as UpdateWindow).__mockInstalled)).toBeUndefined();
    await settings.getByRole("button", { name: "Installer et redémarrer" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as UpdateWindow).__mockRelaunched)).toBe(true);
  });

  test("paquet deb : les Réglages renvoient vers le gestionnaire de paquets", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __mockUpdate: unknown; __mockInstallKind: string };
      w.__mockInstallKind = "deb";
      w.__mockUpdate = { version: "9.9.0", notes: null, date: null };
    });
    await page.reload();
    const settings = await openSettings(page);
    await expect(settings.getByText(/GitGR 9\.9\.0 est disponible : mettez-le à jour avec votre gestionnaire de paquets/)).toBeVisible();
    await expect(settings.getByRole("button", { name: "Installer et redémarrer" })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Nouveautés" })).toBeVisible();
  });
});
