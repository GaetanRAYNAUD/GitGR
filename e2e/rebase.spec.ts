import { expect, test } from "@playwright/test";
import { openNextRepo } from "./fixtures";

const graph = (page: import("@playwright/test").Page) => page.getByRole("listbox", { name: "Historique des commits" });

test("rebase interactif : depuis un commit, actions au clavier, déplacement, renommage, lancé", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  await expect(page.locator(".branch-chip-label")).toHaveText("main");
  // Ligne 4 du graphe simulé : trois commits de main (premiers parents) jusqu’à HEAD.
  await graph(page).getByRole("option").nth(4).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rebase interactif à partir d’ici…" }).click();

  const view = page.getByRole("region", { name: "Rebase interactif" });
  const list = view.getByRole("listbox", { name: "Commits à rejouer, du plus ancien au plus récent" });
  await expect(list).toBeFocused();
  const rows = list.getByRole("option");
  const n = await rows.count();
  expect(n).toBeGreaterThanOrEqual(2);
  await expect(view.getByRole("button", { name: "Lancer le rebase" })).toBeDisabled();
  await expect(view).toContainText("Rien n’a changé.");
  const first = (await rows.nth(0).getAttribute("aria-label"))!.split(", ")[0];

  // Le premier ne peut pas être réuni à un précédent.
  await page.keyboard.press("s");
  await expect(view).toContainText("Le premier commit gardé ne peut pas être réuni à un précédent.");
  await page.keyboard.press("p");
  // Déplacé en bas (Alt+↓), puis le nouveau premier renommé.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("aria-label", `${first}, Garder`);
  await page.keyboard.press("Home");
  await page.keyboard.press("r");
  await page.keyboard.press("Enter");
  const msg = view.getByRole("textbox").first();
  await expect(msg).toBeFocused();
  await msg.fill("Nouveau message");
  await page.keyboard.press("Escape");
  await expect(list).toBeFocused();
  await expect(view.locator(".rebase-summary")).toContainText(/déplacés? · 1 renommé/);

  await view.getByRole("button", { name: "Lancer le rebase" }).click();
  await expect(view).toHaveCount(0);
  await expect(page.getByText("Rebase de main terminé.")).toBeVisible();
});

test("rebase interactif de la branche courante sur une autre, depuis le menu de celle-ci", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
  await locals.getByRole("treeitem", { name: /^graph-rendering/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rebase interactif de main ici…" }).click();
  await expect(page.getByRole("region", { name: "Rebase interactif" })).toContainText("Rebase interactif de main depuis feature/graph-rendering");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Rebase interactif" })).toHaveCount(0);
});
