import { expect, test } from "@playwright/test";
import { openNextRepo, openRepos } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** Ouvre les réglages, sur une sous-page si elle est indiquée. */
async function openSettings(page: import("@playwright/test").Page, section?: string) {
  await page.getByRole("button", { name: /^(Réglages|Settings)$/ }).click();
  if (section) await page.getByRole("navigation", { name: "Sections des réglages" }).getByRole("button", { name: section }).click();
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
    const sections = dialog.locator(".st-nav-item");
    for (let s = 0; s < (await sections.count()); s++) {
      await sections.nth(s).click();
      const radios = dialog.locator(".segmented").getByRole("radio");
      for (let i = 0; i < (await radios.count()); i++) {
        const fits = await radios.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
        expect(fits, await radios.nth(i).textContent()).toBe(true);
      }
    }
    await sections.first().click();
    await dialog.getByRole("radio", { name: lang }).click();
    await page.keyboard.press("Escape");
  }
});

test("une sous-page par section : un clic ou les flèches de la barre latérale, retenue à la réouverture", async ({ page }) => {
  const settings = await openSettings(page);
  const nav = settings.getByRole("navigation");
  await expect(nav.getByRole("button", { name: "Apparence" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Apparence" })).toBeFocused();
  await nav.getByRole("button", { name: "Graphe" }).click();
  await expect(settings.getByRole("heading", { name: "Graphe" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Apparence" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Graphe" })).toHaveAttribute("aria-current", "page");

  // Flèches : section suivante, avec le focus.
  await page.keyboard.press("ArrowDown");
  await expect(settings.getByRole("heading", { name: "Raccourcis clavier" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Raccourcis clavier" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(settings.getByRole("heading", { name: "À propos" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "À propos" })).toBeFocused();

  // Pas de défilement dans le vide : la sous-page tient dans la fenêtre.
  const main = settings.locator(".st-main");
  expect(await main.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

  await page.keyboard.press("Escape");
  await openSettings(page);
  await expect(settings.getByRole("heading", { name: "À propos" })).toBeVisible();
});

test("les choix se parcourent aux flèches, un seul arrêt de tabulation par groupe", async ({ page }) => {
  const settings = await openSettings(page);
  const theme = settings.getByRole("radiogroup", { name: "Thème" });
  await expect(theme.getByRole("radio", { name: "Système" })).toHaveAttribute("tabindex", "0");
  await expect(theme.getByRole("radio", { name: "Clair" })).toHaveAttribute("tabindex", "-1");
  await theme.getByRole("radio", { name: "Système" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(theme.getByRole("radio", { name: "Clair" })).toBeFocused();
  await expect(theme.getByRole("radio", { name: "Clair" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("End");
  await expect(theme.getByRole("radio", { name: "Sombre" })).toHaveAttribute("aria-checked", "true");
});

test("l'explication de la stratégie de pull suit l'option choisie", async ({ page }) => {
  const settings = await openSettings(page, "Git");
  const pull = settings.getByRole("radiogroup", { name: "Stratégie de pull" });
  await expect(settings.getByText("Ne fait rien si les branches ont divergé", { exact: false })).toBeVisible();
  await pull.getByRole("radio", { name: "Rebase" }).click();
  await expect(settings.getByText("Rejoue vos commits locaux par-dessus la branche distante")).toBeVisible();
});

test("« Règles par défaut » demande confirmation avant de remplacer les règles", async ({ page }) => {
  const settings = await openSettings(page, "Graphe");
  await settings.getByRole("button", { name: "Ajouter une règle" }).click();
  await page.keyboard.type("feature/*");
  const patterns = settings.getByRole("textbox", { name: "Motif du nom de branche" });
  await expect(patterns).toHaveCount(6);

  await settings.getByRole("button", { name: "Règles par défaut" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Revenir aux règles par défaut ?")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(patterns).toHaveCount(6);

  await settings.getByRole("button", { name: "Règles par défaut" }).click();
  await page.getByRole("button", { name: "Remplacer mes règles" }).click();
  await expect(patterns).toHaveCount(5);
});

test("version de GitGR en bas de la page, avec les notes de version", async ({ page }) => {
  const pkg = new URL("../package.json", import.meta.url);
  const version = JSON.parse(await (await import("node:fs/promises")).readFile(pkg, "utf8")).version;
  const menu = await openSettings(page, "À propos");
  await expect(menu.getByText(`GitGR ${version}`)).toBeVisible();
  await expect(menu.getByRole("button", { name: "Notes de version" })).toBeVisible();
});

test.describe("mises à jour", () => {
  test("rechercher depuis les Réglages : à jour", async ({ page }) => {
    const settings = await openSettings(page, "À propos");
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
    let settings = await openSettings(page, "À propos");
    const box = settings.getByRole("checkbox", { name: "Installer les mises à jour automatiquement, à la fermeture de GitGR" });
    await expect(box).toBeChecked();
    await box.uncheck();

    await withUpdate(page);
    await page.reload();
    const notice = page.getByRole("status").filter({ hasText: "GitGR 9.9.0 est disponible." });
    await expect(notice).toBeVisible();
    settings = await openSettings(page, "À propos");
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
    const settings = await openSettings(page, "À propos");
    await expect(settings.getByText(/GitGR 9\.9\.0 est disponible : mettez-le à jour avec votre gestionnaire de paquets/)).toBeVisible();
    await expect(settings.getByRole("button", { name: "Installer et redémarrer" })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Nouveautés" })).toBeVisible();
  });
});

test("éditeur des fichiers : commande enregistrée, « Ouvrir dans l'éditeur » au clic droit d'un fichier", async ({ page }) => {
  const settings = await openSettings(page, "Git");
  const field = settings.getByLabel("Éditeur des fichiers");
  await field.fill("code -r");
  await field.press("Enter");
  await page.getByRole("button", { name: /^Réglages$/ }).click();
  await expect(settings).toHaveCount(0);

  await openNextRepo(page, "GitGR");
  await page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option").nth(1).click();
  const file = page.getByRole("complementary", { name: "Détails du commit" }).locator(".file-row").first();
  await file.click({ button: "right" });
  const item = page.getByRole("menu").getByRole("menuitem", { name: "Ouvrir dans l’éditeur" });
  await expect(item).toHaveAttribute("title", "code -r");
  await item.click();
  const opened = await page.evaluate(() => (window as unknown as { __mockOpened: { how: string }[] }).__mockOpened);
  expect(opened.map((o) => o.how)).toEqual(["editor:code -r"]);
});

test("éditeur des fichiers : blame de la copie de travail, « à la ligne N » avec {line}", async ({ page }) => {
  const settings = await openSettings(page, "Git");
  const field = settings.getByLabel("Éditeur des fichiers");
  await field.fill("subl {file}:{line}");
  await field.press("Enter");
  await page.getByRole("button", { name: /^Réglages$/ }).click();

  await openRepos(page, 2);
  const unstaged = page.getByRole("complementary", { name: "Modifications en cours" }).getByRole("listbox", { name: "Non indexés", exact: true });
  await unstaged.getByText("render.ts").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Blame", exact: true }).click();
  const view = page.getByRole("region", { name: "Blame" });
  const row = view.locator("tr.start").nth(1);
  await row.click({ button: "right" });
  const item = page.getByRole("menu").getByRole("menuitem", { name: /^Ouvrir dans l’éditeur à la ligne \d+$/ });
  const label = (await item.textContent())!;
  await item.click();
  const opened = await page.evaluate(() => (window as unknown as { __mockOpened: { how: string; line: number }[] }).__mockOpened);
  expect(opened.map((o) => [o.how, String(o.line)])).toEqual([["editor:subl {file}:{line}", label.match(/\d+$/)![0]]]);
});

test("éditeur des fichiers : diff des modifications en cours, « à la ligne N » au clic droit d'un numéro et au clavier", async ({ page }) => {
  const settings = await openSettings(page, "Git");
  const field = settings.getByLabel("Éditeur des fichiers");
  await field.fill("subl {file}:{line}");
  await field.press("Enter");
  await page.getByRole("button", { name: /^Réglages$/ }).click();

  await openRepos(page, 2);
  const unstaged = page.getByRole("complementary", { name: "Modifications en cours" }).getByRole("listbox", { name: "Non indexés", exact: true });
  await unstaged.getByText("render.ts").click();
  const diff = page.getByRole("region", { name: "Diff de src/graph/render.ts" });
  const row = diff.locator("tr.add").first();
  const line = (await row.locator("td.ln2").innerText()).trim();
  await row.locator("td.ln2").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: `Ouvrir dans l’éditeur à la ligne ${line}` }).click();
  const opened = () => page.evaluate(() => (window as unknown as { __mockOpened: { how: string; line: number }[] }).__mockOpened.map((o) => String(o.line)));
  expect(await opened()).toEqual([line]);

  // Au clavier : Maj+F10 sur la ligne active ouvre le même menu.
  await diff.getByRole("grid").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu").getByRole("menuitem", { name: /^Ouvrir dans l’éditeur à la ligne \d+$/ })).toBeVisible();
});
