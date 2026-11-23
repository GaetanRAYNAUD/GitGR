// Mises à jour : l'app compilée ici est un build de debug, hors paquet. `install_kind` répond
// `none` : pas de vérification, et les Réglages le disent. Les plugins updater et process sont
// bien chargés (permissions de la capability comprises).

import { expect, launchApp, test } from "./app";

type Internals = { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

test("build de développement : pas de mise à jour automatique, plugins chargés", async ({ sandbox }) => {
  const app = await launchApp(sandbox, []);
  try {
    const { page } = app;
    expect(await page.evaluate(() => (window as unknown as Internals).__TAURI_INTERNALS__.invoke("install_kind"))).toBe("none");

    await page.getByRole("button", { name: "Réglages" }).click();
    const settings = page.getByRole("region", { name: "Réglages" });
    await expect(settings.getByText("Version de développement : pas de mise à jour automatique.")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Rechercher les mises à jour" })).toHaveCount(0);

    // Plugin updater chargé et autorisé : la vérification répond, sans erreur de permission ni
    // de plugin absent. Délai de 1 ms : elle échoue tout de suite, sans attendre le réseau.
    const check = await page.evaluate(() =>
      (window as unknown as Internals).__TAURI_INTERNALS__.invoke("plugin:updater|check", { timeout: 1 }).then(
        () => "ok",
        (e: unknown) => String(e),
      ),
    );
    expect(check).not.toMatch(/not allowed|plugin .* not found|Unhandled/i);
  } finally {
    await app.close();
  }
});
