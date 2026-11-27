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

test("historique d'un fichier : ses commits, diff au double-clic, retour à l'historique puis au graphe", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  const file = panel(page).locator(".file-row").first();
  const name = (await file.getAttribute("title"))!.split(" → ").pop()!;
  await file.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Historique du fichier" }).click();

  const view = page.getByRole("region", { name: "Historique du fichier" });
  await expect(view).toContainText(`Historique de ${name}`);
  const rows = view.getByRole("listbox", { name: /commits?/ }).getByRole("option");
  const row = rows.filter({ hasText: "feat(graph): rendu canvas virtualisé" });
  await expect(row).toHaveCount(1);
  await row.dblclick();
  const diff = page.getByRole("region", { name: /^Diff de / });
  await expect(diff).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);
  await expect(view).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(graph(page)).toBeVisible();
});

test("blame d'un fichier à un commit : blocs par commit, détails au clic, puis l'historique du fichier", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  const file = panel(page).locator(".file-row").first();
  const name = (await file.getAttribute("title"))!.split(" → ").pop()!;
  await file.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Blame", exact: true }).click();

  const view = page.getByRole("region", { name: "Blame" });
  await expect(view).toContainText(`Blame de ${name}`);
  const starts = view.locator("tr.start .blame-commit");
  await expect(starts.first()).toContainText("feat(graph): rendu canvas virtualisé");
  await starts.nth(1).click();
  await expect(view.locator("tr.on").first()).toBeVisible();
  const picked = (await starts.nth(1).locator(".blame-summary").textContent())!;
  await expect(panel(page).getByRole("heading", { name: picked })).toBeVisible();

  // Historique ouvert depuis le blame : Échap revient au blame, puis au graphe.
  await view.getByRole("button", { name: "Historique du fichier" }).click();
  await expect(page.getByRole("region", { name: "Historique du fichier" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graph(page)).toBeVisible();
});

test("blame et historique au clavier : focus à l'ouverture, flèches, Entrée, Maj+F10, focus rendu au fichier", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  const file = panel(page).locator(".file-row").first();
  await file.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Blame", exact: true }).click();
  const view = page.getByRole("region", { name: "Blame" });
  const grid = view.getByRole("grid");
  await expect(grid).toBeFocused();
  // F7 : début du bloc suivant ; Entrée : ses détails à droite.
  await page.keyboard.press("F7");
  const second = (await view.locator("tr.start").nth(1).getAttribute("id"))!;
  await expect(grid).toHaveAttribute("aria-activedescendant", second);
  await page.keyboard.press("Enter");
  const picked = (await view.locator("tr.start").nth(1).locator(".blame-summary").textContent())!;
  await expect(panel(page).getByRole("heading", { name: picked })).toBeVisible();
  // Maj+F10 : les actions du commit.
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Blame avant ce commit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view).toBeVisible();

  // Historique : la liste a le focus, ↓ choisit le commit suivant (le diff à droite suit),
  // Entrée passe dans le diff.
  await view.getByRole("button", { name: "Historique du fichier" }).click();
  const history = page.getByRole("region", { name: "Historique du fichier" });
  const list = history.getByRole("listbox");
  await expect(list).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
  const sha = (await list.getByRole("option", { selected: true }).locator(".file-history-sha").textContent())!;
  await expect(history.locator(".file-history-diff .diff-head")).toContainText(sha);
  await page.keyboard.press("Enter");
  await expect(history.locator(".file-history-diff").getByRole("grid")).toBeFocused();
  // Espace marque le commit, ↓ en choisit un autre : le diff compare les deux versions.
  await list.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await expect(history.locator(".file-history-compare")).toContainText("..");
  await history.getByRole("button", { name: "Arrêter la comparaison" }).click();
  await expect(history.locator(".file-history-compare")).toHaveCount(0);
  // Voir dans le graphe : ses commits mis en avant, les autres estompés.
  await history.getByRole("button", { name: "Voir dans le graphe" }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole("search")).toContainText("src/");
  await expect(graph(page).locator(".dim").first()).toBeVisible();
});

test("historique d'un fichier : double-clic ouvre le diff en plein écran, Échap revient", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  await panel(page).locator(".file-row").first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Historique du fichier" }).click();
  const history = page.getByRole("region", { name: "Historique du fichier" });
  await history.getByRole("option").nth(1).dblclick();
  await expect(page.getByRole("region", { name: /^Diff de / })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toBeVisible();
});

test("Ctrl+F : commits trouvés mis en avant, Entrée pour passer de l'un à l'autre, Échap ferme", async ({ page }) => {
  await graph(page).getByRole("option").first().click();
  await page.keyboard.press("Control+f");
  const bar = page.getByRole("search", { name: "Chercher dans le graphe" });
  const input = bar.getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill("perf: rendu virtualisé");
  await expect(bar.getByRole("status")).toContainText(/commits? trouvés? · parmi les 1000 commits chargés/);
  await expect(graph(page).locator(".commit-row.found").first()).toBeVisible();
  await expect(graph(page).locator(".commit-row.dim").first()).toBeVisible();

  await input.press("Enter");
  const selected = graph(page).getByRole("option", { selected: true });
  await expect(selected).toContainText("perf: rendu virtualisé");
  await expect(bar.getByRole("status")).toContainText(/^1 \/ \d+/);
  await input.press("Shift+Enter");
  await expect(selected).toContainText("perf: rendu virtualisé");

  await input.fill("introuvable-xyz");
  await expect(bar.getByRole("status")).toContainText("Aucun commit trouvé");
  await input.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(graph(page).locator(".commit-row.dim")).toHaveCount(0);
  await expect(graph(page)).toBeFocused();
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
  await expect(sidebar(page).getByRole("treeitem", { name: /^feature/ }).first()).toHaveAttribute("aria-expanded", "true");
  await sidebar(page).getByRole("treeitem", { name: "graph-rendering" }).first().click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("feat(graph): rendu canvas virtualisé");

  await sidebar(page).getByRole("treeitem", { name: /Local/ }).click();
  await expect(sidebar(page).getByRole("treeitem", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");

  await sidebar(page).getByRole("button", { name: "Sections affichées" }).click();
  await page.getByRole("checkbox", { name: "Tags" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(sidebar(page).getByRole("treeitem", { name: /^Tags/ })).toHaveCount(0);

  // Après redémarrage, les choix sont conservés.
  await page.reload();
  await expect(sidebar(page).getByRole("treeitem", { name: /Local/ })).toHaveAttribute("aria-expanded", "false");
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
  const files = panel(page).getByRole("tree", { name: /fichiers? modifiés?/ });
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
  await expect(pill.locator(".pill-label")).toHaveText("4 modifications en attente");
  // Autre commit choisi, puis la pastille ramène aux modifications en cours.
  await graph(page).getByRole("option").nth(3).click();
  await pill.click();
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("Modifications en cours");
  await expect(pill).toHaveClass(/\bon\b/);
});

test("badge ↑ du bouton Push : commits qui partent et leurs fichiers, avant de pousser", async ({ page }) => {
  await page.getByRole("button", { name: "Voir le commit qui part au push" }).click();
  const view = page.getByRole("region", { name: "Ce qui part au push" });
  await expect(view.locator(".pull-view-title")).toHaveText("1 commit à pousser vers origin/main");
  await expect(view.locator(".range-commit")).toHaveCount(1);
  await expect(view.locator(".range-commit")).toContainText("fix: correctif local pas encore poussé");
  await view.locator(".file-row").first().click();
  await expect(view.locator(".diff-body tr.add").first()).toBeVisible();
  // Échap revient au graphe.
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(graph(page)).toBeVisible();
});

test.describe("sélection de plusieurs commits", () => {
  const picked = (page: Page) => page.getByRole("complementary", { name: "Commits sélectionnés" });

  test("Maj+clic : plage, fichiers cumulés et diff de la plage ; un clic simple revient à un commit", async ({ page }) => {
    const rows = graph(page).getByRole("option");
    await rows.nth(4).click();
    await rows.nth(6).click({ modifiers: ["Shift"] });
    await expect(graph(page).getByRole("option", { selected: true })).toHaveCount(3);
    await expect(picked(page)).toContainText("3 commits sélectionnés");
    await expect(picked(page).getByRole("listbox", { name: "Commits choisis" }).getByRole("option")).toHaveCount(3);
    // Maj+↓ étend la plage d'un commit.
    await page.keyboard.press("Shift+ArrowDown");
    await expect(picked(page)).toContainText("4 commits sélectionnés");

    await rows.nth(1).click();
    await expect(picked(page)).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });

  test("Ctrl+clic sur des commits épars : liste seulement, puis cherry-pick du lot sur la branche courante", async ({ page }) => {
    const rows = graph(page).getByRole("option");
    // Trois commits espacés, aucun de fusion (refusés au cherry-pick).
    const all = await rows.locator(".commit-msg").allInnerTexts();
    const idx = [2, 9, 15].map((i) => all.findIndex((m, k) => k >= i && !m.startsWith("Merge")));
    const subjects = idx.map((i) => all[i]);
    await rows.nth(idx[0]).click();
    await rows.nth(idx[1]).click({ modifiers: ["Control"] });
    await rows.nth(idx[2]).click({ modifiers: ["Control"] });
    await expect(picked(page)).toContainText("Sélectionnez une plage contiguë");
    await picked(page).getByRole("button", { name: "Cherry-pick (3)" }).click();
    await expect(page.getByText("Cherry-pick de 3 commits sur main terminé.")).toBeVisible();
    // Les trois nouveaux commits en haut, le plus récent d'abord (appliqués du plus ancien au plus récent).
    await expect(rows.nth(0)).toContainText(subjects[0]);
    await expect(rows.nth(2)).toContainText(subjects[2]);
  });
});

test("reset de main sur un commit plus ancien, puis le reflog retrouve l'ancienne position", async ({ page }) => {
  const rows = graph(page).getByRole("option");
  const lost = await rows.first().locator(".commit-msg").innerText();
  await rows.nth(1).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Reset de main ici…" }).click();
  const dialog = page.getByRole("alertdialog", { name: /^Reset de main sur/ });
  await dialog.getByRole("button", { name: "Soft" }).click();
  await expect(page.getByText(/main est maintenant sur/)).toBeVisible();

  await page.getByRole("button", { name: "Reflog" }).click();
  const view = page.getByRole("region", { name: "Reflog" });
  const entries = view.getByRole("listbox", { name: "Où était HEAD" }).getByRole("option");
  await expect(entries.first()).toContainText("reset");
  // L'ancienne position de HEAD : clic, ses détails à droite.
  await entries.nth(1).click();
  await expect(panel(page)).toContainText(lost);
  // Clic droit : ses actions (nouvelle branche…).
  await entries.nth(1).click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Nouvelle branche ici…" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Au clavier : la liste a le focus, Maj+F10 ouvre aussi les actions de la position.
  await view.getByRole("listbox").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Nouvelle branche ici…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});

test("chercher dans les modifications : résultats, détails au clic, erreur d'expression, retour au graphe", async ({ page }) => {
  await page.getByRole("button", { name: "Chercher", exact: true }).click();
  const view = page.getByRole("region", { name: "Recherche dans les modifications" });
  await view.getByLabel("Texte cherché").fill("perf: rendu virtualisé");
  await view.getByRole("button", { name: "Chercher" }).click();
  const results = view.getByRole("listbox", { name: /commits?/ }).getByRole("option");
  await expect(results.first()).toContainText("perf: rendu virtualisé des lignes");
  // Après la recherche, la liste a le focus.
  await expect(view.getByRole("listbox")).toBeFocused();
  await results.first().click();
  await expect(panel(page)).toContainText("perf: rendu virtualisé des lignes");

  await view.getByLabel("Regex").check();
  await view.getByLabel("Texte cherché").fill("perf(");
  await view.getByRole("button", { name: "Chercher" }).click();
  await expect(view.getByRole("alert")).toContainText("Expression régulière invalide.");
  // Les résultats précédents restent affichés sous l'erreur.
  await expect(results.first()).toBeVisible();
  await view.getByLabel("Texte cherché").focus();

  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(graph(page)).toBeVisible();
});

test("résultats de la recherche dans les modifications mis en évidence dans le graphe, F3 pour les parcourir", async ({ page }) => {
  await page.getByRole("button", { name: "Chercher", exact: true }).click();
  const view = page.getByRole("region", { name: "Recherche dans les modifications" });
  await view.getByLabel("Texte cherché").fill("perf: rendu virtualisé");
  await view.getByRole("button", { name: "Chercher" }).click();
  await expect(view.getByRole("listbox", { name: /commits?/ }).getByRole("option").first()).toBeVisible();
  await view.getByRole("button", { name: "Voir dans le graphe" }).click();

  await expect(view).toHaveCount(0);
  const bar = page.getByRole("search", { name: "Chercher dans le graphe" });
  await expect(bar).toContainText("Changements de « perf: rendu virtualisé »");
  await expect(graph(page).locator(".commit-row.found").first()).toBeVisible();
  await graph(page).focus();
  await page.keyboard.press("F3");
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("perf: rendu virtualisé");
  await expect(bar.getByRole("status")).toContainText(/^1 \/ \d+/);
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(graph(page).locator(".commit-row.dim")).toHaveCount(0);
});

test("clic droit sur un commit : revert, un nouveau commit l'annule en haut de main", async ({ page }) => {
  const rows = graph(page).getByRole("option");
  const all = await rows.locator(".commit-msg").allInnerTexts();
  const i = all.findIndex((m, k) => k >= 3 && !m.startsWith("Merge"));
  await rows.nth(i).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Revert de ce commit" }).click();
  await expect(page.getByText("Revert sur main terminé.")).toBeVisible();
  await expect(rows.first()).toContainText(`Revert "${all[i]}"`);
});

test("squash des deux derniers commits de main : un seul commit, avec le message choisi", async ({ page }) => {
  const rows = graph(page).getByRole("option");
  // HEAD et son parent (lu dans les détails).
  await rows.nth(0).click();
  const parent = (await panel(page).locator(".parents .link").first().innerText()).trim();
  await graph(page).getByRole("option").filter({ has: page.locator(".commit-sha", { hasText: parent }) }).click({ modifiers: ["Control"] });
  await page.getByRole("complementary", { name: "Commits sélectionnés" }).getByRole("button", { name: "Squash (2)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Squash de 2 commits" });
  await dialog.getByRole("textbox").fill("deux en un");
  await dialog.getByRole("button", { name: "Réunir" }).click();
  // Le second est déjà sur origin/main : confirmation demandée.
  await page.getByRole("alertdialog", { name: "Commits déjà poussés" }).getByRole("button", { name: "Réunir quand même" }).click();
  await expect(page.getByText("2 commits réunis en un seul.")).toBeVisible();
  await expect(rows.first()).toContainText("deux en un");
});

test("tout au clavier : focus au graphe, menu d'un commit (Maj+F10), détails (Entrée), retour (Ctrl+G)", async ({ page }) => {
  // À l'ouverture du dépôt, le focus est déjà sur le graphe.
  await expect(graph(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Copier le SHA" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(graph(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(panel(page).locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Control+g");
  await expect(graph(page)).toBeFocused();
});

test("ligne « en cours » : clic droit pour tout indexer, stasher ou tout annuler", async ({ page }) => {
  await openNextRepo(page, "api-backend");
  const wip = graph(page).getByRole("option", { name: /^Modifications en cours/ });
  await wip.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Tout indexer", "Stasher les modifications", "Tout abandonner…"]);
  await menu.getByRole("menuitem", { name: "Tout abandonner…" }).click();
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toContainText("Abandonner toutes les modifications ?");
});

test("annoter un diff : marge de blame (Ctrl+Alt+B), clic = détails, B au clavier, clic droit sur les numéros", async ({ page }) => {
  await graph(page).getByRole("option").nth(1).click();
  await panel(page).locator(".file-row").first().dblclick();
  const diff = page.getByRole("region", { name: /^Diff de / });
  await expect(diff.locator(".ann")).toHaveCount(0);
  await page.keyboard.press("Control+Alt+b");
  await expect(diff.getByRole("button", { name: "Annoter (blame)" })).toHaveAttribute("aria-pressed", "true");
  const starts = diff.locator(".ann.start");
  await expect(starts.first()).toContainText("·");
  // Clic sur la marge : le commit de la ligne dans le panneau des détails.
  const summary = (await starts.first().getAttribute("title"))!.split("\n")[0];
  await starts.first().click();
  await expect(panel(page).getByRole("heading", { name: summary })).toBeVisible();
  // Au clavier : B sur la ligne active donne aussi ses détails, Maj+B ses actions.
  const grid = diff.getByRole("grid");
  await grid.focus();
  await page.keyboard.press("Shift+b");
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Blame avant ce commit" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Clic droit sur un numéro : masquer les annotations.
  await diff.locator("td.ln").first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Masquer les annotations" }).click();
  await expect(diff.locator(".ann")).toHaveCount(0);
});
