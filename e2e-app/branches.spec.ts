// Branches et réseau dans la vraie app, sur de vrais dépôts (un remote nu et des clones).

import type { Page } from "@playwright/test";
import { expect, git, launchApp, test } from "./app";

/** Bouton de la barre d'outils, avec son badge cliquable quand il en a un (enveloppe `.tool-badged`). */
const tool = (page: Page, name: string) =>
  page
    .locator(".tools")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator("xpath=(ancestor::*[contains(concat(' ', @class, ' '), ' tool-badged ')] | .)[1]");
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
    await locals.getByRole("treeitem", { name: /^feature/ }).dblclick();
    await expect(page.locator(".branch-chip-label")).toHaveText("feature");
    // La pastille change dès le checkout ; le stash est réappliqué ensuite : attendre la fin
    // de la commande (annonce vide) avant de lire le dépôt.
    await expect(page.locator(".tools > [role=status]")).toHaveText("");
    // Modification gardée, combinée avec celle de la branche : pas de conflit, stash vidé.
    expect(git(mine, "diff")).toContain("+cinq");
    expect(git(mine, "stash", "list")).toBe("");

    // Retour sur main avec une modification en conflit sur la ligne 1.
    sandbox.write(mine, "a.txt", "UN\n2\n3\n4\ncinq\n");
    await locals.getByRole("treeitem", { name: /^main/ }).dblclick();
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
    await expect(page.locator(".statusbar").getByRole("button", { name: "0 commit à pousser" })).toHaveText("↑0");
  } finally {
    await app.close();
  }
});

test("double-clic sur une distante dont la locale existe : checkout puis pull", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const other = sandbox.clone("other");
  // `feature` existe en local, suivie, et la distante a un commit de plus.
  git(other, "switch", "-q", "-c", "feature");
  git(other, "push", "-q", "-u", "origin", "feature");
  git(mine, "fetch", "-q");
  git(mine, "branch", "-q", "--track", "feature", "origin/feature");
  sandbox.commit(other, "f.txt", "f\n", "distant: feature");
  git(other, "push", "-q");
  git(mine, "fetch", "-q");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const origin = page
      .getByRole("navigation", { name: "Branches et tags" })
      .locator(".side-group")
      .filter({ has: page.locator(".section-name", { hasText: /^origin$/ }) });
    await origin.getByRole("treeitem", { name: /^feature/ }).dblclick();
    await expect(page.locator(".branch-chip-label")).toHaveText("feature");
    await expect(tool(page, "Pull").locator(".badge")).toHaveCount(0);
    expect(git(mine, "log", "-1", "--format=%s")).toBe("distant: feature");
    expect(git(mine, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/feature");
  } finally {
    await app.close();
  }
});

test("badges ↑ / ↓ : ce qui part au push et ce qui arrive au pull, avec le diff cumulé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const other = sandbox.clone("other");
  sandbox.commit(other, "b.txt", "distant\n", "distant: b");
  git(other, "push", "-q");
  git(mine, "fetch", "-q");
  sandbox.commit(mine, "c.txt", "local\n", "local: c");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("button", { name: "Voir le commit qui arrive au pull" }).click();
    const pull = page.getByRole("region", { name: "Ce qui arrive au pull" });
    await expect(pull.locator(".pull-view-title")).toHaveText("1 commit à tirer de origin/main");
    await expect(pull.locator(".range-commit:not(.range-all)")).toContainText("distant: b");
    await expect(pull.locator(".file-row")).toHaveText([/b\.txt/]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Voir le commit qui part au push" }).click();
    const push = page.getByRole("region", { name: "Ce qui part au push" });
    await expect(push.locator(".range-commit:not(.range-all)")).toContainText("local: c");
    await expect(push.locator(".file-row")).toHaveText([/c\.txt/]);
    await push.locator(".file-row").click();
    await expect(push.locator(".diff-body tr.add")).toHaveCount(1);
    // Le commit choisi : ses propres fichiers et son diff.
    await push.locator(".range-commit:not(.range-all)").click();
    await expect(push.locator(".section-h").nth(1)).toContainText(/1 fichier dans [0-9a-f]{7}/);
    await expect(push.locator(".diff-body tr.add")).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("menu d'une autre branche : pull sans checkout, push, merge et rebase", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const other = sandbox.clone("other");
  // Le distant avance sur main ; ici, on travaille sur une autre branche.
  sandbox.commit(other, "b.txt", "distant\n", "distant: b");
  git(other, "push", "-q");
  git(mine, "fetch", "-q");
  git(mine, "switch", "-q", "-c", "travail");
  sandbox.commit(mine, "t.txt", "t\n", "travail: t");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
    const menu = page.getByRole("menu").first();

    await locals.getByRole("treeitem", { name: /^main/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Pull (avance rapide)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "main mise à jour." })).toBeVisible();
    expect(git(mine, "log", "-1", "--format=%s", "main")).toBe("distant: b");
    expect(git(mine, "branch", "--show-current")).toBe("travail");

    // Rebase de la courante sur main : t.txt rejoué après « distant: b ».
    await locals.getByRole("treeitem", { name: /^main/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Rebase de travail dessus" }).click();
    await expect(page.getByRole("status").filter({ hasText: "travail rebasée sur main." })).toBeVisible();
    expect(git(mine, "log", "-1", "--format=%s", "HEAD~1")).toBe("distant: b");

    // Push de travail sans y être : suivie sur origin.
    git(mine, "switch", "-q", "main");
    // Le menu lit les refs de la barre latérale : attendre qu'elle soit relue.
    await expect(locals.getByRole("treeitem", { name: /^main/ })).toHaveClass(/current/);
    await locals.getByRole("treeitem", { name: /^travail/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Push", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "travail poussée." })).toBeVisible();
    expect(git(mine, "rev-parse", "--abbrev-ref", "travail@{u}")).toBe("origin/travail");

    // Merge de travail dans main : avance rapide.
    await locals.getByRole("treeitem", { name: /^travail/ }).click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Merge dans main" }).click();
    await expect(page.getByRole("status").filter({ hasText: "travail fusionnée dans main." })).toBeVisible();
    expect(git(mine, "rev-parse", "main")).toBe(git(mine, "rev-parse", "travail"));
  } finally {
    await app.close();
  }
});

test("glisser un commit sur une autre branche : checkout puis cherry-pick", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "branch", "cible");
  sandbox.commit(mine, "c.txt", "c\n", "à reprendre");
  const sha = git(mine, "rev-parse", "HEAD");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
    const target = locals.getByRole("treeitem", { name: /^cible/ });
    const row = page.locator(`#commit-${sha}`);
    const from = (await row.locator(".commit-msg").boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole("menu").first().getByRole("menuitem", { name: `Cherry-pick de ${sha.slice(0, 7)} sur cible (checkout de cible d’abord)` }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cherry-pick sur cible terminé." })).toBeVisible();
    expect(git(mine, "branch", "--show-current")).toBe("cible");
    expect(git(mine, "log", "-1", "--format=%s")).toBe("à reprendre");
  } finally {
    await app.close();
  }
});

test("Ctrl+Z annule un commit (modifications indexées) puis un merge ; Ctrl+Y rétablit", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "switch", "-q", "-c", "feature");
  sandbox.commit(mine, "f.txt", "f\n", "feature: f");
  git(mine, "switch", "-q", "main");
  const start = git(mine, "rev-parse", "HEAD");
  sandbox.write(mine, "n.txt", "nouveau\n");
  git(mine, "add", "n.txt");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByPlaceholder("Résumé").fill("ajout de n");
    await page.getByRole("button", { name: /^Commiter/ }).click();
    await expect.poll(() => git(mine, "log", "-1", "--format=%s")).toBe("ajout de n");
    const committed = git(mine, "rev-parse", "HEAD");

    const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
    await locals.getByRole("treeitem", { name: /^feature/ }).click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Merge dans main" }).click();
    await expect(page.getByRole("status").filter({ hasText: "feature fusionnée dans main." })).toBeVisible();

    // Annuler le merge, puis le commit : n.txt revient indexé.
    await page.locator("body").press("Control+z");
    await expect(page.getByRole("status").filter({ hasText: "Annulé : merge." })).toBeVisible();
    expect(git(mine, "rev-parse", "HEAD")).toBe(committed);
    await page.locator("body").press("Control+z");
    await expect(page.getByRole("status").filter({ hasText: "Annulé : commit." })).toBeVisible();
    expect(git(mine, "rev-parse", "HEAD")).toBe(start);
    expect(git(mine, "status", "--porcelain")).toBe("A  n.txt");

    // Rétablir le commit.
    await page.locator("body").press("Control+y");
    await expect(page.getByRole("status").filter({ hasText: "Rétabli : commit." })).toBeVisible();
    expect(git(mine, "rev-parse", "HEAD")).toBe(committed);
    expect(git(mine, "status", "--porcelain")).toBe("");

    // Le dépôt change hors de GitGR : plus rien à rétablir de fiable.
    sandbox.commit(mine, "x.txt", "x\n", "ailleurs");
    await page.locator("body").press("Control+y");
    await expect(page.getByRole("alert")).toContainText("Le dépôt a changé depuis cette opération");
    expect(git(mine, "log", "-1", "--format=%s")).toBe("ailleurs");
  } finally {
    await app.close();
  }
});

test("branches récentes : lues dans le reflog de HEAD, checkout depuis le menu", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "switch", "-q", "-c", "a");
  git(mine, "switch", "-q", "-c", "b");
  git(mine, "switch", "-q", "main");
  git(mine, "branch", "-q", "-D", "a");
  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await expect(page.locator(".branch-chip-label")).toHaveText("main");
    await page.keyboard.press("Control+Shift+O");
    const menu = page.getByRole("menu");
    // `a` supprimée n'est plus proposée ; `main` (courante) non plus.
    await expect(menu.getByRole("menuitem")).toHaveText(["b"]);
    await page.keyboard.press("Enter");
    await expect(page.locator(".branch-chip-label")).toHaveText("b");
    expect(git(mine, "branch", "--show-current")).toBe("b");
  } finally {
    await app.close();
  }
});
