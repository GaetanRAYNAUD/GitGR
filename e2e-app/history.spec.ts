// Sélection de plusieurs commits dans la vraie app : fichiers et diff cumulés d'une plage,
// cherry-pick du lot sur la branche courante.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("plage de commits : fichiers cumulés, diff de la plage, puis cherry-pick sur main", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "checkout", "-q", "-b", "sujet");
  sandbox.commit(mine, "b.txt", "b\n", "ajout de b");
  sandbox.commit(mine, "b.txt", "b\nb2\n", "suite de b");
  sandbox.commit(mine, "c.txt", "c\n", "ajout de c");
  git(mine, "checkout", "-q", "main");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    const panel = page.getByRole("complementary", { name: "Commits sélectionnés" });
    await graph.getByRole("option", { name: /ajout de c/ }).click();
    await graph.getByRole("option", { name: /ajout de b/ }).click({ modifiers: ["Shift"] });
    await expect(panel).toContainText("3 commits sélectionnés");
    await expect(panel).toContainText("Plage contiguë");
    await expect(panel.locator(".file-row")).toHaveCount(2);

    // Diff cumulé de b.txt : ses deux lignes ajoutées, depuis le parent du plus ancien.
    await panel.locator(".file-row", { hasText: "b.txt" }).click();
    const diff = page.getByRole("region", { name: "Diff de b.txt" });
    await expect(diff.locator("tr.add")).toHaveCount(2);
    await page.keyboard.press("Escape");

    // « ajout de b » déjà sur main : sauté ; les deux autres appliqués.
    git(mine, "cherry-pick", git(mine, "rev-parse", "sujet~2"));
    await page.getByRole("button", { name: "Actualiser" }).click();
    await graph.getByRole("option", { name: /ajout de c/ }).click();
    await graph.getByRole("option", { name: /suite de b/ }).click({ modifiers: ["Control"] });
    await graph.getByRole("option", { name: /ajout de b/ }).last().click({ modifiers: ["Control"] });
    await panel.getByRole("button", { name: "Cherry-pick (3)" }).click();
    await expect(page.getByText("Cherry-pick de 3 commits sur main terminé.")).toBeVisible();
    expect(git(mine, "log", "--format=%s", "-n", "3", "main").split("\n")).toEqual(["ajout de c", "suite de b", "ajout de b"]);
    expect(readFileSync(join(mine, "b.txt"), "utf8")).toBe("b\nb2\n");
  } finally {
    await app.close();
  }
});

test("reset hard, puis le reflog retrouve le commit perdu et une branche le récupère", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "perdu.txt", "p\n", "commit à retrouver");
  const lost = git(mine, "rev-parse", "HEAD");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option").nth(1).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Reset de main ici…" }).click();
    await page.getByRole("alertdialog", { name: /^Reset de main sur/ }).getByRole("button", { name: "Hard (tout abandonner)" }).click();
    await expect(graph).not.toContainText("commit à retrouver");
    expect(git(mine, "status", "--porcelain")).toBe("");

    await page.getByRole("button", { name: "Reflog" }).click();
    const list = page.getByRole("region", { name: "Reflog" }).getByRole("listbox", { name: "Où était HEAD" });
    await expect(list.getByRole("option").first()).toContainText("reset");
    const entry = list.getByRole("option").filter({ hasText: "commit à retrouver" }).first();
    await expect(entry).toContainText("hors des branches");
    await entry.click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Nouvelle branche ici…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouvelle branche" });
    await dialog.getByLabel("Nom de la branche").fill("retrouvee");
    await dialog.getByLabel("Passer sur la nouvelle branche").uncheck();
    await dialog.getByRole("button", { name: "Créer" }).click();
    await expect(entry).not.toContainText("hors des branches");
    expect(git(mine, "rev-parse", "retrouvee")).toBe(lost);
  } finally {
    await app.close();
  }
});

test("chercher quand un texte a été ajouté puis retiré, limité à un fichier", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "aiguille\n", "ajout de l'aiguille");
  sandbox.commit(mine, "b.txt", "aiguille aussi\n", "aiguille dans b");
  sandbox.commit(mine, "a.txt", "rien\n", "retrait de l'aiguille");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    await page.getByRole("button", { name: "Chercher", exact: true }).click();
    const view = page.getByRole("region", { name: "Recherche dans les modifications" });
    await view.getByLabel("Texte cherché").fill("aiguille");
    await view.getByLabel("Fichier ou dossier (facultatif)").fill("a.txt");
    await view.getByRole("button", { name: "Chercher" }).click();
    const results = view.getByRole("listbox", { name: /commits?/ }).getByRole("option");
    await expect(results).toHaveText([/retrait de l'aiguille/, /ajout de l'aiguille/]);
    await view.getByLabel("Fichier ou dossier (facultatif)").fill("");
    await view.getByRole("button", { name: "Chercher" }).click();
    await expect(results).toHaveCount(3);
    await results.nth(1).dblclick();
    await expect(view).toHaveCount(0);
    await expect(page.getByRole("listbox", { name: "Historique des commits" }).getByRole("option", { selected: true })).toContainText("aiguille dans b");
  } finally {
    await app.close();
  }
});

test("historique d'un fichier renommé : ses commits avant et après le renommage", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\nquatre\n", "création de a");
  sandbox.commit(mine, "b.txt", "autre\n", "autre fichier");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\nquatre\ncinq\n", "a modifié");
  git(mine, "mv", "a.txt", "c.txt");
  git(mine, "commit", "-qm", "a renommé en c");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option").first().click();
    const panel = page.getByRole("complementary", { name: "Détails du commit" });
    await panel.locator(".file-row", { hasText: "c.txt" }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Historique du fichier" }).click();
    const view = page.getByRole("region", { name: "Historique du fichier" });
    const rows = view.getByRole("listbox", { name: /commits?/ }).getByRole("option");
    await expect(rows).toHaveText([/a renommé en c.*renommé depuis a\.txt/, /a modifié/, /création de a/, /init/]);
    await rows.nth(1).dblclick();
    const diff = page.getByRole("region", { name: /^Diff de / });
    await expect(diff.locator("tr.add")).toContainText("cinq");
  } finally {
    await app.close();
  }
});

test("blame de la copie de travail : chaque ligne avec son commit, les nouvelles pas encore commitées", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "un\ndeux\n", "première version");
  sandbox.commit(mine, "a.txt", "un\ndeux\ntrois\n", "ajout de trois");
  writeFileSync(join(mine, "a.txt"), "un\ndeux\ntrois\nquatre\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const staging = page.getByRole("complementary", { name: "Modifications en cours" });
    await staging.locator(".file-row", { hasText: "a.txt" }).first().click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Blame", exact: true }).click();
    const view = page.getByRole("region", { name: "Blame" });
    await expect(view).toContainText("copie de travail");
    const rows = view.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator(".blame-commit")).toContainText("première version");
    await expect(rows.nth(2).locator(".blame-commit")).toContainText("ajout de trois");
    await expect(rows.nth(3).locator(".blame-commit")).toContainText("Pas encore commité");
    await expect(rows.nth(3).locator(".blame-text")).toHaveText("quatre");

    // Remonter avant « ajout de trois » : le fichier à « première version », deux lignes.
    const first = git(mine, "rev-parse", "HEAD~1");
    await rows.nth(2).locator(".blame-commit").click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Blame avant ce commit" }).click();
    await expect(view).toContainText(first.slice(0, 7));
    await expect(rows).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test("tag annoté créé sur un commit et poussé, puis supprimé ici et sur le remote", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "1\n", "premier");
  const first = git(mine, "rev-parse", "HEAD");
  sandbox.commit(mine, "a.txt", "2\n", "second");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    const row = graph.getByRole("option").filter({ hasText: "premier" });
    await row.click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Nouveau tag ici…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouveau tag" });
    await dialog.getByLabel("Nom du tag").fill("v1.0.0");
    await dialog.getByLabel(/^Message/).fill("Version 1");
    await dialog.getByLabel("Pousser le tag sur origin").check();
    await dialog.getByRole("button", { name: "Créer le tag" }).click();
    await expect(row).toContainText("v1.0.0");
    await expect(page.getByText("Tag v1.0.0 poussé sur origin.")).toBeVisible();
    expect(git(mine, "cat-file", "-t", "v1.0.0")).toBe("tag");
    expect(git(mine, "rev-parse", "v1.0.0^{commit}")).toBe(first);
    expect(git(sandbox.remote, "rev-parse", "v1.0.0^{commit}")).toBe(first);

    await row.locator(".chip.tag", { hasText: "v1.0.0" }).click({ button: "right" });
    await page.getByRole("menu").first().getByRole("menuitem", { name: "Supprimer le tag v1.0.0…" }).click();
    await page.getByRole("alertdialog", { name: "Supprimer le tag v1.0.0 ?" }).getByRole("button", { name: "Ici et sur origin" }).click();
    await expect(row).not.toContainText("v1.0.0");
    expect(git(mine, "tag", "-l")).toBe("");
    expect(git(sandbox.remote, "tag", "-l")).toBe("");
  } finally {
    await app.close();
  }
});

test("conflit de merge résolu dans GitGR (3 panneaux) : fichier écrit avec le résultat composé et indexé", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "c.txt", "a\nun\nb\nc\nd\n", "base");
  git(mine, "checkout", "-q", "-b", "sujet");
  sandbox.commit(mine, "c.txt", "a\ndeux\nb\nc\nD\n", "côté sujet");
  git(mine, "checkout", "-q", "main");
  sandbox.commit(mine, "c.txt", "a\ntrois\nb\nc\nd\n", "côté main");
  try {
    git(mine, "merge", "-q", "sujet");
  } catch {
    // conflit attendu
  }

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    // Un clic sur le fichier en conflit ouvre la résolution.
    await panel.getByRole("listbox", { name: "Conflits" }).getByRole("option").filter({ hasText: "c.txt" }).click();
    const view = page.getByRole("region", { name: "Résolution du conflit de c.txt" });
    // La modification sans conflit (d → D) est déjà appliquée ; le conflit part de la version commune.
    await expect(view.getByRole("group", { name: /Modification de l’autre côté/ }).getByRole("textbox")).toHaveValue("D");
    const conflict = view.getByRole("group", { name: /^Conflit 1 \/ 1/ });
    // Merge : les côtés s'appellent « notre branche » et « branche fusionnée ».
    await expect(view.locator(".mgrid-head")).toContainText("Notre branche · HEAD");
    await expect(view.locator(".mgrid-head")).toContainText("Branche fusionnée · sujet");
    await expect(conflict.getByRole("textbox")).toHaveValue("un");
    await conflict.getByRole("button", { name: "Mettre HEAD dans le résultat" }).click();
    await conflict.getByRole("button", { name: "Ajouter sujet à la suite dans le résultat" }).click();
    await view.getByRole("button", { name: "Enregistrer et marquer résolu" }).click();
    await expect(view).toHaveCount(0);
    expect(readFileSync(join(mine, "c.txt"), "utf8")).toBe("a\ntrois\ndeux\nb\nc\nD\n");
    expect(git(mine, "diff", "--name-only", "--diff-filter=U")).toBe("");
    expect(git(mine, "diff", "--cached", "--name-only")).toBe("c.txt");
  } finally {
    await app.close();
  }
});

test("conflit de rebase : côtés nommés « branche de base » / « vos commits », Alt+→ puis Ctrl+S", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "r.txt", "a\nun\nb\n", "base");
  git(mine, "checkout", "-q", "-b", "travail");
  sandbox.commit(mine, "r.txt", "a\nà moi\nb\n", "mon commit");
  git(mine, "checkout", "-q", "main");
  sandbox.commit(mine, "r.txt", "a\nde main\nb\n", "commit de main");
  git(mine, "checkout", "-q", "travail");
  try {
    git(mine, "rebase", "-q", "main");
  } catch {
    // conflit attendu
  }

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const panel = page.getByRole("complementary", { name: "Modifications en cours" });
    await panel.getByRole("listbox", { name: "Conflits" }).getByRole("option").filter({ hasText: "r.txt" }).click();
    const view = page.getByRole("region", { name: "Résolution du conflit de r.txt" });
    // Pendant un rebase, « nous » est la branche de base, « eux » le commit rejoué.
    await expect(view.locator(".mgrid-head")).toContainText("Branche de base");
    await expect(view.locator(".mgrid-head")).toContainText("Vos commits");
    await expect(view.getByRole("button", { name: "Prendre vos commits" })).toBeVisible();
    // Le focus est dans le résultat du conflit ; Alt+→ y met le commit rejoué, Ctrl+S enregistre.
    await expect(view.getByRole("textbox", { name: "Résultat de la modification 1" })).toBeFocused();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(view.locator(".conflict-status")).toHaveText("Tout est résolu");
    await page.keyboard.press("Control+s");
    await expect(view).toHaveCount(0);
    expect(readFileSync(join(mine, "r.txt"), "utf8")).toBe("a\nà moi\nb\n");
    expect(git(mine, "diff", "--name-only", "--diff-filter=U")).toBe("");
  } finally {
    await app.close();
  }
});

test("revert de deux commits sélectionnés : leurs fichiers retirés par deux nouveaux commits", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "x.txt", "x\n", "ajout de x");
  sandbox.commit(mine, "y.txt", "y\n", "ajout de y");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option", { name: /ajout de y/ }).click();
    await graph.getByRole("option", { name: /ajout de x/ }).click({ modifiers: ["Shift"] });
    await graph.getByRole("option", { name: /ajout de x/ }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Revert des 2 commits" }).click();
    await expect(page.getByText("Revert de 2 commits sur main terminé.")).toBeVisible();
    expect(git(mine, "log", "--format=%s", "-n", "2").split("\n")).toEqual(['Revert "ajout de x"', 'Revert "ajout de y"']);
    expect(git(mine, "ls-files").split("\n")).not.toContain("x.txt");
  } finally {
    await app.close();
  }
});

test("squash de deux commits au milieu de la branche : le suivant rejoué, un commit de moins", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "p.txt", "p\n", "partie 1");
  sandbox.commit(mine, "q.txt", "q\n", "partie 2");
  sandbox.commit(mine, "r.txt", "r\n", "suite");
  const before = Number(git(mine, "rev-list", "--count", "HEAD"));

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option", { name: /partie 2/ }).click();
    await graph.getByRole("option", { name: /partie 1/ }).click({ modifiers: ["Control"] });
    await graph.getByRole("option", { name: /partie 1/ }).click({ button: "right" });
    await page.getByRole("menu").getByRole("menuitem", { name: "Squash des 2 commits…" }).click();
    const dialog = page.getByRole("dialog", { name: "Squash de 2 commits" });
    await expect(dialog.getByRole("textbox")).toHaveValue("partie 1");
    await dialog.getByRole("textbox").fill("les deux parties");
    await dialog.getByRole("button", { name: "Réunir" }).click();
    await expect(page.getByText("2 commits réunis en un seul.")).toBeVisible();
    expect(Number(git(mine, "rev-list", "--count", "HEAD"))).toBe(before - 1);
    expect(git(mine, "log", "--format=%s", "-n", "2").split("\n")).toEqual(["suite", "les deux parties"]);
    expect(git(mine, "log", "-1", "--format=%b", "HEAD~1")).toContain("* partie 2");
  } finally {
    await app.close();
  }
});

test("détails d'un commit : committer différent affiché, parent au clavier puis Alt+← pour revenir", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.commit(mine, "a.txt", "un\n", "premier");
  sandbox.commit(mine, "b.txt", "deux\n", "second");
  // Le dernier commit repris par quelqu'un d'autre : auteur gardé, committer changé.
  git(mine, "-c", "user.name=Robot", "-c", "user.email=robot@exemple.fr", "commit", "--amend", "--no-edit", "-q");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const graph = page.getByRole("listbox", { name: "Historique des commits" });
    await graph.getByRole("option").first().click();
    const panel = page.getByRole("complementary", { name: "Détails du commit" });
    await expect(panel.getByRole("heading", { name: "second" })).toBeVisible();
    await expect(panel.locator(".person-email")).toHaveText("mine@exemple.fr");
    await expect(panel.locator(".person-committer")).toHaveText(/^Commité par Robot <robot@exemple\.fr> le /);

    await panel.getByRole("button", { name: /^Parent [0-9a-f]{7} : sélectionner ce commit$/ }).press("Enter");
    const first = panel.getByRole("heading", { name: "premier" });
    await expect(first).toBeFocused();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(panel.getByRole("heading", { name: "second" })).toBeFocused();
  } finally {
    await app.close();
  }
});

test("annoter les modifications en cours, fichier entier : la marge dit qui a écrit chaque ligne", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const lines = Array.from({ length: 20 }, (_, i) => `ligne ${i + 1}`);
  sandbox.commit(mine, "a.txt", lines.join("\n") + "\n", "vingt lignes");
  writeFileSync(join(mine, "a.txt"), [...lines.slice(0, 19), "modifiée"].join("\n") + "\n");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const staging = page.getByRole("complementary", { name: "Modifications en cours" });
    await staging.locator(".file-row", { hasText: "a.txt" }).first().click();
    const diff = page.getByRole("region", { name: "Diff de a.txt" });
    // Bloc seul : la dernière ligne et 3 lignes de contexte ; fichier entier : les 20 lignes.
    await expect(diff.locator("td.code")).toHaveCount(5);
    await diff.getByRole("button", { name: "Fichier entier" }).click();
    await expect(diff.locator("td.code")).toHaveCount(21);
    // Annoter : la marge porte l'auteur du commit, puis « Pas encore commité » sur la ligne modifiée.
    await diff.getByRole("button", { name: "Annoter (blame)" }).click();
    await expect(diff.locator(".ann.start").first()).toContainText("·");
    await expect(diff.locator(".ann.start").last()).toHaveText("Pas encore commité");
  } finally {
    await app.close();
  }
});
