import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Couleur fixe pour un nom de branche depuis le clic droit (étiquette du graphe, barre
// latérale), sans passer par les Réglages. Branches simulées : src/lib/mockHistory.ts.

const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
/** Étiquette d'une branche dans le graphe (`remote` : la distante). */
const chip = (page: Page, label: string, remote = false) =>
  graph(page)
    .locator(remote ? ".chip.remote" : ".chip:not(.remote):not(.tag)")
    .filter({ has: page.locator(".chip-label", { hasText: new RegExp(`^${label}$`) }) })
    .first();
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const menu = (page: Page) => page.getByRole("menu").first();
const popover = (page: Page) => page.getByRole("dialog", { name: /^Couleur fixe pour/ });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
});

test("choisir puis retirer la couleur fixe d'une branche depuis le graphe", async ({ page }) => {
  await chip(page, "feature/graph-rendering").click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Retirer la couleur fixe" })).toHaveCount(0);
  await menu(page).getByRole("menuitem", { name: "Couleur fixe pour ce nom…" }).click();

  await expect(popover(page)).toHaveAccessibleName("Couleur fixe pour « feature/graph-rendering »");
  await popover(page).getByRole("radio", { name: "Violet" }).click();
  await expect(chip(page, "feature/graph-rendering")).toHaveAttribute("style", /--chip: var\(--g3\)/);
  // Clavier : les flèches passent à la couleur suivante, Échap ferme.
  await page.keyboard.press("ArrowRight");
  await expect(chip(page, "feature/graph-rendering")).toHaveAttribute("style", /--chip: var\(--g4\)/);
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);

  // La règle est en tête dans Réglages > Graphe.
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("navigation", { name: "Sections des réglages" }).getByRole("button", { name: "Graphe" }).click();
  await expect(page.getByRole("textbox", { name: "Motif du nom de branche" }).first()).toHaveValue("feature/graph-rendering");
  await page.keyboard.press("Escape");

  await chip(page, "feature/graph-rendering").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Retirer la couleur fixe" }).click();
  await expect(chip(page, "feature/graph-rendering")).not.toHaveAttribute("style", /--chip: var\(--g4\)/);
  await chip(page, "feature/graph-rendering").click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Retirer la couleur fixe" })).toHaveCount(0);
});

test("une branche distante prend la règle de son nom sans le remote", async ({ page }) => {
  await chip(page, "origin/main", true).click({ button: "right" });
  // « main » a déjà une règle exacte (règles par défaut).
  await expect(menu(page).getByRole("menuitem", { name: "Retirer la couleur fixe" })).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Couleur fixe pour ce nom…" }).click();
  await expect(popover(page)).toHaveAccessibleName("Couleur fixe pour « main »");
  await expect(popover(page).getByRole("radio", { name: "Bleu" })).toBeChecked();
  await popover(page).getByRole("radio", { name: "Vert" }).click();
  await expect(chip(page, "main")).toHaveAttribute("style", /--chip: var\(--g5\)/);
});

test("l'entrée est aussi au clic droit d'une branche de la barre latérale", async ({ page }) => {
  await sidebar(page).getByRole("treeitem", { name: /^profils( |$)/ }).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Couleur fixe pour ce nom…" }).click();
  await expect(popover(page)).toHaveAccessibleName("Couleur fixe pour « feature/profils »");
  // Pas de règle à ce nom : « Aucune règle » a le focus ; les flèches choisissent, Entrée ferme.
  await expect(popover(page).getByRole("radio", { name: "Aucune règle pour ce nom" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(popover(page).getByRole("radio", { name: "Bleu" })).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(popover(page)).toHaveCount(0);
});

test("entrée grisée, avec la raison, quand les couleurs fixes sont désactivées", async ({ page }) => {
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("navigation", { name: "Sections des réglages" }).getByRole("button", { name: "Graphe" }).click();
  await page.getByRole("checkbox", { name: "Couleurs fixes par nom de branche" }).uncheck();
  await page.getByRole("button", { name: "Réglages" }).click();

  await chip(page, "main").click({ button: "right" });
  const item = menu(page).getByRole("menuitem", { name: "Couleur fixe pour ce nom…" });
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute("title", /désactivées/);
  await expect(menu(page).getByRole("menuitem", { name: "Retirer la couleur fixe" })).toBeDisabled();
});
