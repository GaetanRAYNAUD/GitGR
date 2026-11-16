// Clone de bout en bout sur l'app compilée : par chemin local, puis par ssh avec la clé du profil
// proposé d'après les règles (un vrai serveur SSH qui n'accepte que cette clé).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, launchApp, test } from "./app";
import { msys, sshdAvailable, startServer, UPLOAD_PACK } from "./sshd";

const dialog = (page: Page) => page.getByRole("dialog", { name: "Cloner un dépôt" });

async function cloneByUrl(page: Page, url: string, name: string) {
  await page.getByRole("button", { name: /^Cloner/ }).click();
  const d = dialog(page);
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill(url);
  await d.getByRole("textbox", { name: "Nom du dossier" }).fill(name);
}

test("cloner un dépôt local : il s'ouvre dans un onglet, le dossier est retenu", async ({ sandbox }) => {
  sandbox.clone("seed");
  const parent = join(sandbox.root, "clones");
  mkdirSync(parent);
  const app = await launchApp(sandbox, [], { settings: { theme: "dark", language: "fr", autoFetchMinutes: 0, graphAvatarsOff: true, cloneDir: parent } });
  const { page } = app;
  try {
    await cloneByUrl(page, sandbox.remote, "copie");
    await dialog(page).getByRole("button", { name: "Cloner" }).click();
    await expect(page.getByRole("tab", { name: "copie" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
    const dest = join(parent, "copie");
    // Fins de ligne selon le core.autocrlf de la machine.
    expect(readFileSync(join(dest, "a.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("1\n2\n3\n4\n5\n");
    expect(git(dest, "remote", "get-url", "origin")).toBe(sandbox.remote);
    await expect(page.getByText("init").first()).toBeVisible();

    // Le même dossier une seconde fois : refusé, rien n'est touché.
    await page.getByRole("button", { name: "Accueil" }).click();
    await cloneByUrl(page, sandbox.remote, "copie");
    await expect(dialog(page).getByRole("textbox", { name: "Dossier de destination" })).toHaveValue(parent);
    await dialog(page).getByRole("button", { name: "Cloner" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("Le dossier de destination existe déjà et n’est pas vide.");

    // Dépôt introuvable : erreur traduite, aucun dossier laissé.
    await dialog(page).getByRole("textbox", { name: "URL du dépôt" }).fill(join(sandbox.root, "absent.git"));
    await dialog(page).getByRole("textbox", { name: "Nom du dossier" }).fill("absent");
    await dialog(page).getByRole("button", { name: "Cloner" }).click();
    await expect(dialog(page).getByRole("alert")).toBeVisible({ timeout: 20_000 });
    expect(existsSync(join(parent, "absent"))).toBe(false);
  } finally {
    await app.close();
  }
});

test("cloner par ssh avec la clé du profil proposé par les règles", async ({ sandbox }) => {
  test.skip(!sshdAvailable, "sshd de Git pour Windows introuvable");
  sandbox.clone("seed");
  const server = await startServer(sandbox, "serveur");
  writeFileSync(join(server.home, ".ssh", "config"), ["Host serveur-clone", "  HostName 127.0.0.1", `  Port ${server.port}`].join("\n") + "\n");
  const parent = join(sandbox.root, "clones");
  mkdirSync(parent);
  const profile = (id: string, name: string, sshKey: string | null, rules: string[]) => ({ id, name, userName: "Camille", userEmail: `camille@${id}.fr`, sshKey, rules, color: 0 });
  const app = await launchApp(
    sandbox,
    [],
    {
      settings: { theme: "dark", language: "fr", autoFetchMinutes: 0, graphAvatarsOff: true, cloneDir: parent },
      profiles: [profile("autre", "Autre", null, []), profile("serveur", "Serveur", server.key, ["serveur-clone"])],
    },
    // Le serveur de test sert git-upload-pack à un chemin msys.
    { HOME: server.home, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "remote.origin.uploadpack", GIT_CONFIG_VALUE_0: UPLOAD_PACK },
  );
  const { page } = app;
  try {
    await cloneByUrl(page, `ssh://serveur-clone${msys(sandbox.remote)}`, "par-ssh");
    const profilePicker = dialog(page).getByRole("button", { name: "Profil", exact: true });
    const choose = async (option: string) => {
      await profilePicker.click();
      await page.getByRole("menu").getByRole("menuitemradio", { name: option }).click();
    };
    await expect(profilePicker.locator(".picker-text")).toHaveText("Serveur (proposé)");

    // Sans profil : ssh n'a pas la clé, le serveur refuse.
    await choose("Aucun profil (configuration Git)");
    await dialog(page).getByRole("button", { name: "Cloner" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Authentification refusée", { timeout: 20_000 });
    expect(existsSync(join(parent, "par-ssh"))).toBe(false);

    // Avec le profil proposé : sa clé est présentée, le clone passe et le dépôt prend ce profil.
    await choose("Serveur (proposé)");
    await dialog(page).getByRole("button", { name: "Cloner" }).click();
    await expect(page.getByRole("tab", { name: "par-ssh" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    expect(existsSync(join(parent, "par-ssh", "a.txt"))).toBe(true);
    await expect(page.locator(".status-profile")).toHaveText("Serveur");
  } finally {
    await app.close();
    server.stop();
  }
});
