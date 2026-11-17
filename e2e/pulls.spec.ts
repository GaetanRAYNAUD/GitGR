import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Dépôt simulé « GitGR » : origin sur gitlab.exemple.fr (donc des merge requests), main suit
// origin/main, feature/profils n'a pas de distante. Backend simulé : src/lib/api.ts (createPull).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const locals = (page: Page) => sidebar(page).locator(".side-group").first();
const branch = (page: Page, label: string) => locals(page).getByRole("button", { name: new RegExp(`^${label}( |$)`) });
/** Branche de la section du remote origin (2e section de la barre latérale). */
const remoteBranch = (page: Page, label: string) => sidebar(page).locator(".side-group").nth(1).getByRole("button", { name: new RegExp(`^${label}( |$)`) });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
const chip = (page: Page, label: string) => graph(page).locator(".chip", { has: page.locator(".chip-label", { hasText: new RegExp(`^${label}$`) }) });
const menu = (page: Page) => page.getByRole("menu");
const dialog = (page: Page) => page.getByRole("dialog", { name: /Créer une merge request|Merge request/ });

/** Profil « Boulot » (règle gitlab.exemple.fr) avec un compte sur cette instance, ou sans. */
async function seed(page: Page, withAccount: boolean) {
  await page.goto("/");
  await page.evaluate((withAccount) => {
    const state = { repos: [], session: { openTabs: [], active: null }, settings: { theme: "system", language: "system" } } as Record<string, unknown>;
    state.profiles = [
      {
        id: "p-boulot",
        name: "Boulot",
        userName: "Demo",
        userEmail: "demo@boulot.fr",
        sshKey: null,
        rules: ["gitlab.exemple.fr"],
        color: 1,
        accounts: withAccount ? [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }] : [],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  }, withAccount);
  await page.reload();
  await openNextRepo(page, "GitGR");
}

test("clic droit sur une autre branche : MR de la branche courante vers celle-ci, poussée d'abord", async ({ page }) => {
  await seed(page, true);
  await branch(page, "profils").dblclick();
  await expect(page.locator(".branch-chip-name")).toHaveText("feature/profils");

  await remoteBranch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request de feature/profils vers origin/main…" }).click();

  const d = dialog(page);
  await expect(d.locator(".pull-route")).toHaveText(/feature\/profils.*origin\/main/);
  await expect(d.getByLabel("Branche cible")).toHaveValue("main");
  // Deux commits : titre tiré de la branche, description = liste des commits.
  await expect(d.getByLabel("Titre")).toHaveValue("Feature/profils");
  await expect(d.getByLabel("Description")).toHaveValue("- Début de feature/profils\n- Fin de feature/profils");
  await expect(d.getByText("feature/profils sera d’abord poussée vers origin.")).toBeVisible();

  await d.getByLabel("Titre").fill("Profils : règles par remote");
  await d.getByLabel("Brouillon").check();
  await d.getByRole("button", { name: "Créer la merge request" }).click();

  const done = page.getByRole("dialog", { name: "Merge request !42 créée" });
  await expect(done).toBeVisible();
  await expect(page.getByText("Draft: Profils : règles par remote")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { __mockPulls: unknown[] }).__mockPulls);
  expect(sent).toEqual([
    {
      sourceRepo: "demo/gitgr",
      sourceBranch: "feature/profils",
      targetRepo: "demo/gitgr",
      targetBranch: "main",
      title: "Profils : règles par remote",
      body: "- Début de feature/profils\n- Fin de feature/profils",
      draft: true,
    },
  ]);
  // Poussée avec son suivi.
  await expect(chip(page, "feature/profils").locator(".chip-synced")).toBeVisible();
  await expect(remoteBranch(page, "profils")).toBeVisible();
  await done.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("sur la branche courante : cible par défaut du dépôt, et refus d'une MR vers sa propre branche suivie", async ({ page }) => {
  await seed(page, true);
  await branch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  const d = dialog(page);
  await expect(d.getByLabel("Branche cible")).toHaveValue("main");
  await expect(d.getByText("La branche cible est celle que suit la branche courante.")).toBeVisible();
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeDisabled();
  await d.getByLabel("Branche cible").fill("fix/ssh-agent");
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeEnabled();
  await d.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Pas d'entrée vers la branche que suit la courante.
  await remoteBranch(page, "main").click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: /merge request/ })).toHaveCount(0);
});

test("sans compte connecté : la raison et un lien vers les comptes", async ({ page }) => {
  await seed(page, false);
  await branch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  const d = dialog(page);
  await expect(d.getByText("Aucun compte GitLab n’est connecté pour le profil du remote origin.")).toBeVisible();
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeDisabled();
  await d.getByRole("button", { name: "Gérer les comptes…" }).click();
  await expect(page.locator(".profiles-page")).toBeVisible();
});
