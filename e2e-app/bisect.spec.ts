// Bisect visuel dans la vraie app : vrai `git bisect` sur un dépôt temporaire.

import { expect, git, launchApp, test } from "./app";

test("bisect : mauvais puis bon au clic droit, verdicts dans le bandeau, premier mauvais commit trouvé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  // Huit commits ; le défaut arrive avec le sixième (« c5 »).
  for (let i = 0; i < 8; i++) sandbox.commit(mine, "v.txt", i >= 5 ? `bug ${i}\n` : `ok ${i}\n`, `c${i}`);

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    const banner = page.locator(".bisect-banner");
    await graph.getByRole("option", { name: /^c7/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Bisect : marquer comme mauvais" }).click();
    await expect(banner).toContainText("marquez un commit bon");
    await graph.getByRole("option", { name: /^c0/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Bisect : marquer comme bon" }).click();
    await expect(banner).toContainText(/testez [0-9a-f]{7} \(extrait\)/);

    // On teste le fichier extrait, comme le ferait l'utilisateur.
    for (let i = 0; i < 6; i++) {
      if ((await banner.textContent())?.includes("terminé")) break;
      const bug = git(mine, "show", "HEAD:v.txt").startsWith("bug");
      const before = (await banner.textContent()) ?? "";
      await banner.getByRole("button", { name: bug ? "Mauvais" : "Bon" }).click();
      // Le bandeau change (commit suivant, ou trouvé) une fois le checkout fait : pas avant,
      // sinon le fichier lu serait encore celui du commit précédent.
      await expect(banner).not.toHaveText(before);
      await expect(banner.getByRole("button", { name: /^(Arrêter|Terminer)$/ })).toBeEnabled();
    }
    const c5 = git(mine, "rev-parse", "main~2");
    await expect(banner).toContainText(`${c5.slice(0, 7)} est le premier mauvais commit`);
    await expect(graph.getByRole("option", { selected: true })).toContainText("c5");

    await banner.getByRole("button", { name: "Terminer" }).click();
    await expect(banner).toHaveCount(0);
    expect(git(mine, "branch", "--show-current")).toBe("main");
  } finally {
    await app.close();
  }
});
