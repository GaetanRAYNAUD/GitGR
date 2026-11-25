import { expect, test } from "@playwright/test";
import { openNextRepo } from "./fixtures";

test("avatars des auteurs et des remotes dans le graphe, désactivables dans les réglages", async ({ page }) => {
  await page.goto("/");
  await openNextRepo(page, "GitGR");
  const graph = page.getByRole("listbox", { name: "Historique des commits" });

  // Colonne Auteur : l'avatar de l'auteur (backend simulé : une image pour chaque adresse).
  await expect(graph.locator(".commit-author .author-avatar").first()).toHaveAttribute("src", /^data:image\/png;base64,/);
  // Étiquettes de branches : avec un seul remote, pas d'icône (elle n'apprendrait rien).
  await expect(graph.locator(".chip-mark")).toHaveCount(0);
  // À partir de deux remotes : l'avatar du propriétaire du dépôt distant (groupe `demo` d'origin).
  await page.getByRole("navigation", { name: "Branches et tags" }).getByRole("button", { name: "Ajouter un remote…" }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un remote" });
  await dialog.getByLabel("Nom du remote").fill("client");
  await dialog.getByLabel("URL").fill("git@gitlab.client.fr:projet/gitgr.git");
  await dialog.getByRole("button", { name: "Ajouter" }).click();
  await expect(graph.locator(".chip .chip-mark .remote-avatar").first()).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(graph.locator(".chip.tag .chip-mark")).toHaveCount(0);

  // Réglage : plus d'avatars.
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("navigation", { name: "Sections des réglages" }).getByRole("button", { name: "Graphe" }).click();
  const box = page.getByRole("checkbox", { name: "Avatars des auteurs dans le graphe" });
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.getByRole("button", { name: "Fermer les paramètres" }).click();
  await expect(graph.locator(".author-avatar")).toHaveCount(0);
  await expect(graph.locator(".chip-mark")).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "{}").settings);
  expect(saved.graphAvatarsOff).toBe(true);
});
