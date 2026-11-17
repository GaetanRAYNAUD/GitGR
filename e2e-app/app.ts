// Lance la vraie app GitGR (binaire de debug) et la pilote avec Playwright via CDP.
//
// - Config isolée (`GITGR_CONFIG_DIR`) et profil WebView2 isolé : jamais le state.json ni les
//   dépôts de l'utilisateur.
// - Dépôts de test créés dans un dossier temporaire (un remote nu, des clones), ouverts en
//   onglets au démarrage via le state.json pré-rempli.
// - WebView2 expose CDP sur le port donné par `GITGR_DEVTOOLS_PORT` (build de debug seulement).

import { test as base, chromium, expect, type Browser, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXE = join(ROOT, "src-tauri", "target", "debug", process.platform === "win32" ? "gitgr.exe" : "gitgr");
/** Un port CDP par lancement : une app qui se termine encore ne peut pas répondre à la place. */
let nextPort = 9333;

/** `git` dans `cwd` ; renvoie stdout sans les blancs de fin. Le remote nu des tests est lu
 *  depuis son dossier : accepté même si l'utilisateur a réglé `safe.bareRepository = explicit`. */
export function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.bareRepository", GIT_CONFIG_VALUE_0: "all" };
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

/** Clone configuré pour les tests (identité, pas de signature, pas de conversion de fins de ligne). */
function configure(dir: string, name: string) {
  for (const [k, v] of [
    ["user.name", name],
    ["user.email", `${name.toLowerCase()}@exemple.fr`],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
  ])
    git(dir, "config", k, v);
}

export class Sandbox {
  readonly root = mkdtempSync(join(tmpdir(), "gitgr-app-"));
  readonly remote = join(this.root, "remote.git");

  constructor() {
    git(this.root, "init", "-q", "--bare", "-b", "main", this.remote);
  }

  /** Nouveau clone du remote (le premier pousse un commit initial). */
  clone(name: string): string {
    const dir = join(this.root, name);
    git(this.root, "clone", "-q", "-c", "core.autocrlf=false", this.remote, dir);
    configure(dir, name);
    if (!git(dir, "branch", "-r")) {
      this.commit(dir, "a.txt", "1\n2\n3\n4\n5\n", "init");
      git(dir, "push", "-q", "-u", "origin", "main");
    }
    return dir;
  }

  write(dir: string, file: string, content: string) {
    writeFileSync(join(dir, file), content);
  }

  commit(dir: string, file: string, content: string, message: string) {
    this.write(dir, file, content);
    git(dir, "add", file);
    git(dir, "commit", "-q", "-m", message);
  }

  /** Chemin tel que git le renvoie (et que l'app utilise comme identifiant). */
  top(dir: string): string {
    return git(dir, "rev-parse", "--show-toplevel");
  }

  dispose() {
    forgetSandboxTokens(join(this.root, "config", "state.json"));
    // Les processus WebView2 peuvent garder leur profil ouvert un instant après l'arrêt de
    // l'app : nettoyage au mieux (le dossier temporaire sera vidé par le système sinon).
    try {
      rmSync(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      /* ignoré */
    }
  }
}

/** Le trousseau du système n'est pas isolé comme la config : un compte connecté pendant un test
 *  y laisse son token si le test s'arrête avant de le déconnecter. À la fin de chaque test, les
 *  tokens des comptes du state.json du bac à sable sont retirés (Windows : entrée
 *  `token:<compte>.fr.gitgr.app` du gestionnaire d'identifiants, cf. src-tauri/src/secrets.rs). */
function forgetSandboxTokens(stateFile: string) {
  if (process.platform !== "win32" || !existsSync(stateFile)) return;
  let ids: string[] = [];
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    ids = (state.profiles ?? []).flatMap((p: { accounts?: { id: string }[] }) => (p.accounts ?? []).map((a) => a.id));
  } catch {
    return;
  }
  for (const id of new Set(ids)) {
    try {
      execFileSync("cmdkey", [`/delete:LegacyGeneric:target=token:${id}.fr.gitgr.app`], { stdio: "ignore" });
    } catch {
      /* déjà absent */
    }
  }
}

/** État de la machine quand l'app ne répond pas en CDP : processus WebView2, profil créé ou
 *  non, session Windows (une session sans bureau empêche WebView2 de démarrer). */
function diagnose(sandbox: Sandbox): string {
  const run = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch (e) {
      return `(échec : ${(e as Error).message.split("\n")[0]})`;
    }
  };
  const profile = join(sandbox.root, "webview2");
  return [
    "--- diagnostic ---",
    `processus WebView2 : ${run("tasklist", ["/FI", "IMAGENAME eq msedgewebview2.exe", "/NH"])}`,
    `processus gitgr : ${run("tasklist", ["/FI", "IMAGENAME eq gitgr.exe", "/NH"])}`,
    `profil WebView2 : ${existsSync(profile) ? readdirSync(profile).join(", ") || "(vide)" : "(absent)"}`,
    `session : ${run("powershell", ["-NoProfile", "-Command", "[System.Diagnostics.Process]::GetCurrentProcess().SessionId; [Environment]::UserInteractive"])}`,
    // Le port demandé a-t-il atteint le processus principal de WebView2 ?
    `lignes de commande WebView2 : ${run("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine }",
    ])}`,
    `ports en écoute de WebView2 : ${run("powershell", [
      "-NoProfile",
      "-Command",
      "$ids = (Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Id; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess } | ForEach-Object { \"$($_.LocalAddress):$($_.LocalPort)\" }",
    ])}`,
    `DevToolsActivePort : ${run("powershell", ["-NoProfile", "-Command", `Get-Content -ErrorAction SilentlyContinue '${join(profile, "EBWebView", "DevToolsActivePort")}'`]) || "(absent)"}`,
    `stratégies Edge / WebView2 : ${run("reg", ["query", "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge", "/s"])}`,
  ].join("\n");
}

export interface App {
  page: Page;
  /** Arrête l'app (fin de test, ou pour la relancer). */
  close(): Promise<void>;
  /** Fin du processus (fermeture par l'app elle-même : bouton de fermeture…). */
  exited: Promise<void>;
}

/** Lance l'app avec ces dépôts ouverts en onglets (le dernier actif). `extra` : champs ajoutés
 *  au state.json (profils…), avec les chemins des dépôts tels que l'app les connaît (`top`). */
export async function launchApp(
  sandbox: Sandbox,
  repos: string[],
  extra: Record<string, unknown> = {},
  /** Variables d'environnement en plus pour l'app (HOME de test pour ssh…). */
  env: Record<string, string> = {},
): Promise<App> {
  if (!existsSync(EXE)) throw new Error(`Binaire absent : ${EXE} (lancer « npm run test:app »)`);
  const config = join(sandbox.root, "config");
  mkdirSync(config, { recursive: true });
  const tops = repos.map((r) => sandbox.top(r));
  const state = {
    repos: tops.map((path, i) => ({ path, name: path.split("/").pop(), lastOpened: i + 1 })),
    session: { openTabs: tops, active: tops[tops.length - 1] ?? null },
    // Pas de fetch automatique pendant les tests : rien ne bouge sans qu'on le demande.
    settings: { theme: "dark", language: "fr", autoFetchMinutes: 0 },
    ...extra,
  };
  writeFileSync(join(config, "state.json"), JSON.stringify(state));

  const port = nextPort++;
  const proc: ChildProcess = spawn(EXE, [], {
    env: {
      ...process.env,
      GITGR_CONFIG_DIR: config,
      WEBVIEW2_USER_DATA_FOLDER: join(sandbox.root, "webview2"),
      // Port de débogage ouvert par l'app elle-même (build de debug, cf. src-tauri/src/lib.rs).
      GITGR_DEVTOOLS_PORT: String(port),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Sortie de l'app, jointe à l'erreur si elle ne démarre pas (diagnostic en CI).
  let output = "";
  const keep = (d: Buffer) => (output = (output + d.toString()).slice(-4000));
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  const failed = (why: string) => new Error(`${why}\n--- sortie de l'app ---\n${output || "(vide)"}\n${diagnose(sandbox)}`);

  let browser: Browser | undefined;
  // Premier démarrage de WebView2 lent sur une machine froide (CI).
  const deadline = Date.now() + (process.env.CI ? 90_000 : 30_000);
  while (!browser) {
    if (proc.exitCode !== null) throw failed(`L'app s'est arrêtée au démarrage (code ${proc.exitCode})`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (e) {
      if (Date.now() > deadline) {
        // Diagnostic d'abord, l'app encore en vie.
        const err = failed(`CDP injoignable sur le port ${port} : ${(e as Error).message.split("\n")[0]}`);
        proc.kill();
        throw err;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await expect(page.locator(".app")).toBeVisible();

  const exited = new Promise<void>((r) => (proc.exitCode !== null ? r() : proc.once("exit", () => r())));
  return {
    page,
    exited,
    async close() {
      await browser.close().catch(() => {});
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once("exit", r));
        proc.kill();
        await exited;
      }
    },
  };
}

/** `sandbox` : dossier de dépôts jetable, supprimé après le test. */
export const test = base.extend<{ sandbox: Sandbox }>({
  // eslint-disable-next-line no-empty-pattern
  sandbox: async ({}, use) => {
    const s = new Sandbox();
    await use(s);
    s.dispose();
  },
});

test.skip(process.platform !== "win32", "CDP n'est disponible qu'avec WebView2 (Windows)");

export { expect };
