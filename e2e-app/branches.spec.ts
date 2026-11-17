// Branches et réseau dans la vraie app, sur de vrais dépôts (un remote nu et des clones).

import type { Page } from "@playwright/test";
import { expect, git, launchApp, test } from "./app";

const tool = (page: Page, name: string) => page.locator(".tools").getByRole("button", { name: new RegExp(`^${name}`) });
const banner = (page: Page) => page.locator(".autostash-banner");

test("pull avec des modifications locales qui ne gênent pas : rien n'est stashé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const other = sandbox.clone("other");
  sandbox.commit(other, "b.txt", "distant\n", "distant: b");
  git(other, "push", "-q");
  git(mine, "fetch", "-q");
  sandbox.write(mine, "a.txt", "1\n2\n3\n4\nlocal\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await expect(tool(page, "Pull")).toContainText("1");
    await tool(page, "Pull").click();
    await expect(tool(page, "Pull").locator(".badge")).toHaveCount(0);
    expect(git(mine, "log", "-1", "--format=%s")).toBe("distant: b");
    expect(git(mine, "status", "--porcelain")).toBe(" M a.txt");
    expect(git(mine, "stash", "list")).toBe("");
  } finally {
    await app.close();
  }
});

test("pull déjà à jour en mode rebase, copie sale : aucun stash", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.write(mine, "a.txt", "modifié\n");
  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("button", { name: "Mode du pull" }).click();
    await page.getByRole("menuitemradio", { name: "Rebase" }).click();
    await tool(page, "Pull").click();
    await expect(tool(page, "Pull")).not.toHaveClass(/running/);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(git(mine, "stash", "list")).toBe("");
    expect(git(mine, "status", "--porcelain")).toBe(" M a.txt");
  } finally {
    await app.close();
  }
});

test("checkout qui exige un stash : réappliqué ; en conflit, gardé et signalé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "switch", "-q", "-c", "feature");
  sandbox.commit(mine, "a.txt", "un\n2\n3\n4\n5\n", "feature: ligne 1");
  git(mine, "switch", "-q", "main");
  sandbox.write(mine, "a.txt", "1\n2\n3\n4\ncinq\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
    await locals.getByRole("button", { name: /^feature/ }).dblclick();
    await expect(page.locator(".branch-chip-label")).toHaveText("feature");
    // Modification gardée, combinée avec celle de la branche : pas de conflit, stash vidé.
    expect(git(mine, "diff")).toContain("+cinq");
    expect(git(mine, "stash", "list")).toBe("");

    // Retour sur main avec une modification en conflit sur la ligne 1.
    sandbox.write(mine, "a.txt", "UN\n2\n3\n4\ncinq\n");
    await locals.getByRole("button", { name: /^main/ }).dblclick();
    await expect(page.locator(".branch-chip-label")).toHaveText("main");
    await expect(page.getByRole("status").filter({ hasText: "GitGR-autostash: feature" }).first()).toBeVisible();
    expect(git(mine, "stash", "list")).toContain("GitGR-autostash: feature");
  } finally {
    await app.close();
  }
});

test("un auto-stash laissé en plan (app interrompue) est proposé au démarrage", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.write(mine, "a.txt", "travail en cours\n");
  git(mine, "stash", "push", "-q", "-u", "-m", "GitGR-autostash: main");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await expect(banner(page)).toContainText("GitGR-autostash: main");
    await banner(page).getByRole("button", { name: "Réappliquer" }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(git(mine, "stash", "list")).toBe("");
    expect(git(mine, "status", "--porcelain")).toBe(" M a.txt");
    await expect(page.getByRole("complementary", { name: "Modifications en cours" })).toContainText("a.txt");
  } finally {
    await app.close();
  }
});

test("push d'une nouvelle branche : créée sur origin et suivie", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "switch", "-q", "-c", "nouvelle");
  sandbox.commit(mine, "n.txt", "n\n", "nouvelle branche");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await tool(page, "Push").click();
    await expect(page.getByRole("status").filter({ hasText: "nouvelle poussée." })).toBeVisible();
    expect(git(mine, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/nouvelle");
    await expect(page.locator(".statusbar")).toContainText("↑0 ↓0");
  } finally {
    await app.close();
  }
});
