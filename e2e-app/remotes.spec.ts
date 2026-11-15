// Un profil par remote, de bout en bout : deux vrais serveurs SSH locaux qui n'acceptent
// chacun que leur clé, un dépôt avec un remote sur chacun, et deux profils désignés par leurs
// règles. Fetch et « Pousser vers tous les remotes » doivent présenter à chaque serveur la clé
// du profil de son remote ; un profil choisi à la main pour un remote change la clé présentée.
//
// Les remotes passent par des alias du ~/.ssh/config de test (`Host serveur-entreprise`…) :
// la config ssh générée par GitGR doit donc bien inclure celle de l'utilisateur.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, launchApp, test } from "./app";
import { msys, sshdAvailable, startServer, useSsh } from "./sshd";

test.skip(!sshdAvailable, "sshd de Git pour Windows introuvable");

const tool = (page: Page, name: string) => page.locator(".tools").getByRole("button", { name: new RegExp(`^${name}`) });
const menu = (page: Page) => page.getByRole("menu");
/** En-tête de la section d'un remote, dans la barre latérale. */
const remote = (page: Page, name: string) =>
  page.locator(".refs-sidebar .section-btn").filter({ has: page.locator(".section-name", { hasText: new RegExp(`^${name}$`) }) });
/** Alertes affichées, pour qu'un échec de commande apparaisse dans le message du test. */
const alerts = async (page: Page) => (await page.getByRole("alert").allTextContents()).join(" | ");

test("deux remotes, deux serveurs SSH : chaque remote prend la clé de son profil", async ({ sandbox }) => {
  const entreprise = await startServer(sandbox, "entreprise");
  const client = await startServer(sandbox, "client");
  writeFileSync(
    join(entreprise.home, ".ssh", "config"),
    [
      "Host serveur-entreprise",
      "  HostName 127.0.0.1",
      `  Port ${entreprise.port}`,
      "Host serveur-client",
      "  HostName 127.0.0.1",
      `  Port ${client.port}`,
    ].join("\n") + "\n",
  );

  // `mine` : origin sur le serveur de l'entreprise, client sur celui du client.
  const mine = sandbox.clone("mine");
  const clientBare = join(sandbox.root, "client.git");
  git(sandbox.root, "init", "-q", "--bare", "-b", "main", clientBare);
  git(mine, "remote", "add", "client", clientBare);
  git(mine, "push", "-q", "client", "main");
  useSsh(mine, "origin", `ssh://serveur-entreprise${msys(sandbox.remote)}`);
  useSsh(mine, "client", `ssh://serveur-client${msys(clientBare)}`);

  // Du nouveau sur chaque serveur, poussé sans passer par ssh.
  const other = sandbox.clone("other");
  sandbox.commit(other, "b.txt", "distant\n", "distant: b");
  git(other, "push", "-q");
  git(other, "remote", "add", "client", clientBare);
  git(other, "push", "-q", "client", "HEAD~1:refs/heads/chez-le-client");

  const profile = (id: string, name: string, sshKey: string, rule: string, color: number) => ({
    id,
    name,
    userName: "Camille",
    userEmail: `camille@${id}.fr`,
    sshKey,
    rules: [rule],
    color,
  });
  const app = await launchApp(
    sandbox,
    [mine],
    {
      profiles: [profile("entreprise", "Entreprise", entreprise.key, "serveur-entreprise", 0), profile("client", "Client", client.key, "serveur-client", 2)],
      // Profil du dépôt (identité des commits) : le client. Sa clé ne vaut pas pour origin.
      repoProfiles: { [sandbox.top(mine)]: { active: "client", allowed: ["client"] } },
    },
    { HOME: entreprise.home },
  );
  const { page } = app;
  try {
    await expect(page.locator(".status-profile")).toHaveText("Client");
    await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Entreprise");
    await expect(remote(page, "client").locator(".section-profile")).toHaveText("Client");

    // Fetch de tous les remotes : chacun avec sa clé.
    await tool(page, "Fetch").click();
    await expect
      .poll(async () => [git(mine, "log", "-1", "--format=%s", "origin/main"), git(mine, "branch", "-r", "--list", "client/chez-le-client").trim(), await alerts(page)].join(" | "), {
        timeout: 20_000,
      })
      .toBe("distant: b | client/chez-le-client | ");

    // Pousser vers tous les remotes : les deux serveurs reçoivent le commit.
    git(mine, "merge", "-q", "--ff-only", "origin/main");
    sandbox.commit(mine, "c.txt", "local\n", "local: c");
    await page.keyboard.press("F5");
    await page.getByRole("button", { name: "Pousser vers…" }).click();
    await menu(page).getByRole("menuitem", { name: "Pousser vers tous les remotes" }).click();
    await expect
      .poll(async () => [git(sandbox.remote, "log", "-1", "--format=%s", "main"), git(clientBare, "log", "-1", "--format=%s", "main"), await alerts(page)].join(" | "), { timeout: 20_000 })
      .toBe("local: c | local: c | ");
    await expect(page.getByRole("status").filter({ hasText: "main poussée vers origin, client." })).toBeVisible();
    // L'auteur du commit reste celui du profil du dépôt… vérifié sur un commit fait dans l'app
    // par profiles.spec.ts ; ici, seule la clé change selon le remote.

    // Profil choisi à la main pour le remote du client : la clé de l'entreprise y est refusée.
    await remote(page, "client").click({ button: "right" });
    await expect(menu(page).getByRole("menuitemradio", { name: "Profil automatique (Client)" })).toHaveAttribute("aria-checked", "true");
    await menu(page).getByRole("menuitemradio", { name: /^Entreprise ·/ }).click();
    await expect(remote(page, "client").locator(".section-profile")).toHaveText("Entreprise");
    await tool(page, "Fetch").click();
    await expect(page.getByRole("alert")).toContainText("Authentification refusée");
    await page.getByRole("alert").getByRole("button", { name: "Fermer" }).click();

    // Retour au choix automatique : le fetch repasse.
    git(other, "push", "-q", "client", "HEAD:refs/heads/chez-le-client");
    await remote(page, "client").click({ button: "right" });
    await menu(page).getByRole("menuitemradio", { name: "Profil automatique (Client)" }).click();
    await tool(page, "Fetch").click();
    await expect
      .poll(async () => [git(mine, "log", "-1", "--format=%s", "client/chez-le-client"), await alerts(page)].join(" | "), { timeout: 20_000 })
      .toBe("distant: b | ");
  } finally {
    await app.close();
    entreprise.stop();
    client.stop();
  }
});
