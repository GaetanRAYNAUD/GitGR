import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Dépôt simulé « GitGR » : origin sur gitlab.exemple.fr (donc des merge requests), main suit
// origin/main, feature/profils n'a pas de distante. Backend simulé : src/lib/api.ts (createPull).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const locals = (page: Page) => sidebar(page).locator(".side-group").first();
const branch = (page: Page, label: string) => locals(page).getByRole("treeitem", { name: new RegExp(`^${label}( |$)`) });
/** Branche de la section du remote origin (2e section de la barre latérale). */
const remoteBranch = (page: Page, label: string) => sidebar(page).locator(".side-group").nth(1).getByRole("treeitem", { name: new RegExp(`^${label}( |$)`) });
const graph = (page: Page) => page.getByRole("listbox", { name: "Historique des commits" });
const chip = (page: Page, label: string) => graph(page).locator(".chip", { has: page.locator(".chip-label", { hasText: new RegExp(`^${label}$`) }) });
const menu = (page: Page) => page.getByRole("menu");
const dialog = (page: Page) => page.getByRole("dialog", { name: /Créer une merge request|Merge request/ });

/** Profil « Boulot » (règle gitlab.exemple.fr) avec un compte sur cette instance, ou sans. */
async function seed(page: Page, withAccount: boolean) {
  await page.goto("/");
  await page.evaluate((withAccount) => {
    const state = { repos: [], session: { openTabs: [], active: null }, settings: { theme: "system", language: "system" } } as Record<string, unknown>;
    state.profiles = [
      {
        id: "p-boulot",
        name: "Boulot",
        userName: "Demo",
        userEmail: "demo@boulot.fr",
        sshKey: null,
        rules: ["gitlab.exemple.fr"],
        color: 1,
        accounts: withAccount ? [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }] : [],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  }, withAccount);
  await page.reload();
  await openNextRepo(page, "GitGR");
}

test("clic droit sur une autre branche : MR de la branche courante vers celle-ci, poussée d'abord", async ({ page }) => {
  await seed(page, true);
  await branch(page, "profils").dblclick();
  await expect(page.locator(".branch-chip-label")).toHaveText("feature/profils");

  await remoteBranch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request de feature/profils vers origin/main…" }).click();

  const d = dialog(page);
  await expect(d.locator(".pull-route")).toHaveText(/feature\/profils.*origin\/main/);
  await expect(d.getByLabel("Branche cible")).toHaveValue("main");
  // Deux commits : titre tiré de la branche, description = liste des commits.
  await expect(d.getByLabel("Titre")).toHaveValue("Feature/profils");
  await expect(d.getByLabel("Description")).toHaveValue("- Début de feature/profils\n- Fin de feature/profils");
  await expect(d.getByText("feature/profils sera d’abord poussée vers origin.")).toBeVisible();

  await d.getByLabel("Titre").fill("Profils : règles par remote");
  await d.getByLabel("Brouillon").check();
  await d.getByRole("button", { name: "Créer la merge request" }).click();

  // Fenêtre fermée ; la MR annoncée dans un message, avec de quoi l'ouvrir et copier son lien.
  await expect(dialog(page)).toHaveCount(0);
  const done = page.locator(".toast", { hasText: "Merge request !42 créée — Draft: Profils : règles par remote" });
  await expect(done).toBeVisible();
  await expect(done.getByRole("button", { name: "Voir" })).toBeVisible();
  await expect(done.getByRole("button", { name: "Copier le lien" })).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { __mockPulls: unknown[] }).__mockPulls);
  expect(sent).toEqual([
    {
      sourceRepo: "demo/gitgr",
      sourceBranch: "feature/profils",
      targetRepo: "demo/gitgr",
      targetBranch: "main",
      title: "Profils : règles par remote",
      body: "- Début de feature/profils\n- Fin de feature/profils",
      draft: true,
      assignees: [],
      reviewers: [],
      labels: [],
    },
  ]);
  // Poussée avec son suivi.
  await expect(chip(page, "feature/profils").locator(".chip-synced")).toBeVisible();
  await expect(remoteBranch(page, "profils")).toBeVisible();
  // « Voir » : la MR dans GitGR, à la place du graphe.
  await done.getByRole("button", { name: "Voir" }).click();
  await expect(page.locator(".pull-view")).toBeVisible();
  await expect(done).toHaveCount(0);
});

test("sur la branche courante : cible par défaut du dépôt, et refus d'une MR vers sa propre branche suivie", async ({ page }) => {
  await seed(page, true);
  await branch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  const d = dialog(page);
  await expect(d.getByLabel("Branche cible")).toHaveValue("main");
  await expect(d.getByText("La branche cible est celle que suit la branche courante.")).toBeVisible();
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeDisabled();
  await d.getByLabel("Branche cible").fill("fix/ssh-agent");
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeEnabled();
  await d.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Pas d'entrée vers la branche que suit la courante.
  await remoteBranch(page, "main").click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: /merge request/ })).toHaveCount(0);
});

test("sans compte connecté : la raison et un lien vers les comptes", async ({ page }) => {
  await seed(page, false);
  await branch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  const d = dialog(page);
  await expect(d.getByText("Aucun compte GitLab n’est connecté pour le profil du remote origin.")).toBeVisible();
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeDisabled();
  await d.getByRole("button", { name: "Gérer les comptes…" }).click();
  await expect(page.locator(".profiles-page")).toBeVisible();
});

test("un autre profil a un compte sur la forge : l'associer au remote d'un clic ; branche cible au clavier", async ({ page }) => {
  await page.goto("/");
  // « Boulot » (règle du remote) sans compte ; « Perso » a un compte sur gitlab.exemple.fr.
  await page.evaluate(() => {
    const p = (id: string, name: string, rules: string[], accounts: unknown[]) => ({ id, name, userName: "Demo", userEmail: `${id}@x.fr`, sshKey: null, rules, color: 1, accounts });
    localStorage.setItem(
      "gitgr.mock-state",
      JSON.stringify({
        repos: [],
        session: { openTabs: [], active: null },
        settings: { theme: "system", language: "system" },
        profiles: [
          p("p-boulot", "Boulot", ["gitlab.exemple.fr"], []),
          p("p-perso", "Perso", [], [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }]),
        ],
      }),
    );
  });
  await page.reload();
  await openNextRepo(page, "GitGR");
  await branch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: "Associer origin au profil Perso (camille)" }).click();
  await expect(d.getByText(/Aucun compte GitLab/)).toHaveCount(0);
  await expect(d).toContainText("Merge request créée par camille");

  // Branche cible : liste maison, au clavier (↓, Entrée choisit sans envoyer).
  const target = d.getByRole("combobox", { name: "Branche cible" });
  await target.fill("ssh");
  await target.press("ArrowDown");
  await expect(d.getByRole("listbox", { name: "Branche cible" }).getByRole("option").first()).toContainText("fix/ssh-agent");
  await target.press("Enter");
  await expect(target).toHaveValue("fix/ssh-agent");
  await expect(d).toBeVisible();
  // Liste ouverte : Échap la ferme, pas la fenêtre.
  await target.press("ArrowDown");
  await expect(d.getByRole("listbox", { name: "Branche cible" })).toBeVisible();
  await target.press("Escape");
  await expect(d.getByRole("listbox", { name: "Branche cible" })).toHaveCount(0);
  await expect(d).toBeVisible();
});

const fetches = (page: Page) => page.evaluate(() => (window as unknown as { __mockOptionFetches: { count: number } }).__mockOptionFetches.count);

test("relecteurs, assignés et étiquettes : liste préchargée à l'ouverture du dépôt, puis reprise sur un autre dépôt de l'organisation", async ({ page }) => {
  await seed(page, true);
  // Préchargée dès l'ouverture du dépôt (lecture simulée : 0,6 s), pas à celle de la fenêtre.
  await expect.poll(() => fetches(page)).toBe(1);
  await branch(page, "profils").dblclick();
  await expect(page.locator(".branch-chip-label")).toHaveText("feature/profils");
  await remoteBranch(page, "main").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: /Créer une merge request de feature\/profils/ }).click();
  const d = dialog(page);
  await expect(d.getByRole("status").filter({ hasText: /Liste lue/ })).toBeVisible();

  // 300 personnes : la recherche filtre, seuls les premiers résultats sont affichés.
  const reviewers = d.getByRole("combobox", { name: "Relecteurs" });
  await reviewers.click();
  await expect(d.getByRole("option").first()).toBeVisible();
  await expect(d.getByText("… et 250 autres : précisez la recherche.")).toBeVisible();
  await reviewers.fill("développeur 42");
  await expect(d.getByRole("option")).toHaveCount(1);
  await reviewers.press("Enter");
  await expect(d.locator(".mpick-chip", { hasText: "dev-042" })).toBeVisible();
  // La liste se ferme après un choix ; ↓ la rouvre, Échap la ferme sans fermer la fenêtre.
  await expect(d.getByRole("listbox")).toHaveCount(0);
  await reviewers.press("ArrowDown");
  await expect(d.getByRole("listbox")).toBeVisible();
  await reviewers.press("Escape");
  await expect(d.getByRole("listbox")).toHaveCount(0);
  await expect(d).toBeVisible();

  // Assignés et Étiquettes aussi larges que Relecteurs.
  const width = async (name: string) => (await d.locator(".mpick-field", { has: page.getByRole("combobox", { name }) }).boundingBox())!.width;
  const full = await width("Relecteurs");
  expect(await width("Assignés")).toBeCloseTo(full, 0);
  expect(await width("Étiquettes")).toBeCloseTo(full, 0);

  await d.getByRole("button", { name: "M’assigner" }).click();
  await expect(d.locator(".mpick-chip", { hasText: "camille" })).toBeVisible();
  const labels = d.getByRole("combobox", { name: "Étiquettes" });
  // En bas de la fenêtre (petite hauteur) : la liste s'ouvre au-dessus du champ, entière à
  // l'écran, et non coupée sous le bas de la zone qui défile.
  await page.setViewportSize({ width: 1280, height: 560 });
  await labels.scrollIntoViewIfNeeded();
  await labels.click();
  const list = d.getByRole("listbox");
  await expect(list).toHaveClass(/(^| )up( |$)/);
  const lb = (await list.boundingBox())!;
  const db = (await d.boundingBox())!;
  expect(lb.y).toBeGreaterThanOrEqual(db.y);
  expect(lb.y + lb.height).toBeLessThanOrEqual((await labels.boundingBox())!.y);
  await labels.press("Escape");
  await labels.fill("bu");
  await d.getByRole("option", { name: /bug/ }).click();
  await d.getByRole("button", { name: "Créer la merge request" }).click();
  await expect(page.locator(".toast", { hasText: "Merge request !42 créée" })).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { __mockPulls: { assignees: unknown; reviewers: unknown; labels: unknown }[] }).__mockPulls[0]);
  expect(sent.reviewers).toEqual([{ id: 141, login: "dev-042", name: "Développeur 42", avatar: "mock:dev-042" }]);
  expect(sent.assignees).toEqual([{ id: 7, login: "camille", name: "Camille Dupont", avatar: "mock:camille" }]);
  expect(sent.labels).toEqual(["bug"]);
  // Aucune lecture de plus : la fenêtre a pris la liste préchargée.
  expect(await fetches(page)).toBe(1);
  await page.locator(".toast").getByRole("button", { name: "Fermer" }).click();

  // Autre dépôt du même groupe (demo), lecture lente : la liste des autres dépôts sert en
  // attendant, et les derniers choix se reprennent en un clic.
  await page.evaluate(() => ((window as unknown as { __mockOptionFetches: { delay: number } }).__mockOptionFetches.delay = 5000));
  await openNextRepo(page, "api-backend");
  await locals(page).getByRole("treeitem", { name: /^main( |$)/ }).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Créer une merge request…" }).click();
  await expect(d.getByRole("status").filter({ hasText: "En attendant la liste de ce dépôt : les personnes des autres dépôts de demo." })).toBeVisible();
  await d.getByRole("combobox", { name: "Assignés" }).fill("dev-298");
  await expect(d.getByRole("option", { name: /dev-298/ })).toBeVisible();
  await d.getByRole("button", { name: "Reprendre les derniers choix" }).click();
  await expect(d.locator(".mpick-chip")).toHaveText([/dev-042/, /camille/, /bug/]);

  // Des choix en cours : un clic à côté ne ferme pas, Échap demande d'abord confirmation.
  await page.mouse.click(5, 300);
  await expect(d).toBeVisible();
  await d.getByLabel("Titre").focus();
  await page.keyboard.press("Escape");
  await expect(d.getByRole("button", { name: "Continuer la saisie" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(d.getByRole("button", { name: "Créer la merge request" })).toBeVisible();
  await d.getByRole("button", { name: "Retour" }).click();
  await d.getByRole("button", { name: "Abandonner" }).click();
  await expect(d).toHaveCount(0);
});
