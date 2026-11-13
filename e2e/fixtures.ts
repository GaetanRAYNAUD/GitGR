import { expect, type Page } from "@playwright/test";

// Le backend simulé renvoie ces dossiers, dans cet ordre, à chaque « Ouvrir un dépôt »
// (compteur remis à zéro à chaque chargement de page). Le 4e n'est pas un dépôt.
export const PICKS = ["GitGR", "api-backend", "dotfiles", "pas-un-depot"] as const;

export const tab = (page: Page, name: string) => page.getByRole("tab", { name });
export const homeButton = (page: Page) => page.getByRole("button", { name: "Accueil" });

/** Depuis n'importe quel écran : revient à l'accueil et ouvre le dépôt suivant. */
export async function openNextRepo(page: Page, expectedName: string) {
  await homeButton(page).click();
  await page.getByRole("button", { name: /Ouvrir un dépôt/ }).click();
  await expect(tab(page, expectedName)).toHaveAttribute("aria-selected", "true");
}

/** Ouvre les `n` premiers dépôts simulés. */
export async function openRepos(page: Page, n: number) {
  for (const name of PICKS.slice(0, n)) await openNextRepo(page, name);
}
