// Clé SSH protégée par une phrase de passe, de bout en bout : un vrai serveur SSH local (le
// sshd de Git pour Windows), une clé du profil protégée, la phrase de passe saisie dans l'app
// (trousseau de Windows), puis fetch et push par ssh — ssh obtient la phrase de passe en
// relançant GitGR en mode askpass.

import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, git, launchApp, test, type Sandbox } from "./app";
import { msys, sshdAvailable, startServer, useSsh, type Server } from "./sshd";

const PASSPHRASE = "une phrase de passe";

test.skip(!sshdAvailable, "sshd de Git pour Windows introuvable");

/** Clone dont `origin` passe par le serveur SSH local. */
function sshClone(sandbox: Sandbox, server: Server, name: string): string {
  const dir = sandbox.clone(name);
  useSsh(dir, "origin", `ssh://127.0.0.1:${server.port}${msys(sandbox.remote)}`);
  return dir;
}

/** Retire l'entrée du trousseau de Windows même si le test s'est arrêté avant « Oublier »
 *  (nom de l'entrée : cf. src-tauri/src/secrets.rs). */
function forgetPassphrase(key: string) {
  const account = `ssh-key:${key.replace(/\\/g, "/").toLowerCase()}`;
  try {
    execFileSync("cmdkey", [`/delete:${account}.fr.gitgr.app`], { stdio: "ignore" });
  } catch {
    /* déjà retirée */
  }
}

/** Bouton de la barre d'outils, avec son badge cliquable quand il en a un (enveloppe `.tool-badged`). */
const tool = (page: Page, name: string) =>
  page
    .locator(".tools")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator("xpath=(ancestor::*[contains(concat(' ', @class, ' '), ' tool-badged ')] | .)[1]");

test("clé protégée : phrase de passe saisie dans l'app, puis fetch et push par ssh", async ({ sandbox }) => {
  const server = await startServer(sandbox, "sshd", PASSPHRASE);
  const mine = sshClone(sandbox, server, "mine");
  const other = sandbox.clone("other");
  sandbox.commit(other, "b.txt", "distant\n", "distant: b");
  git(other, "push", "-q");

  const profile = { id: "p", name: "Profil SSH", userName: "Camille", userEmail: "camille@exemple.fr", sshKey: server.key, rules: [], color: 0 };
  const app = await launchApp(
    sandbox,
    [mine],
    { profiles: [profile], repoProfiles: { [sandbox.top(mine)]: { active: "p", allowed: ["p"] } } },
    { HOME: server.home },
  );
  const { page } = app;
  try {
    // Sans phrase de passe connue : le fetch échoue proprement (pas d'attente sans fin).
    await tool(page, "Fetch").click();
    await expect(page.getByRole("alert")).toContainText("Authentification refusée");
    await page.getByRole("alert").getByRole("button", { name: "Fermer" }).click();

    // Phrase de passe saisie dans la page des profils (vérifiée, rangée dans le trousseau).
    await page.locator(".status-profile").click();
    await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
    await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name: "Clé SSH" }).click();
    await expect(page.locator(".profiles-page")).toContainText("Protégée par une phrase de passe : enregistrez-la");
    await page.getByRole("button", { name: "Enregistrer la phrase de passe…" }).click();
    const dialog = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
    await dialog.locator("input[type=password]").fill(PASSPHRASE);
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator(".profiles-page")).toContainText("Phrase de passe dans le trousseau du système.");
    await page.getByRole("button", { name: "Fermer les profils" }).click();

    // Fetch par ssh : ssh obtient la phrase de passe de GitGR (askpass).
    await tool(page, "Fetch").click();
    await expect
      .poll(async () => [git(mine, "log", "-1", "--format=%s", "origin/main"), ...(await page.getByRole("alert").allTextContents())].join(" | "), { timeout: 20_000 })
      .toBe("distant: b");
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Push par ssh aussi.
    git(mine, "merge", "-q", "--ff-only", "origin/main");
    sandbox.commit(mine, "c.txt", "local\n", "local: c");
    await page.keyboard.press("F5");
    // Le dépôt relu (le commit dans l'historique) avant le push : sinon, sur une machine chargée
    // (tests en parallèle), le push part avant que l'app voie le commit et n'envoie rien.
    await expect(page.getByText("local: c").first()).toBeVisible();
    await tool(page, "Push").click();
    await expect.poll(() => git(sandbox.remote, "log", "-1", "--format=%s", "main"), { timeout: 20_000 }).toBe("local: c");

    // Ménage : la phrase de passe quitte le trousseau de Windows.
    await page.locator(".status-profile").click();
    await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
    await page.getByRole("button", { name: "Oublier la phrase de passe" }).click();
    await expect(page.locator(".profiles-page")).toContainText("Protégée par une phrase de passe : enregistrez-la");
  } finally {
    await app.close();
    server.stop();
    forgetPassphrase(server.key);
  }
});
