import { expect, test, type Page } from "@playwright/test";
import { openNextRepo, openRepos, tab } from "./fixtures";

// Branches simulées (src/lib/mockHistory.ts) : main (1 commit à pousser, suit origin/main),
// feature/graph-rendering, feature/profils (sans distante), fix/ssh-agent (1 commit à tirer).
// Les opérations simulées sont dans src/lib/mockBranches.ts.

const tools = (page: Page) => page.locator(".tools");
/** Bouton de la barre d'outils, avec son badge cliquable quand il en a un (enveloppe `.tool-badged`). */
const tool = (page: Page, name: string) =>
  page
    .locator(".tools")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator("xpath=(ancestor::*[contains(concat(' ', @class, ' '), ' tool-badged ')] | .)[1]");
const current = (page: Page) => page.locator(".branch-chip-label");
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
/** Section « Local » de la barre latérale (les distantes ont souvent le même nom). */
const locals = (page: Page) => sidebar(page).locator(".side-group").first();
/** Bouton d'une branche locale (son nom affiché est suivi des compteurs ↑ ↓). */
const branch = (page: Page, label: string) => locals(page).getByRole("button", { name: new RegExp(`^${label}( |$)`) });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
/** Menu contextuel principal (un sous-menu ouvert est un second `menu`, imbriqué). */
const menu = (page: Page) => page.getByRole("menu").first();

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
    await menu(page).getByRole("menuitem", { name: "Supprimer essai/neuve…" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Supprimer essai/neuve ?" });
    await confirm.getByRole("button", { name: "Supprimer" }).click();
    await expect(branch(page, "neuve")).toHaveCount(0);
  });

  test("la branche courante ne peut pas être supprimée depuis son menu", async ({ page }) => {
    await branch(page, "main").click({ button: "right" });
    await expect(menu(page).getByRole("menuitem", { name: "Supprimer main…" })).toBeDisabled();
    await expect(menu(page).getByRole("menuitem", { name: "Supprimer main…" })).toHaveAttribute("title", "Impossible de supprimer la branche courante.");
    // Pas de merge / rebase d'une branche sur elle-même.
    await expect(menu(page).getByRole("menuitem", { name: /^Merge de/ })).toHaveCount(0);
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

  test("barre d'état : date du dernier fetch", async ({ page }) => {
    // Fetch automatique à l'ouverture de l'onglet.
    await expect(page.locator(".statusbar")).toContainText("Fetch à l’instant");
    await expect(page.locator(".statusbar").getByText("Fetch à l’instant")).toHaveAttribute("title", /\d/);
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

  test("menu d'une autre branche : pull sans checkout, merge, reset en sous-menu", async ({ page }) => {
    // fix/ssh-agent a un commit à tirer : mise à jour sans quitter main.
    await branch(page, "ssh-agent").click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Pull de fix/ssh-agent (avance rapide)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "fix/ssh-agent mise à jour." })).toBeVisible();
    await expect(current(page)).toHaveText("main");

    // Merge de feature/profils dans main.
    await branch(page, "profils").click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Merge de feature/profils dans main" }).click();
    await expect(page.getByRole("status").filter({ hasText: "feature/profils fusionnée dans main." })).toBeVisible();

    // Reset : le mode se choisit dans le sous-menu (au clavier ici), hard demande confirmation.
    await branch(page, "profils").click({ button: "right" });
    const reset = menu(page).getByRole("menuitem", { name: "Reset de main sur feature/profils" });
    await reset.focus();
    await page.keyboard.press("ArrowRight");
    const sub = page.locator(".context-menu.submenu");
    await expect(sub.getByRole("menuitem", { name: /^Soft/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(sub).toHaveCount(0);
    await expect(reset).toBeFocused();
    await reset.hover();
    await sub.getByRole("menuitem", { name: /^Hard/ }).click();
    await page.getByRole("alertdialog", { name: /^Reset de main sur / }).getByRole("button", { name: "Hard (tout abandonner)" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^main est maintenant sur / })).toBeVisible();
  });

  test("glisser un commit sur une branche : déplacer la branche, cherry-pick dessus", async ({ page }) => {
    const row = graph(page).getByRole("option").nth(3);
    const sha = (await row.getAttribute("id"))!.replace("commit-", "").slice(0, 7);
    const drag = async (target: ReturnType<typeof branch>) => {
      const to = (await target.boundingBox())!;
      // Saisi par le message : depuis une étiquette de branche locale, c'est la branche qu'on glisse.
      const msg = (await row.locator(".commit-msg").boundingBox())!;
      await page.mouse.move(msg.x + 20, msg.y + msg.height / 2);
      await page.mouse.down();
      await page.mouse.move(msg.x + 40, msg.y + msg.height / 2, { steps: 3 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
      await expect(target).toHaveClass(/drop-over/);
      await page.mouse.up();
    };

    // Sur une autre branche : la déplacer (confirmation).
    await drag(branch(page, "profils"));
    await menu(page).getByRole("menuitem", { name: `Déplacer feature/profils sur ${sha}…` }).click();
    await page.getByRole("alertdialog", { name: `Déplacer feature/profils sur ${sha} ?` }).getByRole("button", { name: "Déplacer" }).click();
    await expect(row).toContainText("feature/profils");
    await expect(current(page)).toHaveText("main");

    // Sur la branche courante : cherry-pick.
    await drag(branch(page, "main"));
    await expect(menu(page).getByRole("menuitem", { name: `Reset de main sur ${sha}` })).toBeVisible();
    await menu(page).getByRole("menuitem", { name: `Cherry-pick de ${sha} sur main` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cherry-pick sur main terminé." })).toBeVisible();
  });

  test("Ctrl+Z / Ctrl+Y : annuler puis rétablir la création d'une branche extraite", async ({ page }) => {
    await expect(tool(page, "Annuler")).toBeDisabled();
    await tool(page, "Branche").click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await dialog.getByLabel("Nom de la branche").fill("essai/annuler");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(current(page)).toHaveText("essai/annuler");
    await expect(tool(page, "Annuler")).toHaveAttribute("title", "Annuler : création de branche (Ctrl+Z)");

    await page.locator("body").press("Control+z");
    await expect(page.getByRole("status").filter({ hasText: "Annulé : création de branche." })).toBeVisible();
    await expect(current(page)).toHaveText("main");
    await expect(branch(page, "annuler")).toHaveCount(0);

    await tool(page, "Rétablir").click();
    await expect(current(page)).toHaveText("essai/annuler");
    await expect(branch(page, "annuler")).toHaveCount(1);
    await expect(tool(page, "Rétablir")).toBeDisabled();
  });

  test("glisser une branche sur une autre : merge dans la courante, rebase avec checkout d'abord", async ({ page }) => {
    const drag = async (source: ReturnType<typeof branch>, target: ReturnType<typeof branch>) => {
      const from = (await source.boundingBox())!;
      const to = (await target.boundingBox())!;
      await page.mouse.move(from.x + 20, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 3 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
      await expect(target).toHaveClass(/drop-over/);
      await page.mouse.up();
    };

    // Sur elle-même : rien.
    await drag(branch(page, "profils"), branch(page, "profils"));
    await expect(menu(page)).toHaveCount(0);

    await drag(branch(page, "profils"), branch(page, "main"));
    await expect(menu(page).getByRole("menuitem", { name: "Rebase de feature/profils sur main" })).toHaveAttribute("title", /Passe d’abord sur feature\/profils/);
    await menu(page).getByRole("menuitem", { name: "Merge de feature/profils dans main" }).click();
    await expect(page.getByRole("status").filter({ hasText: /feature\/profils.*main/ })).toBeVisible();
    await expect(current(page)).toHaveText("main");

    await drag(branch(page, "ssh-agent"), branch(page, "main"));
    await menu(page).getByRole("menuitem", { name: "Rebase de fix/ssh-agent sur main" }).click();
    await expect(current(page)).toHaveText("fix/ssh-agent");
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

test.describe("tags", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openNextRepo(page, "GitGR");
  });

  test("clic droit sur un commit : tag annoté poussé, puis supprimé depuis la barre latérale", async ({ page }) => {
    const row = graph(page).getByRole("option").nth(3);
    await row.click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Nouveau tag ici…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouveau tag" });
    await expect(dialog).toContainText(/Sur [0-9a-f]{7}/);
    await dialog.getByLabel("Nom du tag").fill("v 9");
    await expect(dialog.getByRole("button", { name: "Créer le tag" })).toBeDisabled();
    await dialog.getByLabel("Nom du tag").fill("v9.0.0");
    await dialog.getByLabel(/^Message/).fill("Version 9");
    await dialog.getByLabel("Pousser le tag sur origin").check();
    await dialog.getByRole("button", { name: "Créer le tag" }).click();
    await expect(row).toContainText("v9.0.0");
    await expect(page.getByText("Tag v9.0.0 poussé sur origin.")).toBeVisible();

    await sidebar(page).getByRole("button", { name: /^Tags/ }).click();
    await sidebar(page).getByRole("button", { name: "v9.0.0" }).click({ button: "right" });
    await menu(page).getByRole("menuitem", { name: "Supprimer le tag v9.0.0…" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Supprimer le tag v9.0.0 ?" });
    await confirm.getByRole("button", { name: "Supprimer localement" }).click();
    await expect(row).not.toContainText("v9.0.0");
    await expect(sidebar(page).getByRole("button", { name: "v9.0.0" })).toHaveCount(0);
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

  test("section Stashes : toute la pile, appliquer sans retirer, supprimer après confirmation", async ({ page }) => {
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    const stashes = sidebar(page).getByRole("list", { name: "Stashes" });
    await expect(sidebar(page).getByRole("button", { name: /^Stashes/ })).toHaveCount(0);
    await tool(page, "Stash").click();
    await expect(stashes.getByRole("button")).toHaveCount(1);
    await expect(stashes).toContainText("main");

    // Clic : son contenu à la place du graphe, fichiers et diff ; Échap revient au graphe.
    await stashes.getByRole("button").first().click();
    const view = page.getByRole("region", { name: /^Stash/ });
    await expect(view.locator(".file-row")).toHaveCount(4);
    await view.locator(".file-row", { hasText: "notes.txt" }).click();
    await expect(view.locator(".pull-file-diff .diff-path")).toHaveText("notes.txt");
    await expect(view.locator(".file-item", { hasText: "notes.txt" })).toContainText("non suivi");
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);

    const menu = page.getByRole("menu");
    await stashes.getByRole("button").first().click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Appliquer (le garder)" }).click();
    await expect(panel).toContainText("render.ts");
    await expect(stashes.getByRole("button")).toHaveCount(1);

    await stashes.getByRole("button").first().click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Renommer…" }).click();
    const rename = page.getByRole("dialog", { name: "Renommer le stash" });
    await rename.getByRole("textbox").fill("mis de côté pour plus tard");
    await rename.getByRole("button", { name: "Renommer" }).click();
    await expect(stashes).toContainText("mis de côté pour plus tard");

    await stashes.getByRole("button").first().click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Supprimer…" }).click();
    await page.getByRole("alertdialog", { name: "Supprimer ce stash ?" }).getByRole("button", { name: "Supprimer" }).click();
    await expect(sidebar(page).getByRole("button", { name: /^Stashes/ })).toHaveCount(0);
    await expect(tool(page, "Pop")).toBeDisabled();
  });

  test("créer une branche depuis un stash : extraite, le stash réappliqué et retiré", async ({ page }) => {
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    const stashes = sidebar(page).getByRole("list", { name: "Stashes" });
    await tool(page, "Stash").click();
    await stashes.getByRole("button").first().click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Créer une branche depuis ce stash…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await dialog.getByRole("textbox").fill("reprise");
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(current(page)).toHaveText("reprise");
    await expect(panel).toContainText("render.ts");
    await expect(sidebar(page).getByRole("button", { name: /^Stashes/ })).toHaveCount(0);
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
