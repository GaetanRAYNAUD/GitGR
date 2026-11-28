import { expect, test } from "@playwright/test";

test("F1 : la liste des raccourcis, groupée par zone, avec une recherche", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("F1");
  const section = page.getByRole("region", { name: "Raccourcis clavier" });
  await expect(section.getByRole("heading", { name: "Barre d’outils du dépôt" })).toBeVisible();
  await expect(section.getByRole("row", { name: /Push/ })).toContainText("CtrlMajK");

  const search = section.getByRole("searchbox", { name: "Chercher un raccourci (action ou touche)" });
  await search.fill("ctrl+maj+k");
  await expect(section.getByRole("row")).toHaveCount(1);
  await search.fill("zzz");
  await expect(section).toContainText("Aucun raccourci ne correspond.");
  // Échap vide d'abord la recherche, puis ferme les réglages.
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(section.getByRole("row").first()).toBeVisible();
});
