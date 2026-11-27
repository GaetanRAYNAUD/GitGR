import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Publier un dépôt sans remote : le dépôt simulé « GitGR » perd son remote origin, puis il est
// publié sur le compte GitHub du profil « Perso » (backend simulé : src/lib/api.ts).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Publier sur GitHub / GitLab" });
/** Bouton de la barre d'outils, avec son badge cliquable quand il en a un (enveloppe `.tool-badged`). */
const tool = (page: Page, name: string) =>
  page
    .locator(".tools")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator("xpath=(ancestor::*[contains(concat(' ', @class, ' '), ' tool-badged ')] | .)[1]");

async function seedProfile(page: Page) {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "null") ?? {
      repos: [],
      session: { openTabs: [], active: null },
      settings: { theme: "system", language: "system" },
    };
    state.profiles = [
      {
        id: "p-perso",
        name: "Perso",
        userName: "Demo",
        userEmail: "demo@exemple.fr",
        sshKey: "~/.ssh/id_ed25519",
        rules: [],
        color: 0,
        accounts: [{ id: "github|https://github.com|octo-demo", kind: "github", url: "https://github.com", login: "octo-demo", name: "Octo" }],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  });
  await page.reload();
}

/** Ouvre « GitGR » et retire son remote origin. */
async function withoutRemote(page: Page) {
  await openNextRepo(page, "GitGR");
  await sidebar(page).locator(".section-btn", { hasText: "origin" }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Supprimer le remote…" }).click();
  await page.getByRole("alertdialog", { name: "Supprimer le remote origin ?" }).getByRole("button", { name: "Supprimer" }).click();
  await expect(sidebar(page).getByText("Aucun remote")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await seedProfile(page);
});

test("publier : dépôt créé, remote ajouté, branche poussée et suivie", async ({ page }) => {
  await withoutRemote(page);
  // Sans remote, le bouton Push devient « Publier ».
  await tool(page, "Publier").click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  // Propriétaire : un menu avec l'avatar de chacun, le compte d'abord.
  const owner = d.getByRole("button", { name: /^Propriétaire / });
  await expect(owner).toHaveAccessibleName("Propriétaire octo-demo");
  await expect(owner.locator("img")).toBeVisible();
  await owner.click();
  const owners = page.getByRole("menu").getByRole("menuitemradio");
  await expect(owners).toHaveText(["octo-demo", "acme"]);
  await expect(owners.locator("img")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(d.getByLabel("Nom du dépôt")).toHaveValue("GitGR");
  await expect(d.getByLabel("Nom du remote")).toHaveValue("origin");
  await expect(d.getByRole("radio", { name: "Privé" })).toHaveAttribute("aria-checked", "true");
  await expect(d.getByRole("checkbox", { name: "Pousser main vers origin et la suivre" })).toBeChecked();
  await expect(d.getByText("Sera créé sur GitHub : octo-demo/GitGR")).toBeVisible();

  // Nom invalide : refusé avant tout envoi (les espaces deviennent des « - »).
  await d.getByLabel("Nom du dépôt").fill("mon dépôt");
  await expect(d.getByLabel("Nom du dépôt")).toHaveValue("mon-dépôt");
  await expect(d.getByRole("button", { name: "Publier" })).toBeDisabled();
  // Nom déjà pris sur le compte : l'erreur du provider reste dans la fenêtre.
  await d.getByLabel("Nom du dépôt").fill("dotfiles");
  await d.getByRole("button", { name: "Publier" }).click();
  await expect(d.getByRole("alert")).toHaveText("Un dépôt porte déjà ce nom à cet endroit.");

  await d.getByLabel("Nom du dépôt").fill("GitGR");
  await d.getByRole("button", { name: "Publier" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Dépôt octo-demo/GitGR publié." })).toBeVisible();
  await expect(sidebar(page).locator(".section-btn", { hasText: "origin" })).toBeVisible();
  // Le remote pointe vers le nouveau dépôt, la branche le suit : le bouton Push revient.
  await expect(sidebar(page).locator(".section-btn", { hasText: "origin" })).toHaveAttribute("title", /git@github\.com:octo-demo\/GitGR\.git/);
  await expect(tool(page, "Push")).toBeVisible();
  await expect(tool(page, "Push")).toHaveAttribute("title", "Pousser vers origin/main (Ctrl+Maj+K)");
});

test("publier depuis la barre latérale, dans une organisation, sans pousser", async ({ page }) => {
  await withoutRemote(page);
  await sidebar(page).getByRole("button", { name: "Publier le dépôt…" }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: /^Propriétaire / }).click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: "acme" }).click();
  await d.getByRole("radio", { name: "Public" }).click();
  await d.getByRole("radio", { name: "HTTPS" }).click();
  await d.getByRole("checkbox", { name: /^Pousser main/ }).uncheck();
  await expect(d.getByText("Sera créé sur GitHub : acme/GitGR")).toBeVisible();
  await d.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dépôt acme/GitGR publié." })).toBeVisible();
  await expect(sidebar(page).locator(".section-btn", { hasText: "origin" })).toHaveAttribute("title", /https:\/\/github\.com\/acme\/GitGR\.git/);
  // Rien n'a été poussé : main ne suit toujours rien.
  await expect(tool(page, "Push")).not.toHaveAttribute("title", "origin/main");
});
