import { expect, test, type Page } from "@playwright/test";
import { homeButton, tab } from "./fixtures";

/** Deux profils avec chacun un compte : « Perso » (clé SSH, règle github.com) et « Boulot ». */
async function seedProfiles(page: Page) {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "null") ?? {
      repos: [],
      session: { openTabs: [], active: null },
      settings: { theme: "system", language: "system" },
    };
    state.profiles = [
      {
        id: "p-perso",
        name: "Perso",
        userName: "Demo",
        userEmail: "demo@exemple.fr",
        sshKey: "~/.ssh/id_ed25519",
        rules: ["github.com"],
        color: 0,
        accounts: [{ id: "github|https://github.com|octo-demo", kind: "github", url: "https://github.com", login: "octo-demo", name: "Octo" }],
      },
      {
        id: "p-boulot",
        name: "Boulot",
        userName: "Demo",
        userEmail: "demo@boulot.fr",
        sshKey: null,
        rules: ["gitlab.exemple.fr"],
        color: 1,
        accounts: [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  });
  await page.reload();
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Cloner un dépôt" });
/** Bouton de choix (profil, compte) : il affiche le choix en cours. */
// Nom lu : le libellé puis la valeur choisie (« Profil Perso (proposé) »).
const picker = (page: Page, name: string) => dialog(page).getByRole("button", { name: new RegExp(`^${name} `) });

async function choose(page: Page, name: string, option: string | RegExp) {
  await picker(page, name).click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: option }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

async function openClone(page: Page) {
  await page.getByRole("button", { name: /^Cloner/ }).click();
  await expect(dialog(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("cloner par URL : nom tiré de l'URL, dépôt ouvert dans un onglet", async ({ page }) => {
  await openClone(page);
  const d = dialog(page);
  await expect(d.getByRole("button", { name: "Cloner" })).toBeDisabled();
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill("https://github.com/octo/mon-outil.git");
  await expect(d.getByRole("textbox", { name: "Nom du dossier" })).toHaveValue("mon-outil");
  await expect(d.getByRole("textbox", { name: "Dossier de destination" })).toHaveValue("C:/Users/demo");
  await expect(d).toContainText("Sera cloné dans C:/Users/demo/mon-outil");

  // Nom de dossier invalide : refusé avant de lancer quoi que ce soit.
  await d.getByRole("textbox", { name: "Nom du dossier" }).fill("a/b");
  await expect(d.getByRole("alert")).toHaveText("Nom de dossier invalide.");
  await expect(d.getByRole("button", { name: "Cloner" })).toBeDisabled();
  await d.getByRole("textbox", { name: "Nom du dossier" }).fill("outil");

  await d.getByRole("button", { name: "Cloner" }).click();
  await expect(d.getByRole("status")).toBeVisible();
  await expect(tab(page, "outil")).toHaveAttribute("aria-selected", "true");
  await expect(dialog(page)).toHaveCount(0);

  // Le dossier est retenu pour le prochain clone.
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "{}").settings);
  expect(settings.cloneDir).toBe("C:/Users/demo");
});

test("cloner par URL : erreur affichée, la fenêtre reste ouverte", async ({ page }) => {
  await openClone(page);
  const d = dialog(page);
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill("git@github.com:octo/introuvable.git");
  await d.getByRole("button", { name: "Cloner" }).click();
  await expect(d.getByRole("alert")).toContainText("introuvable");
  await expect(d.getByRole("button", { name: "Cloner" })).toBeEnabled();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("arrêter un clone en cours", async ({ page }) => {
  await openClone(page);
  const d = dialog(page);
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill("https://github.com/octo/gros-depot.git");
  await d.getByRole("button", { name: "Cloner" }).click();
  // Pendant le clone, Échap ne ferme pas la fenêtre.
  await page.keyboard.press("Escape");
  await d.getByRole("button", { name: "Arrêter" }).click();
  await expect(d.getByRole("alert")).toHaveText("Clone arrêté : rien n’a été gardé.");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await d.getByRole("button", { name: "Retour" }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("sans compte connecté, l'onglet « Depuis un compte » renvoie vers les profils", async ({ page }) => {
  await openClone(page);
  await dialog(page).getByRole("radio", { name: "Depuis un compte" }).click();
  await expect(dialog(page)).toContainText("Aucun compte GitHub / GitLab connecté");
  await dialog(page).getByRole("button", { name: "Gérer les comptes…" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Profils" })).toBeVisible();
});

test("cloner depuis un compte : liste filtrable, ssh ou https, profil du compte", async ({ page }) => {
  await seedProfiles(page);
  await openClone(page);
  const d = dialog(page);
  await d.getByRole("radio", { name: "Depuis un compte" }).click();

  // Arbre à une tabulation : propriétaires, puis leurs dépôts.
  const list = d.getByRole("tree", { name: "Dépôts du compte" });
  const repos = list.locator('[role="treeitem"][aria-level="2"]');
  await expect(repos).toHaveCount(6);
  // Rangés par propriétaire : le compte d'abord, puis ses organisations.
  await expect(list.locator(".clone-owner-name")).toHaveText(["octo-demo", "acme"]);
  // Une organisation qui n'a pas approuvé l'application : nommée, avec quoi faire.
  await expect(d.locator(".clone-restricted")).toContainText("Les dépôts de l’organisation acme-fermee n’apparaissent pas : elle n’a pas approuvé l’application GitGR.");
  const acme = list.getByRole("treeitem", { name: /^acme, / });
  await expect(acme.locator('[role="treeitem"]')).toHaveCount(3);
  // Une section se replie ; une recherche montre ses dépôts quand même.
  await acme.locator(".clone-owner").click();
  await expect(acme).toHaveAttribute("aria-expanded", "false");
  await expect(repos).toHaveCount(3);
  // Au clavier : Fin va au dernier propriétaire, → le déplie.
  await list.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(acme).toHaveAttribute("aria-expanded", "true");
  await d.getByRole("textbox", { name: "Rechercher un dépôt" }).fill("acme front");
  await expect(repos).toHaveCount(1);
  // Entrée dans la recherche choisit le premier dépôt trouvé, sans lancer le clone.
  await d.getByRole("textbox", { name: "Rechercher un dépôt" }).press("Enter");
  await expect(acme.getByRole("treeitem", { name: /^front/ })).toHaveAttribute("aria-selected", "true");

  // Le profil « Perso » a une clé SSH : URL ssh d'office ; HTTPS au choix.
  await expect(d).toContainText("git@github.com:acme/front.git");
  await d.getByRole("radio", { name: "HTTPS" }).click();
  await expect(d).toContainText("https://github.com/acme/front.git");
  await expect(d.getByRole("textbox", { name: "Nom du dossier" })).toHaveValue("front");
  await expect(picker(page, "Profil").locator(".picker-text")).toHaveText("Perso (proposé)");

  // Autre compte : sa liste, et son profil (sans clé : https d'office).
  await choose(page, "Compte", "GitLab · camille · gitlab.exemple.fr (Boulot)");
  // Le menu fermé, la fenêtre reste ouverte.
  await expect(d).toBeVisible();
  await d.getByRole("textbox", { name: "Rechercher un dépôt" }).fill("");
  await list.getByRole("treeitem", { name: /^camille/ }).getByRole("treeitem", { name: /^dotfiles/ }).click();
  await expect(d).toContainText("https://gitlab.exemple.fr/camille/dotfiles.git");
  await expect(picker(page, "Profil").locator(".picker-text")).toHaveText("Boulot (proposé)");

  await d.getByRole("button", { name: "Cloner" }).click();
  await expect(tab(page, "dotfiles")).toHaveAttribute("aria-selected", "true");
  // Le profil choisi est celui du dépôt cloné.
  const bindings = await page.evaluate(() => JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "{}").repoProfiles);
  expect(bindings["C:/Users/demo/dotfiles"].active).toBe("p-boulot");
  await homeButton(page).click();
});

test("cloner par URL : profil proposé d'après les règles, modifiable", async ({ page }) => {
  await seedProfiles(page);
  await openClone(page);
  const d = dialog(page);
  const profile = picker(page, "Profil");
  await expect(profile.locator(".picker-text")).toHaveText("Aucun profil (configuration Git)");
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill("git@gitlab.exemple.fr:equipe/api.git");
  await expect(profile.locator(".picker-text")).toHaveText("Boulot (proposé)");
  // Échap ferme le menu, pas la fenêtre.
  await profile.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(d).toBeVisible();
  await choose(page, "Profil", "Aucun profil (configuration Git)");
  // Un choix fait à la main ne suit plus l'URL.
  await d.getByRole("textbox", { name: "URL du dépôt" }).fill("git@github.com:octo/api.git");
  await expect(profile.locator(".picker-text")).toHaveText("Aucun profil (configuration Git)");
});
