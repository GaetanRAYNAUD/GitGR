import { expect, test, type Page } from "@playwright/test";
import { openRepos, tab } from "./fixtures";

// Dépôts simulés : remote `gitlab.exemple.fr` ; « api-backend » est dans C:/Users/demo/work
// et a des modifications en cours (zone de commit visible). Dossier personnel : C:/Users/demo.

const page$ = (page: Page) => page.locator(".profiles-page");
const commitPill = (page: Page) => page.locator(".commit-profile");
const statusPill = (page: Page) => page.locator(".status-profile");

async function openProfiles(page: Page) {
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Gérer les profils…" }).click();
  await expect(page$(page).getByRole("heading", { name: "Profils" })).toBeVisible();
}

/** Crée le profil « Boulot » (règle : dossier ~/work) et l'enregistre. */
async function createBoulot(page: Page) {
  await openProfiles(page);
  await page$(page).getByRole("button", { name: "Nouveau profil" }).first().click();
  await page.getByLabel("Nom du profil").fill("Boulot");
  await page.getByLabel("Nom (user.name)").fill("Camille Dupont");
  await page.getByLabel("E-mail (user.email)").fill("camille@boulot.fr");
  await page.getByLabel("Nouvelle règle").fill("~/work/*");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openRepos(page, 2);
  await expect(tab(page, "api-backend")).toHaveAttribute("aria-selected", "true");
});

test("créer un profil : champs vérifiés, puis choisi d'office pour les dépôts de son dossier", async ({ page }) => {
  await expect(commitPill(page)).toHaveText("Config Git");
  await openProfiles(page);
  await expect(page$(page)).toContainText("Aucun profil pour l’instant.");
  await page$(page).getByRole("button", { name: "Nouveau profil" }).first().click();

  // Identité incomplète : refusée, avec les champs en cause.
  await page.getByLabel("Nom du profil").fill("Boulot");
  await page.getByLabel("E-mail (user.email)").fill("pas-une-adresse");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByLabel("Nom (user.name)")).toHaveAttribute("aria-invalid", "true");
  await expect(page$(page)).toContainText("Adresse e-mail invalide.");

  await page.getByLabel("Nom (user.name)").fill("Camille Dupont");
  await page.getByLabel("E-mail (user.email)").fill("camille@boulot.fr");
  await page.getByLabel("Nouvelle règle").fill("~/work/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await expect(page$(page).getByRole("listitem").filter({ hasText: "~/work/*" })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  // api-backend (dans ~/work) le reçoit, pas GitGR.
  await expect(page$(page).getByRole("button", { name: /Boulot/ })).toContainText("1 dépôt");
  const repos = page$(page).getByRole("region", { name: "Dépôts associés" });
  await expect(repos).toContainText("api-backend");
  await expect(repos).toContainText("profil actif");
  await expect(repos).not.toContainText("GitGR");

  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(commitPill(page)).toHaveText("Boulot");
  await expect(commitPill(page)).toHaveAttribute("title", /Camille Dupont · camille@boulot\.fr/);
  await expect(statusPill(page)).toHaveText("Boulot");
  await tab(page, "GitGR").click();
  await expect(statusPill(page)).toHaveText("Config Git");

  // Conservé au redémarrage.
  await page.reload();
  await expect(statusPill(page)).toHaveText("Config Git");
  await tab(page, "api-backend").click();
  await expect(statusPill(page)).toHaveText("Boulot");
});

test("changer de profil depuis la zone de commit", async ({ page }) => {
  await createBoulot(page);
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(commitPill(page)).toHaveText("Boulot");

  await commitPill(page).click();
  await page.getByRole("menuitemradio", { name: "Aucun profil (configuration Git)" }).click();
  await expect(commitPill(page)).toHaveText("Config Git");
  await expect(statusPill(page)).toHaveText("Config Git");

  await statusPill(page).click();
  await expect(page.getByRole("menuitem", { name: "Écrire l’identité dans .git/config" })).toBeDisabled();
  await page.getByRole("menuitemradio", { name: "Boulot · camille@boulot.fr" }).click();
  await expect(commitPill(page)).toHaveText("Boulot");

  // « Gérer les profils… » ouvre la page sur le profil actif.
  await commitPill(page).click();
  await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
  await expect(page.getByLabel("Nom du profil")).toHaveValue("Boulot");
});

test("générer une clé SSH pour le profil", async ({ page }) => {
  await createBoulot(page);
  await expect(page$(page)).toContainText("Aucune : SSH utilise sa configuration habituelle");
  await page.getByRole("button", { name: "Générer une clé ed25519…" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle clé SSH" });
  await expect(dialog).toContainText("commentaire : camille@boulot.fr");
  await expect(dialog.getByRole("textbox")).toHaveValue("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await dialog.getByRole("button", { name: "Générer" }).click();

  await expect(page.getByLabel("Fichier de clé privée")).toHaveValue("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await expect(page$(page)).toContainText("ED25519 · SHA256:");
  await expect(page.getByRole("button", { name: "Copier la clé publique" })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

  // Une clé existante n'est jamais écrasée.
  await page.getByRole("button", { name: "Générer une clé ed25519…" }).click();
  await page.getByRole("dialog", { name: "Nouvelle clé SSH" }).getByRole("button", { name: "Générer" }).click();
  await expect(page.getByRole("alert")).toContainText("Un fichier porte déjà ce nom");
});

test("règle sur une organisation / un groupe du remote", async ({ page }) => {
  // Remote simulé : git@gitlab.exemple.fr:demo/<dépôt>.git
  await openProfiles(page);
  await page$(page).getByRole("button", { name: "Nouveau profil" }).first().click();
  await page.getByLabel("Nom du profil").fill("Demo");
  await page.getByLabel("Nom (user.name)").fill("Camille Demo");
  await page.getByLabel("E-mail (user.email)").fill("camille@demo.fr");
  await page.getByLabel("Nouvelle règle").fill("gitlab.exemple.fr/autre-groupe/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page$(page).getByRole("button", { name: /Demo/ })).toContainText("aucun dépôt");

  await page.getByRole("button", { name: "Retirer gitlab.exemple.fr/autre-groupe/*" }).click();
  await page.getByLabel("Nouvelle règle").fill("https://www.gitlab.exemple.fr/demo/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page$(page).getByRole("button", { name: /Demo/ })).toContainText("2 dépôts");
});

test("image du profil : affichée à la place des initiales, retirable", async ({ page }) => {
  await createBoulot(page);
  // PNG de 2×1 px.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGAAm8gP9CtIkSQAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("Choisir une image…").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".pf-head img.pf-avatar")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(statusPill(page).locator("img")).toBeVisible();

  // Un fichier qui n'est pas une image est refusé.
  await statusPill(page).click();
  await page.getByRole("menuitem", { name: "Gérer les profils…" }).click();
  await page.getByLabel("Choisir une image…").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert")).toContainText("Image illisible");
  await page.getByRole("button", { name: "Retirer l’image" }).click();
  await expect(page.locator(".pf-head img")).toHaveCount(0);
  await expect(page.locator(".pf-head .pf-avatar")).toHaveText("B");
});

test("une clé introuvable ou protégée par une phrase de passe est signalée", async ({ page }) => {
  await createBoulot(page);
  const key = page.getByLabel("Fichier de clé privée");
  await key.fill("C:/Users/demo/.ssh/absente");
  await expect(page$(page).getByRole("alert")).toHaveText("Fichier de clé introuvable.");
  await key.fill("C:/Users/demo/.ssh/locked_ed25519");
  await expect(page$(page)).toContainText("Protégée par une phrase de passe : enregistrez-la");

  // Phrase de passe : vérifiée (une mauvaise est refusée), puis rangée dans le trousseau.
  await page.getByRole("button", { name: "Enregistrer la phrase de passe…" }).click();
  let dialog = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
  await dialog.locator("input[type=password]").fill("mauvaise");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("alert")).toContainText("Phrase de passe incorrecte");
  await page.getByRole("button", { name: "Enregistrer la phrase de passe…" }).click();
  dialog = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
  await dialog.locator("input[type=password]").fill("secret");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page$(page)).toContainText("Phrase de passe dans le trousseau du système.");

  await page.getByRole("button", { name: "Oublier la phrase de passe" }).click();
  await expect(page$(page)).toContainText("Protégée par une phrase de passe : enregistrez-la");
});

test("générer une clé protégée par une phrase de passe", async ({ page }) => {
  await createBoulot(page);
  await page.getByRole("button", { name: "Générer une clé ed25519…" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle clé SSH" });
  await dialog.getByRole("checkbox", { name: /Protéger la clé par une phrase de passe/ }).check();
  await dialog.getByRole("button", { name: "Générer" }).click();
  const pass = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
  await expect(pass).toContainText("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await pass.locator("input[type=password]").fill("ma phrase");
  await pass.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByLabel("Fichier de clé privée")).toHaveValue("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await expect(page$(page)).toContainText("Phrase de passe dans le trousseau du système.");
});

test("modifications non enregistrées : confirmation avant de quitter, puis suppression du profil", async ({ page }) => {
  await createBoulot(page);
  await page.getByLabel("Nom du profil").fill("Boulot 2");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Abandonner les modifications ?" });
  await confirm.getByRole("button", { name: "Retour" }).click();
  await expect(page.getByLabel("Nom du profil")).toHaveValue("Boulot 2");

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByLabel("Nom du profil")).toHaveValue("Boulot");

  await page.getByRole("button", { name: "Supprimer" }).click();
  const del = page.getByRole("alertdialog", { name: "Supprimer le profil « Boulot » ?" });
  await expect(del).toContainText("Le dépôt qui l’utilise repassera sur la configuration Git.");
  await del.getByRole("button", { name: "Supprimer" }).click();
  await expect(page$(page)).toContainText("Aucun profil pour l’instant.");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(commitPill(page)).toHaveText("Config Git");
});
