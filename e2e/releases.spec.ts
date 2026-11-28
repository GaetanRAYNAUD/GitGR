import { expect, test } from "@playwright/test";
import { openNextRepo } from "./fixtures";

/** Profil « Boulot » (règle gitlab.exemple.fr), avec ou sans compte sur cette instance. */
async function seed(page: import("@playwright/test").Page, withAccount: boolean) {
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

const tagItem = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Branches et tags" }).getByRole("treeitem", { name: /^v0\.8\.0/ });

test("release d'un tag : notes tirées des commits, créée sur GitLab avec le compte du remote", async ({ page }) => {
  await seed(page, true);
  await page.getByRole("navigation", { name: "Branches et tags" }).getByRole("treeitem", { name: /^Tags/ }).click();
  await tagItem(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Créer la release…" }).click();

  const d = page.getByRole("dialog", { name: "Release v0.8.0" });
  await expect(d).toContainText("Commits depuis v0.7.0");
  await expect(d).toContainText("Sur GitLab, demo/gitgr");
  const notes = d.getByLabel("Notes (Markdown)");
  await expect(notes).toHaveValue(/### Corrections\n\n- correctif local pas encore poussé/);
  // GitLab : ni brouillon ni pré-version.
  await expect(d.getByLabel("Brouillon (publiée plus tard)")).toHaveCount(0);
  await d.getByLabel("Pousser d’abord le tag v0.8.0 sur origin").uncheck();
  await d.getByLabel("Nom").fill("Version 0.8");
  await d.getByRole("button", { name: "Créer la release" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText("Release v0.8.0 créée.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir la release" })).toBeVisible();
  const created = await page.evaluate(() => (window as unknown as { __mockReleases: { tag: string; name: string; repo: string }[] }).__mockReleases);
  expect(created).toMatchObject([{ tag: "v0.8.0", name: "Version 0.8" }]);
});

test("release sans compte pour le remote : le bouton dit pourquoi", async ({ page }) => {
  await seed(page, false);
  await page.getByRole("navigation", { name: "Branches et tags" }).getByRole("treeitem", { name: /^Tags/ }).click();
  await tagItem(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Créer la release…" }).click();
  const d = page.getByRole("dialog", { name: "Release v0.8.0" });
  await expect(d.getByRole("button", { name: "Créer la release" })).toBeDisabled();
  await expect(d).toContainText("Pas de compte pour origin");
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
});
