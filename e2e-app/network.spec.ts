// Commande réseau qui ne finit pas : un remote qui ne répond jamais (`ext::`, une commande qui
// attend). La pastille de la barre dit depuis combien de temps le fetch tourne ; « Annuler »
// arrête git et ce qu'il a lancé, sans message d'erreur.

import { expect, git, launchApp, test } from "./app";

test("fetch bloqué : temps écoulé, puis Annuler l'arrête", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "remote", "add", "lent", "ext::sleep 120");
  git(mine, "config", "protocol.ext.allow", "always");
  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("toolbar", { name: "Actions du dépôt" }).getByRole("button", { name: "Fetch" }).click();
    const pill = page.getByText(/^Fetch depuis \d+ s$/);
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Arrêter le Fetch en cours" }).click();
    await expect(page.getByText("Commande arrêtée.")).toBeVisible({ timeout: 15_000 });
    await expect(pill).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
