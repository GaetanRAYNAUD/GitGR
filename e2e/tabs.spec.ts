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

test("travail en attente signalé sur la pastille des onglets, détail en infobulle", async ({ page }) => {
  // Dépôts simulés : GitGR a un commit à pousser, api-backend des modifications en cours.
  const dot = (name: string) => tab(page, name).locator(".tab-dot");
  await expect(dot("api-backend")).toHaveClass(/pending/);
  await expect(dot("GitGR")).toHaveClass(/sync/);
  await expect(dot("GitGR")).not.toHaveClass(/pending/);
  await expect(page.locator(".tab", { has: tab(page, "api-backend") })).toHaveAttribute("title", /fichiers? pas encore commités?/);
  await expect(page.locator(".tab", { has: tab(page, "GitGR") })).toHaveAttribute("title", /↑1/);
});

test("Ctrl+E : sélecteur rapide, recherche floue puis Entrée revient à l'onglet du dépôt", async ({ page }) => {
  await tab(page, "dotfiles").click();
  await page.keyboard.press("Control+e");
  const picker = page.getByRole("dialog", { name: "Aller à un dépôt" });
  const options = picker.getByRole("option");
  // Requête vide : les autres dépôts, sans celui de l'onglet actif.
  await expect(options).toHaveCount(2);
  await picker.getByRole("combobox").fill("apbk");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("api-backend");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toHaveText("api-backend");

  await page.keyboard.press("Control+e");
  await picker.getByRole("combobox").fill("zzz");
  await expect(picker).toContainText("Aucun dépôt ne correspond.");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});

test("auto-stash propre à un dépôt, choisi au clic droit sur son onglet", async ({ page }) => {
  const choice = (name: string) => page.getByRole("menu").last().getByRole("menuitemradio", { name });
  const openSub = async () => {
    await tab(page, "api-backend").click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Auto-stash dans ce dépôt" }).click();
  };
  await openSub();
  await expect(choice("Comme les réglages (activé)")).toHaveAttribute("aria-checked", "true");
  await choice("Jamais").click();
  await openSub();
  await expect(choice("Jamais")).toHaveAttribute("aria-checked", "true");
  await expect(choice("Comme les réglages (activé)")).toHaveAttribute("aria-checked", "false");
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
