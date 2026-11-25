import { expect, test, type Page } from "@playwright/test";
import { openNextRepo, openRepos } from "./fixtures";

// Barre d'outils du dépôt : une tabulation, flèches, raccourcis Ctrl+Maj+lettre, et des
// actions impossibles qui restent focalisables et disent pourquoi.

const bar = (page: Page) => page.getByRole("toolbar", { name: "Actions du dépôt" });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
});

test("une seule tabulation, flèches d'un outil à l'autre, noms avec les compteurs", async ({ page }) => {
  await expect(bar(page).locator('button[tabindex="0"]')).toHaveCount(1);
  // Push porte le nombre de commits à pousser dans son nom.
  await expect(bar(page).getByRole("button", { name: "Push, 1 commit à pousser" })).toBeVisible();
  // Grisé mais focalisable, avec sa raison.
  const pop = bar(page).getByRole("button", { name: "Pop" });
  await expect(pop).toHaveAttribute("aria-disabled", "true");
  await expect(pop).toHaveAttribute("aria-description", "Aucun stash");

  await bar(page).locator('button[tabindex="0"]').focus();
  await page.keyboard.press("End");
  await expect(bar(page).getByRole("button", { name: "Actualiser" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(bar(page).getByRole("button", { name: /^Pull/ })).toBeFocused();
  // Le dernier outil focalisé garde l'arrêt de tabulation.
  await expect(bar(page).getByRole("button", { name: /^Pull/ })).toHaveAttribute("tabindex", "0");

  // Le menu du mode de pull dit qu'il est ouvert.
  const chevron = bar(page).getByRole("button", { name: "Mode du pull" });
  await chevron.click();
  await expect(chevron).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu", { name: "Mode du pull" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chevron).toHaveAttribute("aria-expanded", "false");
});

test("Ctrl+Maj+F fait un fetch ; la pastille de branche amène le graphe au commit courant", async ({ page }) => {
  await page.keyboard.press("Control+Shift+F");
  await expect(page.getByText("Fetch terminé.")).toBeVisible();

  await graph(page).getByRole("option").nth(5).click();
  await page.getByRole("button", { name: /^GitGR — main —/ }).click();
  await expect(graph(page).getByRole("option", { selected: true })).toHaveAttribute("aria-label", /HEAD \(commit courant\)/);
});

test("merge en cours : pastille dans la barre, actions grisées avec la raison, raccourci refusé", async ({ page }) => {
  await page.keyboard.press("Control+t");
  await page.getByRole("button", { name: /Ouvrir un dépôt/ }).click();
  const lines = (...l: string[]) => l.map((x) => `${x}\n`).join("");
  await page.evaluate(
    ([f, t]) =>
      (window as unknown as { __mockConflict: (p: string, f: string, t: string, v: unknown) => void }).__mockConflict("C:/Users/demo/work/api-backend", f, t, {
        base: "",
        ours: "a\n",
        theirs: "b\n",
      }),
    ["c.txt", lines("<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> x")] as const,
  );
  await page.keyboard.press("F5");

  const pill = page.getByRole("button", { name: "Merge en cours" });
  await expect(pill).toBeVisible();
  const reason = "Merge en cours : terminez-le ou annulez-le d’abord";
  for (const name of [/^Pull/, /^Branche/, /^Stash/]) {
    await expect(bar(page).getByRole("button", { name })).toHaveAttribute("aria-description", reason);
  }
  // Le raccourci ne lance rien et dit pourquoi.
  await page.keyboard.press("Control+Shift+L");
  await expect(page.getByRole("status").filter({ hasText: reason })).toBeVisible();
  // La pastille mène aux modifications en cours (conflits, Continuer / Annuler l'opération).
  await pill.click();
  await expect(page.getByRole("complementary", { name: "Modifications en cours" })).toBeVisible();
});

test("barre d'état : ↑ ouvre ce qui part au push, lu en toutes lettres", async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 2);
  const bar = page.getByRole("region", { name: "Barre d’état" });
  await bar.getByRole("button", { name: "1 commit à pousser" }).click();
  await expect(page.getByRole("region", { name: "Ce qui part au push" })).toBeVisible();
});
