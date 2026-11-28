import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Worktrees simulés (src/lib/mockBranches.ts).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const locals = (page: Page) => sidebar(page).locator(".side-group").first();
const menu = (page: Page) => page.getByRole("menu").first();

test("worktree : créé depuis une branche, listé dans sa section, puis supprimé", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  // Rien que le dossier ouvert : pas de section.
  await expect(sidebar(page).getByRole("treeitem", { name: /^Worktrees/ })).toHaveCount(0);

  await locals(page).getByRole("treeitem", { name: /^profils/ }).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer un worktree", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sur feature/profils…" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouveau worktree" });
  await expect(dialog).toContainText("Sur la branche feature/profils");
  await expect(dialog.getByLabel("Dossier")).toHaveValue(/-feature-profils$/);
  await dialog.getByLabel("Ouvrir dans un onglet").uncheck();
  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText(/Worktree créé dans .*-feature-profils\./)).toBeVisible();

  const section = sidebar(page).getByRole("treeitem", { name: /^Worktrees/ });
  await expect(section).toBeVisible();
  const item = sidebar(page).getByRole("treeitem", { name: /^feature\/profils/ }).last();
  await expect(item).toContainText("-feature-profils");
  // Dans le graphe : l'étiquette de la branche dit où elle est extraite.
  await locals(page).getByRole("treeitem", { name: /^profils/ }).click();
  const chip = page.locator(".chip", { hasText: /^feature\/profils$/ }).first();
  await expect(chip.locator(".chip-worktree")).toBeVisible();
  await expect(chip).toHaveAttribute("title", /extraite dans le worktree .*-feature-profils/);
  // La branche courante ne peut pas avoir de worktree : déjà extraite ici.
  await locals(page).getByRole("treeitem", { name: /^main/ }).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer un worktree", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Sur main…" })).toHaveAttribute("aria-disabled", "true");
  // Une nouvelle branche qui part de main, elle, est possible.
  await expect(page.getByRole("menuitem", { name: "Nouvelle branche depuis main…" })).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  // Verrouillé (avec une raison) : plus supprimable ; déverrouillé ensuite.
  await item.click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Verrouiller…" }).click();
  const lock = page.getByRole("dialog", { name: /^Verrouiller le worktree/ });
  await lock.getByLabel("Raison (facultative)").fill("disque USB");
  await lock.getByRole("button", { name: "Verrouiller" }).click();
  await expect(item).toContainText("verrouillé");
  await item.click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Supprimer le worktree…" })).toHaveAttribute("aria-disabled", "true");
  await expect(menu(page).getByRole("menuitem", { name: "Déverrouiller" })).toHaveAttribute("title", "Verrouillé : disque USB");
  await menu(page).getByRole("menuitem", { name: "Déverrouiller" }).click();
  await expect(item).not.toContainText("verrouillé");

  await item.click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Supprimer le worktree…" }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(confirm).toContainText("La branche et ses commits restent dans le dépôt.");
  await confirm.getByRole("button", { name: "Supprimer" }).click();
  await expect(section).toHaveCount(0);
});
