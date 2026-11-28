// Signature des commits dans la vraie app : GPG (trousseau jetable) et SSH (clé protégée par
// une phrase de passe, fournie à ssh-keygen par l'askpass de GitGR).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, launchApp, test, type Sandbox } from "./app";

const GIT_USR = "C:/Program Files/Git/usr/bin";
const GPG = `${GIT_USR}/gpg.exe`;
const KEYGEN = `${GIT_USR}/ssh-keygen.exe`;

/** `C:\x\y` → `/c/x/y` : le gpg de Git pour Windows ne démarre son agent qu'avec ce GNUPGHOME. */
const msys = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);

const profile = (extra: Record<string, unknown>) => ({
  id: "p",
  name: "Signe",
  userName: "Camille Signe",
  userEmail: "signe@exemple.fr",
  sshKey: null,
  rules: [],
  color: 0,
  ...extra,
});

/** Fichier indexé, puis commit depuis la zone de commit. */
async function commitFromApp(page: Page, sandbox: Sandbox, dir: string, message: string) {
  sandbox.write(dir, "signe.txt", `${message}\n`);
  git(dir, "add", "signe.txt");
  await page.keyboard.press("F5");
  await page.getByPlaceholder("Résumé").fill(message);
  await page.locator(".commit-btn").click();
  await expect.poll(() => git(dir, "log", "-1", "--format=%s"), { timeout: 20_000 }).toBe(message);
}

test("signature GPG : clé choisie dans la page du profil", async ({ sandbox }) => {
  test.skip(!existsSync(GPG), "gpg de Git pour Windows introuvable");
  const gnupg = join(sandbox.root, "gnupg");
  mkdirSync(gnupg);
  const env = { ...process.env, GNUPGHOME: msys(gnupg) };
  const gpg = (...args: string[]) => execFileSync(GPG, ["--batch", ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  gpg("--pinentry-mode", "loopback", "--passphrase", "", "--quick-gen-key", "Camille Signe <signe@exemple.fr>", "ed25519", "sign", "never");
  const keyId = gpg("--list-secret-keys", "--with-colons").split("\n").find((l) => l.startsWith("sec:"))!.split(":")[4];

  const mine = sandbox.clone("mine");
  const app = await launchApp(
    sandbox,
    [mine],
    { profiles: [profile({})], repoProfiles: { [sandbox.top(mine)]: { active: "p", allowed: ["p"] } } },
    { GNUPGHOME: msys(gnupg) },
  );
  const { page } = app;
  try {
    await page.locator(".status-profile").click();
    await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
    await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name: "Signature" }).click();
    await page.getByRole("radiogroup", { name: "Signature des commits" }).getByRole("radio", { name: "GPG" }).click();
    // La clé du trousseau est proposée (lue par l'app avec gpg).
    await page.getByLabel("Clé GPG").selectOption(keyId);
    await expect(page.locator(".pf-head-sub")).toContainText("Enregistré");
    await page.getByRole("button", { name: "Fermer les profils" }).click();

    await commitFromApp(page, sandbox, mine, "commit signé GPG");
    expect(git(mine, "cat-file", "commit", "HEAD")).toContain("-----BEGIN PGP SIGNATURE-----");
    const verify = execFileSync("git", ["verify-commit", "--raw", "HEAD"], { cwd: mine, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(verify).toBe(""); // --raw : statut sur stderr ; pas d'exception = signature valide
  } finally {
    await app.close();
    try {
      execFileSync(`${GIT_USR}/gpgconf.exe`, ["--kill", "gpg-agent"], { env, stdio: "ignore" });
    } catch {
      /* agent déjà arrêté */
    }
  }
});

test("signature SSH avec une clé protégée : phrase de passe fournie par GitGR", async ({ sandbox }) => {
  test.skip(!existsSync(KEYGEN), "ssh-keygen de Git pour Windows introuvable");
  const key = join(sandbox.root, "signe_ed25519");
  const passphrase = "phrase de signature";
  execFileSync(KEYGEN, ["-q", "-t", "ed25519", "-N", passphrase, "-C", "signe", "-f", key], { stdio: "ignore" });

  const mine = sandbox.clone("mine");
  const app = await launchApp(sandbox, [mine], {
    profiles: [profile({ sshKey: key, signing: "ssh" })],
    repoProfiles: { [sandbox.top(mine)]: { active: "p", allowed: ["p"] } },
  });
  const { page } = app;
  try {
    // Phrase de passe de la clé du profil (qui sert aussi à signer), saisie dans l'app.
    await page.locator(".status-profile").click();
    await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
    await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name: "Signature" }).click();
    await expect(page.locator(".profiles-page")).toContainText("Vide : la clé SSH du profil est utilisée.");
    await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name: "Clé SSH" }).click();
    await page.getByRole("button", { name: "Enregistrer la phrase de passe…" }).click();
    const dialog = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
    await dialog.locator("input[type=password]").fill(passphrase);
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator(".profiles-page")).toContainText("Phrase de passe dans le trousseau du système.");
    await page.getByRole("button", { name: "Fermer les profils" }).click();

    await commitFromApp(page, sandbox, mine, "commit signé SSH");
    expect(git(mine, "cat-file", "commit", "HEAD")).toContain("-----BEGIN SSH SIGNATURE-----");
    // Ses détails disent qu'il est signé (sans signataires autorisés : non vérifiable).
    await page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { name: /^commit signé SSH/ }).click();
    await expect(page.locator(".signature-line")).toContainText("Signé (SSH)");
  } finally {
    await app.close();
    try {
      execFileSync("cmdkey", [`/delete:ssh-key:${key.replace(/\\/g, "/").toLowerCase()}.fr.gitgr.app`], { stdio: "ignore" });
    } catch {
      /* déjà retirée */
    }
  }
});
