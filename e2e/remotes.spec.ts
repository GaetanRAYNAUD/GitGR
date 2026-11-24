import { expect, test, type Page } from "@playwright/test";
import { openRepos, tab } from "./fixtures";

// « dotfiles » (3e dépôt simulé, src/lib/mockHistory.ts) a deux remotes : origin
// (gitlab.exemple.fr, suivi par main, 1 commit à pousser) et client (gitlab.client.fr, en retard).
// Les autres dépôts simulés n'ont qu'origin.

const tools = (page: Page) => page.locator(".tools");
/** Bouton de la barre d'outils, avec son badge cliquable quand il en a un (enveloppe `.tool-badged`). */
const tool = (page: Page, name: string) =>
  page
    .locator(".tools")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .locator("xpath=(ancestor::*[contains(concat(' ', @class, ' '), ' tool-badged ')] | .)[1]");
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
/** En-tête de la section d'un remote. */
const remote = (page: Page, name: string) => sidebar(page).locator(".section-btn").filter({ has: page.locator(".section-name", { hasText: new RegExp(`^${name}$`) }) });
const menu = (page: Page) => page.getByRole("menu");
const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const profilesPage = (page: Page) => page.locator(".profiles-page");

/** Crée un profil avec une règle de remote, depuis la page des profils (déjà ouverte). */
async function createProfile(page: Page, name: string, rule: string) {
  await profilesPage(page).getByRole("button", { name: "Nouveau profil" }).first().click();
  await page.getByLabel("Nom du profil").fill(name);
  await page.getByLabel("Nom (user.name)").fill("Camille Dupont");
  await page.getByLabel("E-mail (user.email)").fill(`camille@${name.toLowerCase()}.fr`);
  await page.getByLabel("Nouvelle règle").fill(rule);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.locator(".pf-head-sub")).toContainText("Enregistré");
}

/** Profils « Entreprise » (gitlab.exemple.fr) et « Client » (gitlab.client.fr). */
async function createProfiles(page: Page) {
  await page.getByRole("button", { name: "Profils et comptes" }).click();
  await createProfile(page, "Entreprise", "gitlab.exemple.fr");
  await createProfile(page, "Client", "gitlab.client.fr");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 3);
  await expect(tab(page, "dotfiles")).toHaveAttribute("aria-selected", "true");
});

test("un seul remote : pas de menu « Pousser vers… » ni « Tirer depuis… »", async ({ page }) => {
  await tab(page, "GitGR").click();
  await expect(tool(page, "Push")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pousser vers…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mode du pull" }).click();
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu(page).getByRole("menuitem")).toHaveCount(0);
});

test("pousser vers un remote choisi, puis vers tous", async ({ page }) => {
  await expect(remote(page, "client")).toBeVisible();
  await expect(remote(page, "origin")).toBeVisible();
  await expect(tool(page, "Push")).toContainText("1");

  // Vers client : origin n'a rien reçu, le commit reste à pousser.
  await page.getByRole("button", { name: "Pousser vers…" }).click();
  await menu(page).getByRole("menuitem", { name: "Pousser vers client" }).click();
  await expect(status(page, "main poussée vers client.")).toBeVisible();
  await expect(tool(page, "Push")).toContainText("1");

  await page.getByRole("button", { name: "Pousser vers…" }).click();
  await menu(page).getByRole("menuitem", { name: "Pousser vers tous les remotes" }).click();
  await expect(status(page, "main poussée vers origin, client.")).toBeVisible();
  await expect(tool(page, "Push").locator(".badge")).toHaveCount(0);
});

test("tirer depuis un autre remote, depuis le menu du pull et le clic droit sur le remote", async ({ page }) => {
  await page.getByRole("button", { name: "Mode du pull" }).click();
  await expect(menu(page).getByRole("menuitem", { name: "Tirer depuis origin" })).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Tirer depuis client" }).click();
  await expect(status(page, "client/main tirée.")).toBeVisible();

  await remote(page, "client").click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Tirer main depuis client" })).toBeVisible();
  await menu(page).getByRole("menuitem", { name: "Pousser main vers client" }).click();
  await expect(status(page, "main poussée vers client.")).toBeVisible();
});

test("ajouter, renommer, changer l'URL puis supprimer un remote", async ({ page }) => {
  await tab(page, "GitGR").click();
  await sidebar(page).getByRole("button", { name: "Ajouter un remote…" }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un remote" });
  // Nom déjà pris : refusé ; l'URL est obligatoire.
  await dialog.getByLabel("Nom du remote").fill("origin");
  await expect(dialog).toContainText("Un remote porte déjà ce nom.");
  await dialog.getByLabel("Nom du remote").fill("client");
  await expect(dialog.getByRole("button", { name: "Ajouter" })).toBeDisabled();
  await dialog.getByLabel("URL").fill("git@gitlab.client.fr:projet/gitgr.git");
  await expect(dialog.getByLabel("Récupérer ses branches tout de suite (fetch)")).toBeChecked();
  await dialog.getByRole("button", { name: "Ajouter" }).click();

  // Sa section apparaît (vide : rien n'a encore été récupéré), avec les menus à plusieurs remotes.
  await expect(remote(page, "client")).toContainText("0");
  await expect(remote(page, "client")).toHaveAttribute("title", /git@gitlab\.client\.fr:projet\/gitgr\.git/);
  await expect(page.getByRole("button", { name: "Pousser vers…" })).toBeVisible();

  await remote(page, "client").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Renommer…" }).click();
  const rename = page.getByRole("dialog", { name: "Renommer le remote client" });
  await rename.getByLabel("Nom du remote").fill("partenaire");
  await rename.getByRole("button", { name: "Renommer" }).click();
  await expect(remote(page, "partenaire")).toBeVisible();
  await expect(remote(page, "client")).toHaveCount(0);

  await remote(page, "partenaire").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Modifier l’URL…" }).click();
  const url = page.getByRole("dialog", { name: "URL de partenaire" });
  await expect(url.getByLabel("URL")).toHaveValue("git@gitlab.client.fr:projet/gitgr.git");
  await url.getByLabel("URL").fill("ssh://git@gitlab.partenaire.fr/gitgr.git");
  await url.getByRole("button", { name: "Enregistrer" }).click();
  await expect(remote(page, "partenaire")).toHaveAttribute("title", /ssh:\/\/git@gitlab\.partenaire\.fr\/gitgr\.git/);

  await remote(page, "partenaire").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Supprimer le remote…" }).click();
  await page.getByRole("alertdialog", { name: "Supprimer le remote partenaire ?" }).getByRole("button", { name: "Supprimer" }).click();
  await expect(remote(page, "partenaire")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pousser vers…" })).toHaveCount(0);
});

test("profil de chaque remote : d'après les règles, puis choisi à la main", async ({ page }) => {
  // Sans profil : pas de pastille, et le menu du remote ne propose pas de profil.
  await expect(remote(page, "origin").locator(".section-profile")).toHaveCount(0);
  await remote(page, "origin").click({ button: "right" });
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem", { name: "Copier l’URL" })).toBeEnabled();
  await page.keyboard.press("Escape");

  await createProfiles(page);
  // Le dépôt prend « Entreprise » (règle sur origin) ; chaque remote a le profil de son hôte.
  await expect(page.locator(".status-profile")).toHaveText("Entreprise");
  await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Entreprise");
  await expect(remote(page, "client").locator(".section-profile")).toHaveText("Client");
  await expect(remote(page, "client")).toHaveAttribute("title", /git@gitlab\.client\.fr:projet\/dotfiles\.git\nProfil « Client », d’après ses règles/);

  // Choix à la main pour origin.
  await remote(page, "origin").click({ button: "right" });
  await expect(menu(page).getByRole("menuitemradio", { name: "Profil automatique (Entreprise)" })).toHaveAttribute("aria-checked", "true");
  await menu(page).getByRole("menuitemradio", { name: /^Client ·/ }).click();
  await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Client");
  await expect(remote(page, "origin")).toHaveAttribute("title", /choisi pour ce remote/);
  // Le profil du dépôt (identité des commits) ne change pas.
  await expect(page.locator(".status-profile")).toHaveText("Entreprise");

  // Conservé au redémarrage.
  await page.reload();
  await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Client");

  // Aucun profil : ssh garde sa configuration.
  await remote(page, "origin").click({ button: "right" });
  await expect(menu(page).getByRole("menuitemradio", { name: /^Client ·/ })).toHaveAttribute("aria-checked", "true");
  await menu(page).getByRole("menuitemradio", { name: "Aucun profil (configuration SSH)" }).click();
  await expect(remote(page, "origin").locator(".section-profile")).toHaveCount(0);

  // Retour à l'automatique.
  await remote(page, "origin").click({ button: "right" });
  await menu(page).getByRole("menuitemradio", { name: "Profil automatique (Entreprise)" }).click();
  await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Entreprise");

  // Sans règle pour son hôte, un remote prend le profil du dépôt.
  await tab(page, "GitGR").click();
  await page.locator(".status-profile").click();
  await menu(page).getByRole("menuitemradio", { name: /^Client ·/ }).click();
  await expect(page.locator(".status-profile")).toHaveText("Client");
  await expect(remote(page, "origin").locator(".section-profile")).toHaveText("Entreprise");
});
