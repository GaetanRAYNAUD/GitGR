// Fenêtre : l'état agrandi est gardé d'une session à l'autre (plugin window-state, fichier
// `.window-state.json` dans le dossier de configuration, sauvé à la fermeture).

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchApp, test } from "./app";

const isMaximized = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<boolean> } }).__TAURI_INTERNALS__.invoke(
      "plugin:window|is_maximized",
      { label: "main" },
    ),
  );

test("fenêtre agrandie : toujours agrandie après redémarrage", async ({ sandbox }) => {
  const repo = sandbox.clone("repo");
  let app = await launchApp(sandbox, [repo]);
  try {
    expect(await isMaximized(app.page)).toBe(false);
    await app.page.getByRole("button", { name: "Agrandir" }).click();
    await expect.poll(() => isMaximized(app.page)).toBe(true);
    // Fermeture par le bouton de l'app (pas un arrêt du processus) : l'état est écrit.
    await app.page.getByRole("button", { name: "Fermer", exact: true }).click();
    await app.exited;
    expect(existsSync(join(sandbox.root, "config", ".window-state.json"))).toBe(true);
  } finally {
    await app.close();
  }

  app = await launchApp(sandbox, [repo]);
  try {
    await expect.poll(() => isMaximized(app.page)).toBe(true);
  } finally {
    await app.close();
  }
});
