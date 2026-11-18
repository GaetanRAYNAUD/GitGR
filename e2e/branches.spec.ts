import { expect, test, type Page } from "@playwright/test";
import { openNextRepo, openRepos, tab } from "./fixtures";

// Branches simulées (src/lib/mockHistory.ts) : main (1 commit à pousser, suit origin/main),
// feature/graph-rendering, feature/profils (sans distante), fix/ssh-agent (1 commit à tirer).
// Les opérations simulées sont dans src/lib/mockBranches.ts.

const tools = (page: Page) => page.locator(".tools");
const tool = (page: Page, name: string) => tools(page).getByRole("button", { name: new RegExp(`^${name}`) });
const current = (page: Page) => page.locator(".branch-chip-label");
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
/** Section « Local » de la barre latérale (les distantes ont souvent le même nom). */
const locals = (page: Page) => sidebar(page).locator(".side-group").first();
/** Bouton d'une branche locale (son nom affiché est suivi des compteurs ↑ ↓). */
const branch = (page: Page, label: string) => locals(page).getByRole("button", { name: new RegExp(`^${label}( |$)`) });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
const menu = (page: Page) => page.getByRole("menu");

test.describe("dépôt propre", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openNextRepo(page, "GitGR");
    await expect(current(page)).toHaveText("main");
  });

  test("double-clic sur une branche : checkout", async ({ page }) => {
    await branch(page, "profils").dblclick();
    await expect(current(page)).toHaveText("feature/profils");
    await expect(branch(page, "profils")).toHaveClass(/current/);
  });

  test("créer une branche depuis la barre d'outils, puis la supprimer", async ({ page }) => {
    await tool(page, "Branche").click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await expect(dialog).toContainText("Depuis main");
    const input = dialog.getByLabel("Nom de la branche");
    await input.fill("mauvais nom");
    await expect(dialog.getByRole("alert")).toContainText("Nom invalide");
    await expect(dialog.getByRole("button", { name: "Créer" })).toBeDisabled();
    await input.fill("essai/neuve");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(dialog).toBeHidden();
    await expect(current(page)).toHaveText("essai/neuve");

    // Retour sur main, puis suppression depuis le menu contextuel.
    await branch(page, "main").dblclick();
    await expect(current(page)).toHaveText("main");
    await branch(page, "neuve").click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Supprimer…" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Supprimer essai/neuve ?" });
    await confirm.getByRole("button", { name: "Supprimer" }).click();
    await expect(branch(page, "neuve")).toHaveCount(0);
  });

  test("la branche courante ne peut pas être supprimée depuis son menu", async ({ page }) => {
    await branch(page, "main").click({ button: "right" });
    await expect(menu(page).getByRole("menuitem", { name: "Supprimer…" })).toBeDisabled();
    await expect(menu(page).getByRole("menuitem", { name: "Push" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
  });

  test("push : le compteur de commits à pousser disparaît", async ({ page }) => {
    await expect(tool(page, "Push")).toContainText("1");
    await tool(page, "Push").click();
    await expect(page.getByRole("status").filter({ hasText: "main poussée." })).toBeVisible();
    await expect(tool(page, "Push").locator(".badge")).toHaveCount(0);
    await expect(page.locator(".statusbar")).toContainText("↑0 ↓0");
  });

  test("pull en avance rapide sur une branche en retard", async ({ page }) => {
    await branch(page, "ssh-agent").dblclick();
    await expect(current(page)).toHaveText("fix/ssh-agent");
    await expect(tool(page, "Pull")).toContainText("1");
    await tool(page, "Pull").click();
    await expect(tool(page, "Pull").locator(".badge")).toHaveCount(0);
  });

  test("double-clic sur une distante dont la locale existe : checkout puis pull", async ({ page }) => {
    // Section « origin » : la distante origin/fix/ssh-agent, en avance d'un commit sur la locale.
    const origin = sidebar(page).locator(".side-group").filter({ has: page.locator(".section-name", { hasText: /^origin$/ }) });
    await origin.getByRole("button", { name: /^ssh-agent/ }).dblclick();
    await expect(current(page)).toHaveText("fix/ssh-agent");
    await expect(tool(page, "Pull").locator(".badge")).toHaveCount(0);
    await expect(branch(page, "ssh-agent")).toHaveClass(/current/);
  });

  test("le mode du pull se choisit dans le menu du bouton", async ({ page }) => {
    await page.getByRole("button", { name: "Mode du pull" }).click();
    await menu(page).getByRole("menuitemradio", { name: "Rebase" }).click();
    await page.getByRole("button", { name: "Mode du pull" }).click();
    await expect(menu(page).getByRole("menuitemradio", { name: "Rebase" })).toHaveAttribute("aria-checked", "true");
  });

  test("clic droit sur un commit : nouvelle branche à cet endroit", async ({ page }) => {
    const row = graph(page).getByRole("option").nth(3);
    await row.click({ button: "right" });
    await expect(row).toHaveAttribute("aria-selected", "true");
    await menu(page).getByRole("menuitem", { name: "Nouvelle branche ici…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await expect(dialog).toContainText(/Depuis [0-9a-f]{7}/);
    await dialog.getByLabel("Nom de la branche").fill("ici");
    await dialog.getByLabel("Passer sur la nouvelle branche").uncheck();
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(row).toContainText("ici");
    await expect(current(page)).toHaveText("main");
  });
});

test.describe("dépôt avec des modifications", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openRepos(page, 2);
    await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
  });

  test("stash puis pop", async ({ page }) => {
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    await expect(panel).toBeVisible();
    await tool(page, "Stash").click();
    await expect(panel).toBeHidden();
    await expect(tool(page, "Pop")).toContainText("1");
    await tool(page, "Pop").click();
    await expect(panel).toContainText("render.ts");
    await expect(tool(page, "Pop")).toBeDisabled();
  });

  test("« pousser après le commit » est mémorisé et pousse", async ({ page }) => {
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    await panel.getByLabel("Pousser après le commit").check();
    await panel.getByLabel("Message de commit").fill("feat: avec push");
    await panel.getByRole("button", { name: /^Commiter/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "main poussée." })).toBeVisible();
    await expect(tool(page, "Push").locator(".badge")).toHaveCount(0);

    // Mémorisé pour ce dépôt.
    await page.reload();
    await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Pousser après le commit")).toBeChecked();
  });
});
