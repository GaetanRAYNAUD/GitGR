// Serveurs SSH locaux pour les tests sur l'app compilée : le sshd de Git pour Windows, une
// clé autorisée par serveur, et un dossier personnel de test (known_hosts, config ssh) pour ne
// jamais toucher au vrai ~/.ssh.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, type Sandbox } from "./app";

const SSHD = "C:/Program Files/Git/usr/bin/sshd.exe";
const KEYGEN = "C:/Program Files/Git/usr/bin/ssh-keygen.exe";
// Côté serveur (shell de Git pour Windows) : chemins msys, sans espace.
const UPLOAD_PACK = "/mingw64/bin/git-upload-pack";
const RECEIVE_PACK = "/mingw64/bin/git-receive-pack";

/** Le sshd de Git pour Windows est installé (sinon les tests SSH sont sautés). */
export const sshdAvailable = existsSync(SSHD);

/** `C:\x\y` → `/c/x/y` (chemins vus par le sshd de Git pour Windows). */
export const msys = (p: string) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);

function keygen(...args: string[]) {
  execFileSync(KEYGEN, ["-q", ...args], { stdio: "ignore" });
}

/** Un port par serveur : tirés au hasard, deux serveurs d'un même test pouvaient tomber sur le même. */
let nextPort = 23000 + Math.floor(Math.random() * 2000);

export interface Server {
  port: number;
  /** Clé privée autorisée par ce serveur (et par lui seul). */
  key: string;
  /** Dossier personnel pour l'app (known_hosts des serveurs, config ssh), commun aux serveurs
   *  d'un même bac à sable. */
  home: string;
  stop(): void;
}

/** Démarre un serveur SSH sur 127.0.0.1. `name` distingue les serveurs d'un même test ;
 *  `passphrase` protège la clé autorisée. */
export async function startServer(sandbox: Sandbox, name = "sshd", passphrase = ""): Promise<Server> {
  const dir = join(sandbox.root, name);
  const home = join(sandbox.root, "home");
  mkdirSync(dir);
  mkdirSync(join(home, ".ssh"), { recursive: true });
  const key = join(dir, "profil_ed25519");
  keygen("-t", "ed25519", "-N", "", "-f", join(dir, "hostkey"));
  keygen("-t", "ed25519", "-N", passphrase, "-C", name, "-f", key);
  writeFileSync(join(dir, "authorized_keys"), readFileSync(`${key}.pub`));
  const port = nextPort++;
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
  appendFileSync(join(home, ".ssh", "known_hosts"), `[127.0.0.1]:${port} ${hostPub}\n`);

  const proc: ChildProcess = spawn(SSHD, ["-D", "-e", "-f", msys(join(dir, "sshd_config"))], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stderr?.on("data", (d: Buffer) => (log += d.toString()));
  await expect.poll(() => log, { timeout: 10_000 }).toContain("Server listening");
  return { port, key, home, stop: () => proc.kill() };
}

/** Fait passer le remote `remote` du dépôt `dir` par ssh : `url` vers le dépôt nu `bare`. */
export function useSsh(dir: string, remote: string, url: string) {
  git(dir, "remote", "set-url", remote, url);
  git(dir, "config", `remote.${remote}.uploadpack`, UPLOAD_PACK);
  git(dir, "config", `remote.${remote}.receivepack`, RECEIVE_PACK);
}
