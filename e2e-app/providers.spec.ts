// Comptes providers dans la vraie app : le token est vérifié auprès de l'instance (ici un faux
// GitLab local), rangé dans le trousseau du système — jamais dans state.json —, relu pour
// vérifier le compte, puis oublié à la déconnexion.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

const TOKEN = "glpat-test-0123456789";
const KEYGEN = "C:/Program Files/Git/usr/bin/ssh-keygen.exe";
/** Image PNG de 1×1 pixel (avatar du faux GitLab). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

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
    await page.getByRole("button", { name: "Profils et comptes" }).click();
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
    // Token retiré du trousseau à la fin du test, même interrompu (`Sandbox.dispose`).
    await app.close();
    gitlab.server.close();
  }
});

/** Faux GitLab qui garde les clés SSH du compte : `GET/POST /api/v4/user/keys`. */
async function fakeGitlabWithKeys() {
  const requests: string[] = [];
  const keys: { key: string; usage_type: string; title: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "401 Unauthorized" });
      // Avatar d'un groupe : chemin relatif à l'instance, image servie avec le token.
      if (req.url === "/uploads/groupe.png") {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(PNG);
      }
      if (req.url === "/api/v4/user") return json(200, { id: 7, username: "camille", name: "Camille Boulot" });
      if (req.url === "/api/v4/namespaces/groupe") return json(200, { full_path: "groupe", avatar_url: "/uploads/groupe.png" });
      if (req.url?.startsWith("/api/v4/user/keys") && req.method === "GET") return json(200, keys);
      if (req.url === "/api/v4/user/keys" && req.method === "POST") {
        const k = JSON.parse(body);
        keys.push({ key: k.key, usage_type: k.usage_type, title: k.title });
        return json(201, { id: keys.length, ...k });
      }
      json(404, { message: "404 Not Found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, keys };
}

test("ajouter la clé SSH du profil au compte GitLab ; avatar du groupe devant le remote", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const gitlab = await fakeGitlabWithKeys();
  git(mine, "remote", "add", "gitlab", `${gitlab.url}/groupe/projet.git`);
  const key = join(sandbox.root, "profil_ed25519");
  execFileSync(existsSync(KEYGEN) ? KEYGEN : "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "camille@boulot", "-f", key], { stdio: "ignore" });
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  const app = await launchApp(sandbox, [mine], {
    profiles: [{ ...boulot, sshKey: key, signing: "ssh" }],
    repoProfiles: { [sandbox.top(mine)]: { active: "boulot", allowed: ["boulot"] } },
  });
  const { page } = app;
  const accounts = page.getByRole("region", { name: "Comptes GitHub / GitLab" });
  try {
    await page.getByRole("button", { name: "Profils et comptes" }).click();
    await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
    const dialog = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });
    await dialog.getByRole("radio", { name: "GitLab" }).click();
    await dialog.getByLabel("Instance").fill(gitlab.url);
    await dialog.getByLabel("Token personnel").fill(TOKEN);
    await dialog.getByRole("button", { name: "Connecter", exact: true }).click();
    await expect(dialog).toBeHidden();

    const keys = page.getByRole("list", { name: "Clés du profil sur le compte camille" });
    const auth = keys.getByRole("listitem").filter({ hasText: /^.*Clé SSH(?! de)/ }).first();
    await expect(keys.getByRole("listitem")).toHaveCount(2);
    await expect(keys).not.toContainText("sur le compte");
    await auth.getByRole("button", { name: "Ajouter au compte" }).click();

    // Même clé pour les deux usages : envoyée une fois, `auth_and_signing`, puis vue présente
    // pour les deux.
    await expect(keys.getByText("sur le compte")).toHaveCount(2);
    expect(gitlab.keys).toHaveLength(1);
    expect(gitlab.keys[0].key).toBe(publicKey);
    expect(gitlab.keys[0].usage_type).toBe("auth_and_signing");
    expect(gitlab.keys[0].title).toMatch(/^GitGR · Boulot/);

    // Dans le dépôt : l'avatar du groupe devant le remote, lu avec le token du compte.
    await page.getByRole("button", { name: "Fermer les profils" }).click();
    const remote = page.locator(".refs-sidebar .section-btn").filter({ has: page.locator(".section-name", { hasText: /^gitlab$/ }) });
    await expect(remote.locator(".remote-avatar")).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(gitlab.requests).toContain("GET /api/v4/namespaces/groupe");
    expect(gitlab.requests).toContain("GET /uploads/groupe.png");
  } finally {
    // Token retiré du trousseau à la fin du test, même interrompu (`Sandbox.dispose`).
    await app.close();
    gitlab.server.close();
  }
});

/** Faux GitLab pour les merge requests : compte, projet `groupe/projet` (branche par défaut
 *  `main`) et création d'une MR. Garde les corps des MR reçues. */
async function fakeGitlabWithMergeRequests() {
  const requests: string[] = [];
  const created: Record<string, unknown>[] = [];
  const notes: string[] = [];
  /** Commit de tête de la MR créée (posé par le test). */
  const state = { head: "" };
  const mr = () => ({
    iid: 5,
    title: (created[0]?.title as string) ?? "",
    web_url: `http://gitlab/groupe/projet/-/merge_requests/5`,
    state: "opened",
    draft: false,
    author: { id: 7, username: "camille", name: "Camille Boulot", state: "active" },
    source_branch: "feature/mr",
    target_branch: "main",
    source_project_id: 42,
    target_project_id: 42,
    sha: state.head,
    created_at: "2026-11-17T09:30:00Z",
    updated_at: "2026-11-17T09:30:00Z",
    detailed_merge_status: "mergeable",
    user: { can_merge: true },
    description: (created[0]?.description as string) ?? "",
    reviewers: [{ id: 8, username: "max", name: "Max Relecteur", state: "active" }],
    assignees: [],
    labels: [],
  });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "401 Unauthorized" });
      if (req.url === "/api/v4/user") return json(200, { id: 7, username: "camille", name: "Camille Boulot" });
      if (req.url === "/api/v4/projects/groupe%2Fprojet") return json(200, { id: 42, default_branch: "main" });
      // Deux pages de membres (annoncées par X-Total-Pages), une d'étiquettes.
      if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/members/all?per_page=100&page=")) {
        const page = Number(req.url.split("page=").pop());
        res.setHeader("X-Total-Pages", "2");
        return json(200, page === 1 ? [{ id: 7, username: "camille", name: "Camille Boulot", state: "active" }] : [{ id: 8, username: "max", name: "Max Relecteur", state: "active" }]);
      }
      if (req.url === "/api/v4/projects/groupe%2Fprojet/labels?per_page=100&page=1") return json(200, [{ name: "bug", color: "#d73a4a" }]);
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests" && req.method === "POST") {
        created.push(JSON.parse(body));
        return json(201, { iid: 5, web_url: `http://gitlab/groupe/projet/-/merge_requests/5`, title: JSON.parse(body).title });
      }
      // Suivi : liste des MR ouvertes, détail, discussions, commentaire.
      if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/merge_requests?state=opened")) return json(200, created.length ? [mr()] : []);
      if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/pipelines?")) return json(200, []);
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests/5?with_labels_details=true") return json(200, mr());
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests/5/reviewers") return json(200, []);
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests/5/approvals") return json(200, { approved_by: [] });
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests/5/discussions?per_page=100")
        return json(
          200,
          notes.map((n, i) => ({ id: `d${i}`, individual_note: true, notes: [{ id: i, body: n, system: false, author: { id: 7, username: "camille" }, created_at: "2026-11-17T10:00:00Z" }] })),
        );
      if (req.url === "/api/v4/projects/groupe%2Fprojet/merge_requests/5/notes" && req.method === "POST") {
        notes.push(JSON.parse(body).body);
        return json(201, { id: notes.length });
      }      json(404, { message: "404 Not Found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, created, notes, state };
}

test("créer une merge request de la branche courante : cible par défaut lue sur l'instance, texte tiré du commit", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const gitlab = await fakeGitlabWithMergeRequests();
  // Remote GitLab « déjà à jour » : ses branches distantes sont posées à la main (le faux
  // serveur ne parle pas le protocole git), la branche suit la sienne et n'a rien à pousser.
  git(mine, "remote", "add", "gitlab", `${gitlab.url}/groupe/projet.git`);
  git(mine, "update-ref", "refs/remotes/gitlab/main", "main");
  git(mine, "switch", "-q", "-c", "feature/mr");
  sandbox.commit(mine, "b.txt", "b\n", "Ajoute b\n\nPour la démonstration.");
  git(mine, "update-ref", "refs/remotes/gitlab/feature/mr", "HEAD");
  git(mine, "branch", "-q", "--set-upstream-to=gitlab/feature/mr");
  const app = await launchApp(sandbox, [mine], {
    profiles: [boulot],
    repoProfiles: { [sandbox.top(mine)]: { active: "boulot", allowed: ["boulot"] } },
  });
  const { page } = app;
  const accounts = page.getByRole("region", { name: "Comptes GitHub / GitLab" });
  try {
    await page.getByRole("button", { name: "Profils et comptes" }).click();
    await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
    const connect = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });
    await connect.getByRole("radio", { name: "GitLab" }).click();
    await connect.getByLabel("Instance").fill(gitlab.url);
    await connect.getByLabel("Token personnel").fill(TOKEN);
    await connect.getByRole("button", { name: "Connecter", exact: true }).click();
    await expect(connect).toBeHidden();
    await page.getByRole("button", { name: "Fermer les profils" }).click();

    const locals = page.locator(".refs-sidebar .side-group").first();
    await locals.getByRole("button", { name: /^mr( |$)/ }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Créer une merge request…" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer une merge request" });
    await expect(dialog.getByLabel("Branche cible")).toHaveValue("main");
    await expect(dialog.getByLabel("Titre")).toHaveValue("Ajoute b");
    await expect(dialog.getByLabel("Description")).toHaveValue("Pour la démonstration.");
    // Membres (deux pages) et étiquettes lus sur l'instance.
    await dialog.getByRole("combobox", { name: "Relecteurs" }).fill("max");
    await dialog.getByRole("option", { name: /max/ }).click();
    await dialog.getByRole("button", { name: "M’assigner" }).click();
    await dialog.getByRole("combobox", { name: "Étiquettes" }).fill("bug");
    await dialog.getByRole("option", { name: /bug/ }).click();
    await dialog.getByRole("button", { name: "Créer la merge request" }).click();

    // Fenêtre fermée, MR annoncée ; « Voir » l'ouvre dans GitGR (liste relue sur l'instance).
    const done = page.locator(".toast", { hasText: "Merge request !5 créée" });
    await expect(done).toBeVisible();
    gitlab.state.head = git(mine, "rev-parse", "HEAD").trim();
    await done.getByRole("button", { name: "Voir" }).click();
    const view = page.locator(".pull-view");
    await expect(view.locator(".pull-view-title")).toHaveText("Ajoute b");
    await expect(page.locator(".pulls-group .pull-item", { hasText: "!5" })).toBeVisible();
    await expect(page.locator(".refs-sidebar .side-pull", { hasText: "!5" }).first()).toBeVisible();
    // Fichiers : lus en local, depuis l'ancêtre commun avec gitlab/main.
    await view.getByRole("tab", { name: "Fichiers" }).click();
    await expect(view.locator(".pull-file-list .side-item")).toHaveCount(1);
    await expect(view.locator(".pull-file-list .side-item")).toContainText("b.txt");
    await view.locator(".pull-file-list .side-item").click();
    await expect(view.locator(".pull-file-diff .diff-stats")).toHaveText("+1−0");
    // Commentaire envoyé sur l'instance, puis relu.
    await view.getByRole("tab", { name: "Discussion" }).click();
    await view.getByRole("textbox", { name: "Commenter" }).fill("Prête pour relecture");
    await view.getByRole("button", { name: "Commenter" }).click();
    await expect.poll(() => gitlab.notes).toEqual(["Prête pour relecture"]);
    await expect(view.locator(".pull-thread")).toContainText("Prête pour relecture");
    await expect(view.getByRole("textbox", { name: "Commenter" })).toHaveValue("");
    expect(gitlab.created).toEqual([
      { source_branch: "feature/mr", target_branch: "main", title: "Ajoute b", description: "Pour la démonstration.", assignee_ids: [7], reviewer_ids: [8], labels: "bug" },
    ]);
    // Gardés en cache sur disque pour les prochaines fois (et les autres dépôts du groupe).
    const cacheDir = join(sandbox.root, "config", "pull-options");
    const cached = readdirSync(cacheDir).map((f) => JSON.parse(readFileSync(join(cacheDir, f), "utf8")));
    expect(cached).toHaveLength(1);
    expect(cached[0].repo).toBe("groupe/projet");
    expect(cached[0].options.people.map((p: { login: string }) => p.login)).toEqual(["camille", "max"]);
    expect(JSON.stringify(cached)).not.toContain(TOKEN);
    expect(gitlab.requests).toContain("GET /api/v4/projects/groupe%2Fprojet");
  } finally {
    // Token retiré du trousseau à la fin du test, même interrompu (`Sandbox.dispose`).
    await app.close();
    gitlab.server.close();
  }
});
