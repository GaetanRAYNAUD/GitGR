// Issues dans la vraie app : lues sur un faux GitLab local avec le compte du profil du remote
// (token dans le trousseau, retiré à la fin), commentaire envoyé.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, git, launchApp, test } from "./app";

const TOKEN = "glpat-test-issues-0123";

test("issues : liste lue sur GitLab, vue d'une issue, commentaire envoyé", async ({ sandbox }) => {
  const requests: string[] = [];
  const notes: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "401 Unauthorized" });
    if (req.url === "/api/v4/user") return json(200, { id: 7, username: "camille", name: "Camille Boulot" });
    if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/issues?state=opened"))
      return json(200, [{ iid: 5, title: "Lent au démarrage", state: "opened", author: { id: 8, username: "max", state: "active" }, assignees: [], labels: [], user_notes_count: 0, web_url: "http://gitlab/i/5", updated_at: "2026-11-28T08:00:00Z" }]);
    if (req.url === "/api/v4/projects/groupe%2Fprojet/issues/5?with_labels_details=true")
      return json(200, { iid: 5, title: "Lent au démarrage", state: "opened", author: { id: 8, username: "max", state: "active" }, description: "Dix secondes.", assignees: [], labels: [], user_notes_count: notes.length, web_url: "http://gitlab/i/5", created_at: "2026-11-27T08:00:00Z" });
    if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/issues/5/notes?")) return json(200, notes.map((b, k) => ({ id: k, body: b, system: false, author: { id: 7, username: "camille", state: "active" }, created_at: "2026-11-28T09:00:00Z" })));
    if (req.url === "/api/v4/projects/groupe%2Fprojet/issues/5/notes" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        notes.push(JSON.parse(body).body);
        json(201, {});
      });
      return;
    }
    json(404, { message: "404 Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mine = sandbox.clone("mine");
  git(mine, "remote", "add", "gitlab", `${url}/groupe/projet.git`);
  git(mine, "remote", "remove", "origin");
  const boulot = { id: "boulot", name: "Boulot", userName: "Camille Boulot", userEmail: "camille@boulot.fr", sshKey: null, rules: [], color: 1 };
  const app = await launchApp(sandbox, [mine], { profiles: [boulot], repoProfiles: { [sandbox.top(mine)]: { active: "boulot", allowed: ["boulot"] } } });
  const { page } = app;
  try {
    await page.getByRole("button", { name: "Profils et comptes" }).click();
    await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name: "Comptes" }).click();
    await page.getByRole("form", { name: "Comptes GitHub / GitLab" }).getByRole("button", { name: "Connecter un compte…" }).click();
    const connect = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });
    await connect.getByRole("radio", { name: "GitLab" }).click();
    await connect.getByLabel("Instance").fill(url);
    await connect.getByLabel("Token personnel").fill(TOKEN);
    await connect.getByRole("button", { name: "Connecter", exact: true }).click();
    await expect(connect).toBeHidden();
    await page.getByRole("button", { name: "Fermer les profils" }).click();

    const sidebar = page.getByRole("navigation", { name: "Branches et tags" });
    await sidebar.getByRole("treeitem", { name: /^#5/ }).click();
    const view = page.getByRole("region", { name: "Issue #5" });
    await expect(view.locator(".issue-text")).toContainText("Dix secondes.");
    await view.getByRole("textbox", { name: "Commenter" }).fill("Je regarde");
    await view.getByRole("button", { name: "Commenter" }).click();
    await expect.poll(() => notes).toEqual(["Je regarde"]);
    await expect(view.locator(".issue-comment")).toContainText("Je regarde");
  } finally {
    await app.close();
    server.close();
  }
});
