// Comptes providers dans la vraie app : le token est vérifié auprès de l'instance (ici un faux
// GitLab local), rangé dans le trousseau du système — jamais dans state.json —, relu pour
// vérifier le compte, puis oublié à la déconnexion.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, launchApp, test } from "./app";

const TOKEN = "glpat-test-0123456789";

const boulot = {
  id: "boulot",
  name: "Boulot",
  userName: "Camille Boulot",
  userEmail: "camille@boulot.fr",
  sshKey: null,
  rules: [],
  color: 1,
};

/** Faux GitLab : `GET /api/v4/user` répond au bon token, refuse les autres. Renvoie aussi les
 *  requêtes reçues (`méthode chemin`). */
async function fakeGitlab(): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const ok = req.url === "/api/v4/user" && req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ok ? { id: 7, username: "camille", name: "Camille Boulot" } : { message: "401 Unauthorized" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test("connecter un compte GitLab par token : vérifié, rangé dans le trousseau, puis déconnecté", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const gitlab = await fakeGitlab();
  const app = await launchApp(sandbox, [mine], { profiles: [boulot] });
  const { page } = app;
  const accounts = page.getByRole("region", { name: "Comptes GitHub / GitLab" });
  const row = accounts.getByRole("listitem").filter({ hasText: "camille" });
  try {
    await page.getByRole("button", { name: "Réglages" }).click();
    await page.getByRole("button", { name: "Gérer les profils…" }).click();
    await expect(accounts).toContainText("Aucun compte connecté.");

    await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
    const dialog = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });
    await dialog.getByRole("radio", { name: "GitLab" }).click();
    await dialog.getByLabel("Instance").fill(gitlab.url);

    // Mauvais token : refusé par l'instance, rien n'est enregistré.
    await dialog.getByLabel("Token personnel").fill("glpat-mauvais");
    await dialog.getByRole("button", { name: "Connecter", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Token refusé : il est incorrect, expiré ou révoqué.");
    await expect(accounts).toContainText("Aucun compte connecté.");

    await dialog.getByLabel("Token personnel").fill(TOKEN);
    await dialog.getByRole("button", { name: "Connecter", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText(`Camille Boulot · ${gitlab.url}`);
    // « connecté » : le token a été relu dans le trousseau et accepté par l'instance.
    await expect(row.getByRole("status")).toHaveText("connecté");
    expect(gitlab.requests).toEqual(["GET /api/v4/user", "GET /api/v4/user", "GET /api/v4/user"]);

    // Le compte est dans state.json, pas son token.
    const stateFile = join(sandbox.root, "config", "state.json");
    const state = readFileSync(stateFile, "utf8");
    expect(JSON.parse(state).profiles[0].accounts).toEqual([
      { id: `gitlab|${gitlab.url}|camille`, kind: "gitlab", url: gitlab.url, login: "camille", name: "Camille Boulot" },
    ]);
    expect(state).not.toContain(TOKEN);

    // Déconnexion : le compte quitte le profil.
    await row.getByRole("button", { name: "Déconnecter camille" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Déconnecter" }).click();
    await expect(accounts).toContainText("Aucun compte connecté.");
    await expect.poll(() => JSON.parse(readFileSync(stateFile, "utf8")).profiles[0].accounts).toEqual([]);
  } finally {
    // Test interrompu : ne rien laisser dans le trousseau (au mieux).
    if (await row.isVisible().catch(() => false)) {
      await row.getByRole("button", { name: "Déconnecter camille" }).click().catch(() => {});
      await page.getByRole("alertdialog").getByRole("button", { name: "Déconnecter" }).click().catch(() => {});
      await expect(row).toBeHidden().catch(() => {});
    }
    await app.close();
    gitlab.server.close();
  }
});
