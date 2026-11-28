// Exécutions de CI dans la vraie app : pipelines lus sur un faux GitLab local avec le compte du
// profil du remote (token dans le trousseau, retiré à la fin), relance d'un échec.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, git, launchApp, test } from "./app";

const TOKEN = "glpat-test-ci-0123";

test("exécutions de CI : pipelines lus sur GitLab, échec relancé", async ({ sandbox }) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: "401 Unauthorized" });
    if (req.url === "/api/v4/user") return json(200, { id: 7, username: "camille", name: "Camille Boulot" });
    if (req.url?.startsWith("/api/v4/projects/groupe%2Fprojet/pipelines?"))
      return json(200, [
        { id: 77, status: "failed", ref: "main", sha: "a".repeat(40), source: "push", web_url: "http://gitlab/p/77", created_at: "2026-11-28T08:00:00Z", updated_at: "2026-11-28T08:01:00Z" },
        { id: 76, status: "success", ref: "main", sha: "b".repeat(40), source: "schedule", created_at: "2026-11-27T08:00:00Z" },
      ]);
    if (req.url === "/api/v4/projects/groupe%2Fprojet/pipelines/77/retry" && req.method === "POST") return json(201, {});
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

    await page.keyboard.press("Control+p");
    await page.getByRole("combobox").fill("exécutions");
    await page.keyboard.press("Enter");
    const view = page.getByRole("region", { name: "Exécutions de CI" });
    const rows = view.getByRole("listbox").getByRole("option");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("aria-label", "Pipeline #77, En échec");
    await rows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Relancer les jobs en échec" }).click();
    await expect(page.getByText("Pipeline #77 : jobs en échec relancés.")).toBeVisible();
    expect(requests).toContain("POST /api/v4/projects/groupe%2Fprojet/pipelines/77/retry");
  } finally {
    await app.close();
    server.close();
  }
});
