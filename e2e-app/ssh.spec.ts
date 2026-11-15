// Clé SSH protégée par une phrase de passe, de bout en bout : un vrai serveur SSH local (le
// sshd de Git pour Windows), une clé du profil protégée, la phrase de passe saisie dans l'app
// (trousseau de Windows), puis fetch et push par ssh — ssh obtient la phrase de passe en
// relançant GitGR en mode askpass.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, launchApp, test, type Sandbox } from "./app";

const SSHD = "C:/Program Files/Git/usr/bin/sshd.exe";
const KEYGEN = "C:/Program Files/Git/usr/bin/ssh-keygen.exe";
// Côté serveur (shell de Git pour Windows) : chemins msys, sans espace.
const UPLOAD_PACK = "/mingw64/bin/git-upload-pack";
const RECEIVE_PACK = "/mingw64/bin/git-receive-pack";
const PASSPHRASE = "une phrase de passe";

test.skip(!existsSync(SSHD), "sshd de Git pour Windows introuvable");

/** `C:\x\y` → `/c/x/y` (chemins vus par le sshd de Git pour Windows). */
const msys = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);

function keygen(...args: string[]) {
  execFileSync(KEYGEN, ["-q", ...args], { stdio: "ignore" });
}

interface Server {
  port: number;
  /** Clé privée protégée, autorisée par le serveur. */
  key: string;
  /** Dossier personnel pour l'app (known_hosts du serveur, sans toucher au vrai ~/.ssh). */
  home: string;
  stop(): void;
}

async function startServer(sandbox: Sandbox): Promise<Server> {
  const dir = join(sandbox.root, "sshd");
  const home = join(sandbox.root, "home");
  mkdirSync(dir);
  mkdirSync(join(home, ".ssh"), { recursive: true });
  const key = join(dir, "profil_ed25519");
  keygen("-t", "ed25519", "-N", "", "-f", join(dir, "hostkey"));
  keygen("-t", "ed25519", "-N", PASSPHRASE, "-C", "profil", "-f", key);
  writeFileSync(join(dir, "authorized_keys"), readFileSync(`${key}.pub`));
  const port = 23000 + Math.floor(Math.random() * 2000);
  writeFileSync(
    join(dir, "sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${msys(join(dir, "hostkey"))}`,
      `AuthorizedKeysFile ${msys(join(dir, "authorized_keys"))}`,
      "StrictModes no",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      `PidFile ${msys(join(dir, "sshd.pid"))}`,
    ].join("\n") + "\n",
  );
  const hostPub = readFileSync(join(dir, "hostkey.pub"), "utf8").trim().split(" ").slice(0, 2).join(" ");
  writeFileSync(join(home, ".ssh", "known_hosts"), `[127.0.0.1]:${port} ${hostPub}\n`);

  const proc: ChildProcess = spawn(SSHD, ["-D", "-e", "-f", msys(join(dir, "sshd_config"))], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stderr?.on("data", (d: Buffer) => (log += d.toString()));
  await expect.poll(() => log, { timeout: 10_000 }).toContain("Server listening");
  return { port, key, home, stop: () => proc.kill() };
}

/** Clone dont `origin` passe par le serveur SSH local. */
function sshClone(sandbox: Sandbox, server: Server, name: string): string {
  const dir = sandbox.clone(name);
  git(dir, "remote", "set-url", "origin", `ssh://127.0.0.1:${server.port}${msys(sandbox.remote)}`);
  git(dir, "config", "remote.origin.uploadpack", UPLOAD_PACK);
  git(dir, "config", "remote.origin.receivepack", RECEIVE_PACK);
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

const tool = (page: Page, name: string) => page.locator(".tools").getByRole("button", { name: new RegExp(`^${name}`) });

test("clé protégée : phrase de passe saisie dans l'app, puis fetch et push par ssh", async ({ sandbox }) => {
  const server = await startServer(sandbox);
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
