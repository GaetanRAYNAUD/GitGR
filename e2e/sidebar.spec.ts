import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Barre latérale des refs au clavier : un arbre à une seule tabulation, flèches, recherche à la
// frappe, Maj+Entrée pour le checkout ; filtre (Échap, aucun résultat) ; MR sans compte.

const nav = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const tree = (page: Page) => nav(page).getByRole("tree", { name: "Branches, tags et stashes" });
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
});

test("Ctrl+Maj+E : le focus sur la branche courante ; flèches, ← vers le parent, recherche à la frappe", async ({ page }) => {
  await expect(tree(page).locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("Control+Shift+E");
  const main = tree(page).getByRole("treeitem", { name: "main", exact: true }).first();
  await expect(main).toBeFocused();
  await expect(main).toHaveAttribute("aria-current", "true");
  await expect(main).toHaveAttribute("aria-description", "branche courante, 1 commit à pousser");

  // ↑ : ssh-agent (dans fix/), ← : le dossier fix, ← encore : il se replie.
  await page.keyboard.press("ArrowUp");
  expect(await focusedName(page)).toBe("ssh-agent");
  await page.keyboard.press("ArrowLeft");
  const fix = tree(page).getByRole("treeitem", { name: /^fix/ }).first();
  await expect(fix).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(fix).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(fix).toHaveAttribute("aria-expanded", "true");

  // Recherche à la frappe : « pr » va sur « profils ».
  await page.keyboard.type("pr");
  expect(await focusedName(page)).toBe("profils");
  // Le dernier élément focalisé garde l'arrêt de tabulation.
  await expect(tree(page).locator('[tabindex="0"]')).toHaveAttribute("aria-label", "profils");
});

test("Entrée montre le commit, Maj+Entrée fait le checkout", async ({ page }) => {
  await page.keyboard.press("Control+Shift+E");
  await page.keyboard.type("pr");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { selected: true })).toBeVisible();
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".branch-chip-label")).toHaveText("feature/profils");
});

test("filtre : rien ne correspond, Échap le vide puis passe dans l'arbre", async ({ page }) => {
  const filter = nav(page).getByRole("textbox", { name: "Filtrer" });
  await filter.fill("zzzz");
  await expect(nav(page).getByRole("status")).toHaveText(/Aucune branche, aucun tag ni stash ne contient « zzzz »/);
  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await filter.press("Escape");
  await expect(tree(page).getByRole("treeitem", { name: "main", exact: true }).first()).toBeFocused();
});

test("merge requests sans compte : une ligne d'invitation, sans compteur ni filtres", async ({ page }) => {
  const head = tree(page).getByRole("treeitem", { name: /^Merge requests/ });
  await expect(head).toBeVisible();
  await expect(head).not.toContainText("0");
  await expect(nav(page).getByRole("group", { name: "Filtrer" })).toHaveCount(0);
  await expect(nav(page)).toContainText("Connectez un compte GitLab pour les voir ici.");
});
