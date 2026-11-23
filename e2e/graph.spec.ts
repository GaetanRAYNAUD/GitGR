import { expect, test, type Page } from "@playwright/test";
import { openNextRepo, tab } from "./fixtures";

// Le backend simulé génère un historique de 1 200 commits (2 pages) avec des branches,
// des fusions et des tags ; voir src/lib/mockHistory.ts.

const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Détails du commit" });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
});

test("le graphe liste les commits avec leurs branches et le chargement se poursuit en bas", async ({ page }) => {
  const rows = graph(page).getByRole("option");
  await expect(rows.first()).toContainText("fix: correctif local pas encore poussé");
  await expect(rows.first()).toContainText("main");
  await expect(page.getByText("1000 commits chargés")).toBeVisible();

  // Fin de la liste : la page suivante arrive, l'historique est alors complet.
  await rows.first().click();
  await page.keyboard.press("End");
  // La page suivante arrive en approchant du bas ; Fin une fois l'historique complet.
  await expect(page.getByText("1200 commits", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("chore: initialisation du dépôt");
});

test("sélectionner un commit affiche ses détails, puis le diff d'un fichier", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  await expect(panel(page).getByRole("heading", { name: "feat(graph): rendu canvas virtualisé" })).toBeVisible();
  await expect(panel(page)).toContainText(/fichiers? modifiés?/);

  await panel(page).locator(".file-row").first().click();
  const diff = page.getByRole("region", { name: /^Diff de / });
  await expect(diff).toBeVisible();
  await expect(diff.locator("tr.add").first()).toBeVisible();
  await expect(diff.locator("tr.del").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);
  await expect(graph(page)).toBeVisible();
});

test("clic droit sur un fichier d'un commit : ouvrir, montrer dans le dossier, copier le chemin", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await graph(page).getByRole("option").nth(1).click();
  const file = panel(page).locator(".file-row").first();
  const name = (await file.getAttribute("title"))!.split(" → ").pop()!;
  const menu = page.getByRole("menu");

  await file.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Montrer dans le dossier" }).click();
  await file.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Ouvrir avec le programme par défaut" }).click();
  const opened = await page.evaluate(() => (window as unknown as { __mockOpened: { file: string; how: string }[] }).__mockOpened);
  expect(opened.map((o) => [o.file, o.how])).toEqual([
    [name, "reveal"],
    [name, "open"],
  ]);

  await file.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copier le chemin", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(name);
  await file.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copier le chemin complet" }).click();
  const full = await page.evaluate(() => navigator.clipboard.readText());
  // Dépôt simulé C:/Users/demo/Projects/GitGR : séparateur « / » gardé.
  expect(full.endsWith(`/${name}`) && full.length > name.length + 1).toBe(true);
});

test("navigation au clavier dans le graphe", async ({ page }) => {
  const rows = graph(page).getByRole("option");
  await rows.first().click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
});

test("un parent cliqué dans les détails devient la sélection", async ({ page }) => {
  await graph(page).getByRole("option").first().click();
  const parent = panel(page).locator(".parents button").first();
  const sha = await parent.innerText();
  await parent.click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText(sha);
});

test("barre latérale : clic sur une branche, sections repliables et masquables (mémorisé)", async ({ page }) => {
  // Les branches `feature/…` sont rangées dans un dossier « feature ».
  await expect(sidebar(page).getByRole("button", { name: /^feature/ }).first()).toHaveAttribute("aria-expanded", "true");
  await sidebar(page).getByRole("button", { name: "graph-rendering" }).first().click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("feat(graph): rendu canvas virtualisé");

  await sidebar(page).getByRole("button", { name: /Local/ }).click();
  await expect(sidebar(page).getByRole("button", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");

  await sidebar(page).getByRole("button", { name: "Sections affichées" }).click();
  await page.getByRole("checkbox", { name: "Tags" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(sidebar(page).getByRole("button", { name: /^Tags/ })).toHaveCount(0);

  // Après redémarrage, les choix sont conservés.
  await page.reload();
  await expect(sidebar(page).getByRole("button", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar(page).getByRole("button", { name: /1 section masquée/ })).toBeVisible();
});

test("chaque onglet garde sa sélection", async ({ page }) => {
  await graph(page).getByRole("option").nth(3).click();
  const subject = await graph(page).getByRole("option", { selected: true }).locator(".commit-msg").innerText();

  await page.getByRole("button", { name: "Accueil" }).click();
  await page.getByRole("button", { name: /Ouvrir un dépôt/ }).click();
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
  // api-backend a des modifications : la ligne « en cours » y est sélectionnée d'office.
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("Modifications en cours");

  await tab(page, "GitGR").click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText(subject);
});

test("Échap ferme le menu des sections sans fermer le diff ouvert", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  await panel(page).locator(".file-row").first().click();
  const diff = page.getByRole("region", { name: /^Diff de / });
  await expect(diff).toBeVisible();

  await sidebar(page).getByRole("button", { name: "Sections affichées" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sections affichées" })).toHaveCount(0);
  await expect(diff).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);
});

test("fichiers d'un commit en arborescence, choix conservé au redémarrage", async ({ page }) => {
  await graph(page).getByRole("option").first().click();
  await panel(page).getByRole("button", { name: "Arborescence" }).click();
  const files = panel(page).getByRole("list", { name: /fichiers? modifiés?/ });
  await expect(files.locator(".file-dir-row").first()).toBeVisible();

  await page.reload();
  await graph(page).getByRole("option").first().click();
  await expect(panel(page).getByRole("button", { name: "Arborescence" })).toHaveAttribute("aria-pressed", "true");
  await expect(files.locator(".file-dir-row").first()).toBeVisible();
});

test("branche courante et modifications en attente mises en avant", async ({ page }) => {
  // GitGR (propre) : la branche dans la barre, la ligne du commit courant marquée, pas de pastille.
  await expect(page.locator(".branch-chip-label")).toHaveText("main");
  await expect(graph(page).locator(".commit-row.head")).toHaveCount(1);
  await expect(page.locator(".changes-pill")).toHaveCount(0);

  await page.getByRole("button", { name: "Accueil" }).click();
  await page.getByRole("button", { name: /Ouvrir un dépôt/ }).click();
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
  const pill = page.locator(".changes-pill");
  await expect(pill).toHaveText("4 modifications en attente");
  // Autre commit choisi, puis la pastille ramène aux modifications en cours.
  await graph(page).getByRole("option").nth(3).click();
  await pill.click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("Modifications en cours");
  await expect(pill).toHaveClass(/\bon\b/);
});
