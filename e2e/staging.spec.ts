import { expect, test, type Page } from "@playwright/test";
import { openRepos, tab } from "./fixtures";

// « api-backend » (2e dépôt simulé) a des modifications en cours : 3 fichiers non indexés
// (dont un non suivi) et 2 indexés ; voir src/lib/mockWorktree.ts.

const panel = (page: Page) => page.getByRole("complementary", { name: "Modifications en cours" });
const unstaged = (page: Page) => panel(page).getByRole("listbox", { name: "Non indexés", exact: true });
const staged = (page: Page) => panel(page).getByRole("listbox", { name: "Indexés", exact: true });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 2);
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
});

test("diff indexable au clavier : grille, Espace, Entrée, Échap en deux temps", async ({ page }) => {
  const list = unstaged(page);
  await list.getByText("render.ts").click();
  const diff = page.getByRole("region", { name: "Diff de src/graph/render.ts" });
  const grid = diff.getByRole("grid", { name: "Lignes du diff" });
  // Les boutons des blocs ne sont pas des arrêts de tabulation.
  await expect(diff.getByRole("button", { name: "Indexer le bloc" })).toHaveAttribute("tabindex", "-1");
  await grid.focus();
  // Première ligne modifiée, puis la suivante ; Espace les choisit.
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText("2 lignes sélectionnées")).toBeVisible();
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(2);
  // Échap : la sélection d'abord, la vue ensuite ; le focus revient au fichier.
  await page.keyboard.press("Escape");
  await expect(page.getByText("2 lignes sélectionnées")).toHaveCount(0);
  await expect(diff).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(diff).toHaveCount(0);
  await expect(list.getByRole("option", { name: /render\.ts/ })).toBeFocused();
  // Entrée sur une ligne : son bloc entier est indexé.
  await page.keyboard.press("Enter");
  await grid.focus();
  await page.keyboard.press("Enter");
  await expect(staged(page)).toContainText("render.ts");
});

test("ignorer les espaces : bascule mémorisée, découpage indisponible", async ({ page }) => {
  await unstaged(page).getByText("render.ts").click();
  const diff = page.getByRole("region", { name: "Diff de src/graph/render.ts" });
  await diff.getByRole("button", { name: "Ignorer les espaces" }).click();
  await expect(diff.getByRole("button", { name: "Ignorer les espaces" })).toHaveAttribute("aria-pressed", "true");
  await expect(diff).toContainText("Espaces ignorés");
  await expect(diff.getByRole("button", { name: "Indexer le bloc" })).toHaveCount(0);
  await diff.getByRole("button", { name: "Afficher les espaces" }).click();
  await expect(diff.getByRole("button", { name: "Indexer le bloc" })).toBeVisible();
});

test("la ligne « en cours » est sélectionnée d'office et liste les fichiers", async ({ page }) => {
  await expect(graph(page).getByRole("option", { selected: true })).toContainText("Modifications en cours — 4 fichiers");
  await expect(panel(page)).toContainText("sur main · 4 fichiers");
  await expect(unstaged(page)).toContainText("render.ts");
  await expect(unstaged(page)).toContainText("notes.txt");
  await expect(staged(page)).toContainText("lanes.ts");
});

test("indexer des lignes choisies depuis le diff, puis commiter", async ({ page }) => {
  await unstaged(page).getByText("render.ts").click();
  const diff = page.getByRole("region", { name: "Diff de src/graph/render.ts" });
  await expect(diff).toContainText("Non indexé");

  // Sélection d'une plage (clic puis Maj+clic) puis indexation.
  await diff.locator("tr", { hasText: "rows.length * 34" }).click();
  await diff.locator("tr", { hasText: "const width" }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 lignes sélectionnées")).toBeVisible();
  await page.getByRole("button", { name: "Indexer 3 lignes" }).click();

  // Tout le fichier est indexé : le diff passe côté « Indexé ».
  await expect(diff).toContainText("Indexé");
  await expect(staged(page)).toContainText("render.ts");
  await expect(unstaged(page)).not.toContainText("render.ts");

  await page.getByPlaceholder("Résumé").fill("feat: rendu du canvas");
  await page.getByPlaceholder("Description (optionnelle)").fill("Largeur calculée à partir des lanes.");
  await page.getByRole("button", { name: "Commiter 3 fichiers" }).click();

  await expect(staged(page)).toHaveCount(0);
  await expect(panel(page)).toContainText("Rien d’indexé pour l’instant.");
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("");
  await expect(graph(page).getByRole("option").nth(1)).toContainText("feat: rendu du canvas");
});

test("indexer / retirer des fichiers et tout indexer", async ({ page }) => {
  const row = unstaged(page).locator("li", { hasText: "notes.txt" });
  await row.hover();
  await row.getByRole("button", { name: "Indexer notes.txt" }).click();
  await expect(staged(page)).toContainText("notes.txt");

  await panel(page).getByRole("button", { name: "Tout retirer" }).click();
  await expect(panel(page)).toContainText("Rien d’indexé pour l’instant.");
  await panel(page).getByRole("button", { name: "Tout indexer" }).click();
  await expect(panel(page)).toContainText("Rien à indexer.");
});

test("tout annuler (avec confirmation) nettoie la copie de travail", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Tout abandonner" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Abandonner toutes les modifications ?" });
  await expect(dialog).toContainText("irréversible");
  await dialog.getByRole("button", { name: "Tout abandonner" }).click();

  // Plus rien en cours : la ligne disparaît et le commit courant est sélectionné.
  await expect(graph(page).getByRole("option").first()).not.toContainText("Modifications en cours");
  await expect(page.getByRole("complementary", { name: "Détails du commit" })).toBeVisible();
});

test("amend : reprend le message du dernier commit", async ({ page }) => {
  await panel(page).getByRole("checkbox", { name: "Amend" }).check();
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("fix: correctif local pas encore poussé");
  await expect(panel(page).getByRole("button", { name: "Modifier le dernier commit" })).toBeEnabled();
  await panel(page).getByRole("checkbox", { name: "Amend" }).uncheck();
  await expect(page.getByPlaceholder("Résumé")).toHaveValue("");
});

test("clic droit sur un fichier : indexer, retirer, ignorer un fichier non suivi", async ({ page }) => {
  const menu = page.getByRole("menu");
  await unstaged(page).getByText("render.ts").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Indexer" }).click();
  await expect(staged(page)).toContainText("render.ts");
  await staged(page).getByText("render.ts").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Retirer" }).click();
  await expect(unstaged(page)).toContainText("render.ts");

  // Non suivi : ce fichier, son extension (pas de dossier : il est à la racine).
  await unstaged(page).getByText("notes.txt").click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: /^Ignorer/ })).toHaveText(["Ignorer notes.txt", "Ignorer les fichiers *.txt"]);
  await menu.getByRole("menuitem", { name: "Ignorer les fichiers *.txt" }).click();
  expect(await page.evaluate(() => (window as unknown as { __mockIgnored: string[] }).__mockIgnored)).toEqual(["*.txt"]);
  // Fichier suivi : pas de choix « Ignorer ».
  await unstaged(page).getByText("render.ts").click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: /^Ignorer/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Copier le chemin", exact: true })).toBeVisible();
  // … mais « ne plus suivre et ignorer » : rm --cached, puis le fichier dans le .gitignore.
  await menu.getByRole("menuitem", { name: /^Ne plus suivre et ignorer/ }).click();
  expect(await page.evaluate(() => (window as unknown as { __mockUntracked: string[] }).__mockUntracked)).toEqual([expect.stringMatching(/render\.ts$/)]);
  expect(await page.evaluate(() => (window as unknown as { __mockIgnored: string[] }).__mockIgnored)).toEqual(["*.txt", expect.stringMatching(/^\/.*render\.ts$/)]);
});

test("stash partiel : un seul fichier mis de côté, les autres restent", async ({ page }) => {
  await unstaged(page).getByText("notes.txt").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Mettre de côté (stash)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté notes.txt" });
  await dialog.getByRole("textbox").fill("juste les notes");
  await dialog.getByRole("button", { name: "Mettre de côté" }).click();
  await expect(unstaged(page)).not.toContainText("notes.txt");
  await expect(unstaged(page)).toContainText("render.ts");
  const stashes = page.getByRole("navigation", { name: "Branches et tags" }).getByRole("group", { name: "Stashes" });
  await expect(stashes).toContainText("juste les notes");
});

test("stash partiel de plusieurs fichiers : cochés dans la fenêtre, puis une ligne dans le graphe", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Stash…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté des fichiers" });
  const submit = dialog.getByRole("button", { name: "Mettre de côté" });
  // Rien de coché au départ : rien à mettre de côté.
  await expect(submit).toBeDisabled();
  await expect(dialog.locator("li", { hasText: "lanes.ts" })).toContainText("indexé");
  await expect(dialog.locator("li", { hasText: "notes.txt" })).toContainText("non suivi");
  await dialog.getByRole("checkbox", { name: /notes\.txt/ }).check();
  await dialog.getByRole("checkbox", { name: /render\.ts/ }).check();
  await dialog.getByRole("textbox").fill("deux fichiers");
  await submit.click();
  await expect(unstaged(page)).not.toContainText("notes.txt");
  await expect(unstaged(page)).not.toContainText("render.ts");
  await expect(staged(page)).toContainText("lanes.ts");

  // Ligne discrète du stash, juste au-dessus du commit d'où il part (HEAD) ; clic : son contenu.
  const row = graph(page).getByRole("option", { name: /deux fichiers/ });
  await expect(row).toHaveClass(/stash/);
  await expect(graph(page).getByRole("option").nth(2)).toHaveClass(/head/);
  await row.click();
  const view = page.getByRole("region", { name: /^Stash/ });
  await expect(view.locator(".file-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await row.click({ button: "right" });
  await expect(page.getByRole("menu")).toContainText("Appliquer et retirer (pop)");
});

test("sélection multiple : Ctrl+clic puis clic droit, les actions portent sur toute la sélection", async ({ page }) => {
  await unstaged(page).locator(".file-row", { hasText: "render.ts" }).click();
  await unstaged(page).locator(".file-row", { hasText: "notes.txt" }).click({ modifiers: ["Control"] });
  await expect(unstaged(page).locator(".file-row.picked")).toHaveCount(2);
  await unstaged(page).locator(".file-row", { hasText: "notes.txt" }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Abandonner les modifications de 2 fichiers…" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Indexer 2 fichiers" }).click();
  await expect(staged(page)).toContainText("render.ts");
  await expect(staged(page)).toContainText("notes.txt");
  await expect(unstaged(page)).toContainText("log.rs");
});

test("Maj+clic prend la plage, puis stash de la sélection avec les fichiers déjà cochés", async ({ page }) => {
  const rows = unstaged(page).locator(".file-row");
  await rows.first().click();
  await rows.last().click({ modifiers: ["Shift"] });
  await expect(unstaged(page).locator(".file-row.picked")).toHaveCount(await rows.count());
  await rows.first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Mettre de côté des fichiers (stash)…" }).click();
  const dialog = page.getByRole("dialog", { name: "Mettre de côté des fichiers" });
  await expect(dialog.getByRole("checkbox", { name: /notes\.txt/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /render\.ts/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /lanes\.ts/ })).not.toBeChecked();
});

test("arborescence : clic droit sur un dossier, actions sur ses fichiers", async ({ page }) => {
  await panel(page).getByRole("button", { name: "Arborescence" }).click();
  const dir = panel(page).getByRole("tree", { name: "Non indexés", exact: true }).locator(".file-dir-row", { hasText: "graph" });
  await dir.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Ouvrir le dossier" })).toBeVisible();
  // Fichiers suivis : pas d'« ignorer le dossier ».
  await expect(menu.getByRole("menuitem", { name: /Ignorer/ })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Indexer le fichier" }).click();
  await expect(panel(page).getByRole("tree", { name: "Indexés", exact: true })).toContainText("render.ts");
  await expect(panel(page).getByRole("tree", { name: "Non indexés", exact: true })).not.toContainText("render.ts");
});

type MockConflict = (p: string, f: string, t: string, v?: { base: string | null; ours: string; theirs: string }) => void;
const REPO = "C:/Users/demo/work/api-backend";
const lines = (...l: string[]) => l.map((x) => `${x}\n`).join("");
const VERSIONS = {
  base: lines("// en-tête", "import a;", "let a = 1, b = 2;", "function f() {", "deux", "}", "fin"),
  ours: lines("// en-tête", "import a;", "import o;", "let a = 10, b = 2;", "function f() {", "deux ici", "}", "fin"),
  theirs: lines("// en-tête", "import a;", "let a = 1, b = 20;", "function f() {", "deux là-bas", "}", "fin", "// ajout"),
};
const WORKING = lines("// en-tête", "import a;", "<<<<<<< HEAD", "import o;", "let a = 10, b = 2;", "=======", "let a = 1, b = 20;", ">>>>>>> sujet", "function f() {", "<<<<<<< HEAD", "deux ici", "=======", "deux là-bas", ">>>>>>> sujet", "}", "fin", "// ajout");

async function addConflict(page: Page, file: string) {
  await page.evaluate(
    ([repo, f, t, v]) => (window as unknown as { __mockConflict: MockConflict }).__mockConflict(repo, f, t, v),
    [REPO, file, WORKING, VERSIONS] as const,
  );
}

test("résoudre un conflit en 3 panneaux : baguette, » puis «, lignes une à une, Alt+↑, enregistré", async ({ page }) => {
  await addConflict(page, "conflit.txt");
  await page.keyboard.press("F5");
  const panel = page.getByRole("complementary", { name: "Modifications en cours" });
  // Un clic sur le fichier ouvre directement la résolution.
  await panel.getByRole("listbox", { name: "Conflits" }).getByRole("option").filter({ hasText: "conflit.txt" }).click();

  const view = page.getByRole("region", { name: "Résolution du conflit de conflit.txt" });
  const status = view.locator(".conflict-status");
  await expect(status).toHaveText("2 conflits à résoudre");
  // Numérotés par genre ; « — réglé » s'ajoute au nom une fois la modification réglée.
  const c1 = view.getByRole("group", { name: /^Conflit 1 \/ 2/ });
  const c2 = view.getByRole("group", { name: /^Conflit 2 \/ 2/ });
  const theirsOnly = view.getByRole("group", { name: /^Modification de l’autre côté 1 \/ 1/ });
  // Sans conflit : appliquée d'office. Conflit : la version commune, à résoudre.
  await expect(theirsOnly.getByRole("textbox")).toHaveValue("// ajout");
  await expect(c2.getByRole("textbox")).toHaveValue("deux");
  // Mots changés surlignés par rapport à la version commune.
  await expect(c1.locator(".mcell-ours mark")).toHaveText(["10"]);
  await expect(c1.locator(".mcell-theirs mark")).toHaveText(["20"]);

  // Baguette : les deux côtés ont changé des mots différents.
  await c1.getByRole("button", { name: /Résoudre ce conflit automatiquement/ }).click();
  await expect(c1.getByRole("textbox")).toHaveValue("import o;\nlet a = 10, b = 20;");
  await expect(status).toHaveText("1 conflit à résoudre");
  await expect(c2.getByRole("button", { name: /Résoudre ce conflit automatiquement/ })).toHaveCount(0);

  // » puis « : le second côté s'ajoute après le premier.
  await c2.getByRole("button", { name: "Mettre HEAD dans le résultat" }).click();
  await expect(c2.getByRole("textbox")).toHaveValue("deux ici");
  await expect(status).toHaveText("Tout est résolu");
  await c2.getByRole("button", { name: "Ajouter sujet à la suite dans le résultat" }).click();
  const edit = c2.getByRole("textbox", { name: "Résultat de la modification 2" });
  await expect(edit).toHaveValue("deux ici\ndeux là-bas");
  await edit.focus();
  await edit.press("Control+End");
  await edit.press("Alt+ArrowUp");
  await expect(edit).toHaveValue("deux là-bas\ndeux ici");

  // Retour au départ, puis lignes prises une à une, dans l'ordre des clics.
  await c2.getByRole("button", { name: "Revenir au départ pour cette modification" }).click();
  await expect(edit).toHaveValue("deux");
  await c2.getByRole("checkbox", { name: "deux ici" }).click();
  await c2.getByRole("checkbox", { name: "deux là-bas" }).click();
  await expect(edit).toHaveValue("deux ici\ndeux là-bas");
  await c2.getByRole("checkbox", { name: "deux ici" }).click();
  await expect(edit).toHaveValue("deux là-bas");

  await view.getByRole("button", { name: "Enregistrer et marquer résolu" }).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByText("conflit.txt résolu et indexé.")).toBeVisible();
  await expect(panel.getByRole("listbox", { name: "Indexés", exact: true })).toContainText("conflit.txt");
});

test("conflits sur plusieurs fichiers : Accepter, passage au fichier suivant après l'enregistrement", async ({ page }) => {
  await addConflict(page, "a.txt");
  await addConflict(page, "b.txt");
  await page.keyboard.press("F5");
  const panel = page.getByRole("complementary", { name: "Modifications en cours" });
  await panel.getByRole("listbox", { name: "Conflits" }).getByRole("option").filter({ hasText: "a.txt" }).click();
  const viewA = page.getByRole("region", { name: "Résolution du conflit de a.txt" });
  await expect(viewA.getByText("Fichier 1 / 2")).toBeVisible();
  // Merge en cours : les côtés s'appellent « notre branche » et « branche fusionnée ».
  await viewA.getByRole("button", { name: "Prendre la branche fusionnée" }).click();
  await expect(viewA.locator(".conflict-status")).toHaveText("Tout est résolu");
  await expect(viewA.getByRole("group", { name: /^Conflit 1 \/ 2/ }).getByRole("textbox")).toHaveValue("let a = 1, b = 20;");
  await viewA.getByRole("button", { name: "Enregistrer et marquer résolu" }).click();
  // Le fichier suivant s'ouvre tout seul.
  const viewB = page.getByRole("region", { name: "Résolution du conflit de b.txt" });
  await expect(viewB).toBeVisible();
  // L'enregistrement du précédent est annoncé en haut (pas de toast sur les boutons du pied).
  await expect(viewB.getByText("a.txt résolu et indexé.")).toBeVisible();
  await expect(viewB.locator(".conflict-status")).toHaveText("2 conflits à résoudre");
  // Quitter avec des choix faits : confirmation.
  await viewB.getByRole("button", { name: "Garder notre branche" }).click();
  await viewB.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Abandonner cette résolution ?" }).getByRole("button", { name: "Abandonner" }).click();
  await expect(viewB).toHaveCount(0);
});

test("conflits au clavier : focus dans le résultat, F7 saute ce qui est réglé, Échap, une tabulation par colonne", async ({ page }) => {
  await addConflict(page, "conflit.txt");
  await page.keyboard.press("F5");
  const panel = page.getByRole("complementary", { name: "Modifications en cours" });
  await panel.getByRole("listbox", { name: "Conflits" }).getByRole("option").filter({ hasText: "conflit.txt" }).click();
  const view = page.getByRole("region", { name: "Résolution du conflit de conflit.txt" });
  const r1 = view.getByRole("textbox", { name: "Résultat de la modification 1" });
  const r2 = view.getByRole("textbox", { name: "Résultat de la modification 2" });
  await expect(r1).toBeFocused();

  // Alt+← : notre côté dans le conflit courant ; F7 va au conflit encore à régler.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(r1).toHaveValue("import o;\nlet a = 10, b = 2;");
  await page.keyboard.press("F7");
  await expect(r2).toBeFocused();
  await page.keyboard.press("F7"); // seul conflit à régler : on y reste
  await expect(r2).toBeFocused();

  // Échap sort du champ sans quitter la vue ; un second Échap demande confirmation.
  await page.keyboard.press("Escape");
  await expect(view.getByRole("group", { name: /^Conflit 2 \/ 2/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "Abandonner cette résolution ?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retour" }).click();

  // Une seule tabulation par colonne : les flèches passent d'une ligne à l'autre.
  const c1 = view.getByRole("group", { name: /^Conflit 1 \/ 2/ });
  const first = c1.getByRole("checkbox", { name: /^Notre branche, ligne 3/ });
  const second = c1.getByRole("checkbox", { name: /^Notre branche, ligne 4/ });
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(second).toHaveAttribute("tabindex", "-1");
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("tabindex", "0");

  // Des choix faits : « Prendre la branche fusionnée » demande confirmation avant de tout remplacer.
  await view.getByRole("button", { name: "Prendre la branche fusionnée" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Tout remplacer par « Branche fusionnée » ?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Remplacer" }).click();
  await expect(r1).toHaveValue("let a = 1, b = 20;");
});

test("au clavier : Entrée depuis le graphe, flèches, Maj+↓, Espace indexe, Suppr annule, Ctrl+A", async ({ page }) => {
  // Entrée sur la ligne « en cours » : le focus dans la liste des fichiers (une seule tabulation).
  await graph(page).focus();
  await page.keyboard.press("Enter");
  const render = unstaged(page).getByRole("option", { name: "render.ts" });
  await expect(render).toBeFocused();
  await expect(unstaged(page).locator('[tabindex="0"]')).toHaveCount(1);
  await expect(render).toHaveAttribute("aria-description", "Modifié, src/graph");

  // Maj+↓ : sélection de deux fichiers, l'action de la liste devient « Indexer (2) ».
  await page.keyboard.press("Shift+ArrowDown");
  await expect(panel(page).getByRole("button", { name: "Indexer (2)" })).toBeVisible();
  // Espace : les deux passent dans les indexés.
  await page.keyboard.press("Space");
  await expect(staged(page)).toContainText("render.ts");
  await expect(unstaged(page)).not.toContainText("render.ts");

  // Suppr sur notes.txt : confirmation (rien n'est perdu sans elle).
  await unstaged(page).getByRole("option", { name: "notes.txt" }).focus();
  await page.keyboard.press("Delete");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("notes.txt");
  await confirm.getByRole("button", { name: "Retour" }).click();

  // Ctrl+A : toute la liste, pas le texte de la page.
  await unstaged(page).getByRole("option", { name: "notes.txt" }).focus();
  await page.keyboard.press("Control+a");
  expect(await page.evaluate(() => document.getSelection()?.toString() ?? "")).toBe("");
});

test("zone de commit : identité réelle, bouton grisé focalisable avec sa raison", async ({ page }) => {
  await expect(panel(page).locator(".commit-as")).toContainText("Commit en tant que Démo ‹demo@exemple.fr›");
  const commit = panel(page).getByRole("button", { name: /^Commiter/ });
  await expect(commit).toHaveAttribute("aria-disabled", "true");
  await expect(commit).toHaveAccessibleDescription("Écrivez un résumé pour commiter.");
  await panel(page).getByPlaceholder("Résumé").fill("feat: x");
  await expect(commit).not.toHaveAttribute("aria-disabled", "true");
  await expect(commit).toHaveAccessibleDescription("Ctrl+Entrée pour commiter.");
});
