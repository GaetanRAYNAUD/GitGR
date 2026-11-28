// Release d'un tag dans la vraie app : notes tirées des vrais commits, création sur un faux
// GitLab local avec le compte du profil du remote (token dans le trousseau, retiré à la fin).

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, git, launchApp, test } from "./app";

const TOKEN = "glpat-test-release-0123";

test("release d'un tag : notes groupées par type, créée sur GitLab avec le compte du remote", async ({ sandbox }) => {
  const created: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "401 Unauthorized" });
      if (req.url === "/api/v4/user") return json(200, { id: 7, username: "camille", name: "Camille Boulot" });
      if (req.url === "/api/v4/projects/groupe%2Fprojet/releases" && req.method === "POST") {
        created.push(JSON.parse(body));
        return json(201, { _links: { self: "http://gitlab/groupe/projet/-/releases/v1.1.0" } });
      }
      json(404, { message: "404 Not Found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mine = sandbox.clone("mine");
  git(mine, "tag", "v1.0.0");
  sandbox.commit(mine, "b.txt", "b\n", "feat: ajoute b");
  sandbox.commit(mine, "c.txt", "c\n", "fix(ui): corrige c");
  git(mine, "tag", "-a", "v1.1.0", "-m", "v1.1.0");
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
    await sidebar.getByRole("treeitem", { name: /^Tags/ }).click();
    await sidebar.getByRole("treeitem", { name: /^v1\.1\.0/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Créer la release…" }).click();
    const d = page.getByRole("dialog", { name: "Release v1.1.0" });
    await expect(d).toContainText("Commits depuis v1.0.0");
    await expect(d.getByLabel("Notes (Markdown)")).toHaveValue("### Nouveautés\n\n- ajoute b\n\n### Corrections\n\n- **ui** : corrige c\n");
    // Le faux serveur ne reçoit pas de push git : le tag est « déjà » là-bas.
    await d.getByLabel("Pousser d’abord le tag v1.1.0 sur gitlab").uncheck();
    await d.getByRole("button", { name: "Créer la release" }).click();
    await expect(page.getByText("Release v1.1.0 créée.")).toBeVisible();
    expect(created).toEqual([{ tag_name: "v1.1.0", name: "v1.1.0", description: "### Nouveautés\n\n- ajoute b\n\n### Corrections\n\n- **ui** : corrige c\n" }]);
  } finally {
    await app.close();
    server.close();
  }
});
