import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
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
        accounts: [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  });
  await page.reload();
  await openNextRepo(page, "GitGR");
}



test("issues : section de la barre latérale, vue d'une issue, commenter, fermer, branche proposée", async ({ page }) => {
  await seed(page);
  const sidebar = page.getByRole("navigation", { name: "Branches et tags" });
  await expect(sidebar.getByRole("treeitem", { name: /^Issues/ })).toContainText("2");
  await sidebar.getByRole("group", { name: "Filtre des issues" }).getByRole("button", { name: "Les miennes" }).click();
  await expect(sidebar.getByRole("treeitem", { name: /^#9/ })).toHaveCount(0);
  await sidebar.getByRole("treeitem", { name: /^#12/ }).click();

  const view = page.getByRole("region", { name: "Issue #12" });
  await expect(view).toContainText("#12 Le graphe saute au rechargement");
  await expect(view).toContainText("Jalon : v0.4");
  await expect(view.locator(".issue-text")).toContainText("Après un fetch, la sélection revient en haut.");
  await expect(view.locator(".issue-comment")).toHaveCount(1);

  const box = view.getByRole("textbox", { name: "Commenter" });
  await box.fill("Je regarde ça.");
  await box.press("Control+Enter");
  await expect(view.locator(".issue-comment")).toHaveCount(2);
  await expect(box).toHaveValue("");

  await view.getByRole("button", { name: "Créer une branche…" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
  await expect(dialog.getByLabel("Nom de la branche")).toHaveValue("12-le-graphe-saute-au-rechargement");
  await page.keyboard.press("Escape");

  await view.getByRole("button", { name: "Fermer l’issue" }).click();
  await expect(view.locator(".pull-state")).toHaveText("Fermée");
  await expect(view.getByRole("button", { name: "Rouvrir l’issue" })).toBeVisible();
});
