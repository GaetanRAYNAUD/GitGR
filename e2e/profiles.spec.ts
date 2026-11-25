import { expect, test, type Page } from "@playwright/test";
import { openRepos, tab } from "./fixtures";

// Dépôts simulés : remote `gitlab.exemple.fr` ; « api-backend » est dans C:/Users/demo/work
// et a des modifications en cours (zone de commit visible). Dossier personnel : C:/Users/demo.

const page$ = (page: Page) => page.locator(".profiles-page");
const commitPill = (page: Page) => page.locator(".commit-profile");
const statusPill = (page: Page) => page.locator(".status-profile");

/** Enregistrement automatique fait : l'état sous le nom du profil le dit. */
async function expectSaved(page: Page) {
  await expect(page.locator(".pf-head-sub")).toContainText("Enregistré");
}

/** Ouvre une sous-page du profil (sous-menu à droite de la liste). */
async function goTo(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Sections du profil" }).getByRole("button", { name }).click();
}

async function openProfiles(page: Page) {
  await page.getByRole("button", { name: "Profils et comptes" }).click();
  await expect(page$(page).getByRole("heading", { name: "Profils" })).toBeVisible();
}

/** Crée le profil « Boulot » (règle : dossier ~/work) et l'enregistre. */
async function createBoulot(page: Page) {
  await openProfiles(page);
  await page$(page).getByRole("button", { name: "Nouveau profil" }).first().click();
  await page.getByLabel("Nom du profil").fill("Boulot");
  await page.getByLabel("Nom (user.name)").fill("Camille Dupont");
  await page.getByLabel("E-mail (user.email)").fill("camille@boulot.fr");
  await goTo(page, "Dépôts");
  await page.getByLabel("Nouvelle règle").fill("~/work/*");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expectSaved(page);
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

  // Le focus est dans le nom. Identité incomplète : pas créée, les champs en cause signalés.
  await expect(page.getByLabel("Nom du profil")).toBeFocused();
  await page.getByLabel("Nom du profil").fill("Boulot");
  await page.getByLabel("E-mail (user.email)").fill("pas-une-adresse");
  await expect(page.locator(".pf-head-sub")).toContainText("Pas encore créé : 2 champs à remplir.");
  await page.locator(".pf-head-sub").getByRole("button", { name: "Voir" }).click();
  await expect(page.getByLabel("Nom (user.name)")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Nom (user.name)")).toBeFocused();
  await expect(page$(page)).toContainText("Adresse e-mail invalide.");

  await page.getByLabel("Nom (user.name)").fill("Camille Dupont");
  await page.getByLabel("E-mail (user.email)").fill("camille@boulot.fr");
  await goTo(page, "Dépôts");
  await page.getByLabel("Nouvelle règle").fill("~/work/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await expect(page$(page).getByRole("listitem").filter({ hasText: "~/work/*" })).toBeVisible();
  await expectSaved(page);

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
  await expect(page.locator(".pf-head h2")).toHaveText("Boulot");
});

test("générer une clé SSH pour le profil", async ({ page }) => {
  await createBoulot(page);
  await goTo(page, "Clé SSH");
  await expect(page$(page)).toContainText("Aucune : SSH utilise sa configuration habituelle");
  await page.getByRole("button", { name: "Générer une clé ed25519…" }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle clé SSH" });
  await expect(dialog).toContainText("commentaire : camille@boulot.fr");
  await expect(dialog.getByRole("textbox")).toHaveValue("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await dialog.getByRole("button", { name: "Générer" }).click();

  await expect(page.getByLabel("Fichier de clé privée")).toHaveValue("C:/Users/demo/.ssh/gitgr_boulot_ed25519");
  await expect(page$(page)).toContainText("ED25519 · SHA256:");
  await expect(page.getByRole("button", { name: "Copier la clé publique" })).toBeVisible();
  await expectSaved(page);

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
  await goTo(page, "Dépôts");
  await page.getByLabel("Nouvelle règle").fill("gitlab.exemple.fr/autre-groupe/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await expectSaved(page);
  await expect(page$(page).getByRole("button", { name: /Demo/ })).toContainText("aucun dépôt");
  await expect(page$(page).getByRole("listitem").filter({ hasText: "autre-groupe" })).toContainText("aucun dépôt récent");

  await page.getByRole("button", { name: "Retirer gitlab.exemple.fr/autre-groupe/*" }).click();
  await page.getByLabel("Nouvelle règle").fill("https://www.gitlab.exemple.fr/demo/*");
  await page.getByLabel("Nouvelle règle").press("Enter");
  await expectSaved(page);
  await expect(page$(page).getByRole("button", { name: /Demo/ })).toContainText("2 dépôts");
  await expect(page$(page).getByRole("listitem").filter({ hasText: "www.gitlab" })).toContainText("2 dépôts récents");

  // Exemple de règle : un clic le copie dans le champ, avec les dépôts qu'il désignerait.
  await page$(page).getByRole("button", { name: "gitlab.exemple.fr", exact: true }).click();
  await expect(page.getByLabel("Nouvelle règle")).toHaveValue("gitlab.exemple.fr");
  await expect(page$(page)).toContainText("Cette règle désigne 2 de vos dépôts récents.");
});

test("image du profil : affichée à la place des initiales, retirable", async ({ page }) => {
  await createBoulot(page);
  // PNG de 2×1 px.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGAAm8gP9CtIkSQAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("Choisir une image…").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".pf-head img.pf-avatar")).toHaveAttribute("src", /^data:image\/(webp|png);base64,/);
  await expectSaved(page);
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
  await goTo(page, "Clé SSH");
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
  await goTo(page, "Clé SSH");
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

test("enregistrement automatique ; profil incomplet : confirmation avant de quitter, puis suppression", async ({ page }) => {
  await createBoulot(page);
  await goTo(page, "Identité");
  await page.getByLabel("Nom du profil").fill("Boulot 2");
  await expectSaved(page);
  await expect(page$(page).getByRole("button", { name: /Boulot 2/ })).toBeVisible();

  // E-mail vidé : pas enregistré ; quitter demande confirmation.
  await page.getByLabel("E-mail (user.email)").fill("");
  await expect(page.locator(".pf-head-sub")).toContainText("Modifications non enregistrées : 1 champ à corriger.");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Abandonner les modifications ?" });
  await confirm.getByRole("button", { name: "Compléter" }).click();
  await expect(page.getByLabel("E-mail (user.email)")).toBeFocused();
  // Depuis une autre sous-page, « Voir » ramène à l'identité.
  await goTo(page, "Comptes");
  await page.locator(".pf-head-sub").getByRole("button", { name: "Voir" }).click();
  await expect(page.getByLabel("E-mail (user.email)")).toBeFocused();
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await confirm.getByRole("button", { name: "Abandonner" }).click();
  await openProfiles(page);
  await expect(page.getByLabel("E-mail (user.email)")).toHaveValue("camille@boulot.fr");
  await expect(page.getByLabel("Nom du profil")).toHaveValue("Boulot 2");

  await page.getByRole("button", { name: "Supprimer" }).click();
  const del = page.getByRole("alertdialog", { name: "Supprimer le profil « Boulot 2 » ?" });
  await expect(del).toContainText("Le dépôt qui l’utilise repassera sur la configuration Git.");
  await del.getByRole("button", { name: "Supprimer" }).click();
  await expect(page$(page)).toContainText("Aucun profil pour l’instant.");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(commitPill(page)).toHaveText("Config Git");
});

test("signature des commits : GPG (clé choisie dans la liste) ou SSH", async ({ page }) => {
  await createBoulot(page);
  await goTo(page, "Signature");
  const signing = page.getByRole("radiogroup", { name: "Signature des commits" });
  await expect(signing.getByRole("radio", { name: "Config Git" })).toHaveAttribute("aria-checked", "true");

  // GPG : liste des clés ; une clé dont aucune identité n'a l'e-mail du profil est signalée.
  await signing.getByRole("radio", { name: "GPG" }).click();
  const gpgKey = page.getByLabel("Clé GPG");
  await expect(gpgKey.locator("option")).toHaveText([
    "Choisie par gpg d’après l’e-mail du profil",
    "Camille Dupont <camille@boulot.fr> — 5E8B7C4CFAC5417C",
    "Demo <demo@exemple.fr> — 1111222233334444",
  ]);
  await gpgKey.selectOption("1111222233334444");
  await expect(page.locator(".profiles-page")).toContainText("Aucune identité de cette clé n’utilise l’adresse camille@boulot.fr");
  await gpgKey.selectOption("5E8B7C4CFAC5417C");
  await expect(page.locator(".profiles-page")).not.toContainText("Aucune identité de cette clé");
  await expectSaved(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "{}").profiles[0]);
  expect([saved.signing, saved.signingKey]).toEqual(["gpg", "5E8B7C4CFAC5417C"]);

  // Choix aux flèches, comme dans les réglages. SSH sans aucune clé : pas enregistré ; avec la
  // clé du profil : enregistré (clé de signature vide).
  await signing.getByRole("radio", { name: "GPG" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(signing.getByRole("radio", { name: "SSH" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".pf-head-sub")).toContainText("1 champ à corriger");
  await page.locator(".pf-head-sub").getByRole("button", { name: "Voir" }).click();
  await expect(page.locator(".profiles-page")).toContainText("Indiquez une clé de signature, ou une clé SSH pour le profil.");
  await goTo(page, "Clé SSH");
  await page.getByLabel("Fichier de clé privée").fill("C:/Users/demo/.ssh/id_ed25519");
  await goTo(page, "Signature");
  await expect(page.locator(".profiles-page")).toContainText("Vide : la clé SSH du profil est utilisée.");
  await expectSaved(page);

  // Clé de signature à part, protégée : sa phrase de passe se règle ici aussi.
  await page.getByLabel("Clé de signature SSH").fill("C:/Users/demo/.ssh/locked_ed25519");
  const section = page.getByRole("form", { name: "Signature des commits" });
  await expect(section).toContainText("Protégée par une phrase de passe : enregistrez-la");
  await section.getByRole("button", { name: "Enregistrer la phrase de passe…" }).click();
  const dialog = page.getByRole("dialog", { name: "Phrase de passe de la clé" });
  await dialog.locator("input[type=password]").fill("secret");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(section).toContainText("Phrase de passe dans le trousseau du système.");
});

test("compte provider : token refusé, compte connecté au profil, utilisé par le remote, déconnecté", async ({ page }) => {
  // Backend simulé : tout token est accepté sauf `bad…` ; le compte GitLab est `camille.dupont`.
  await createBoulot(page);
  await goTo(page, "Comptes");
  const accounts = page.getByRole("form", { name: "Comptes GitHub / GitLab" });
  await expect(accounts).toContainText("Aucun compte connecté.");

  await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
  const dialog = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });
  const submit = dialog.getByRole("button", { name: "Connecter", exact: true });
  await expect(dialog.getByRole("radio", { name: "GitHub" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("button", { name: "Créer un token sur github.com…" })).toBeVisible();
  await expect(submit).toBeDisabled();

  // Adresse d'instance invalide : signalée, rien n'est envoyé.
  await dialog.getByRole("radio", { name: "GitLab" }).click();
  await dialog.getByLabel("Instance").fill("ssh://gitlab.exemple.fr");
  await dialog.getByLabel("Token personnel").fill("bad-token");
  await expect(dialog.getByRole("alert")).toHaveText("Adresse invalide : un hôte (gitlab.exemple.fr) ou une URL http(s).");
  await expect(submit).toBeDisabled();

  // http : accepté, mais signalé (le token circulerait en clair).
  await dialog.getByLabel("Instance").fill("http://gitlab.exemple.fr");
  await expect(dialog.getByRole("note")).toContainText("Connexion non chiffrée (http)");

  // Token refusé : la fenêtre reste ouverte, avec l'erreur.
  await dialog.getByLabel("Instance").fill("gitlab.exemple.fr");
  await expect(dialog.getByRole("button", { name: "Créer un token sur gitlab.exemple.fr…" })).toBeVisible();
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText("Token refusé : il est incorrect, expiré ou révoqué.");

  await dialog.getByLabel("Token personnel").fill("glpat-demo");
  await submit.click();
  await expect(dialog).toBeHidden();
  const row = accounts.getByRole("listitem").filter({ hasText: "camille.dupont" });
  await expect(row).toContainText("gitlab.exemple.fr");
  await expect(row.getByRole("status")).toHaveText("connecté");
  // Enregistré tout de suite, et jamais de token dans l'état.
  await expectSaved(page);
  const state = await page.evaluate(() => localStorage.getItem("gitgr.mock-state") ?? "");
  expect(JSON.parse(state).profiles[0].accounts).toEqual([
    { id: "gitlab|https://gitlab.exemple.fr|camille.dupont", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille.dupont", name: null },
  ]);
  expect(state).not.toContain("glpat");

  // Une autre modification du profil, enregistrée ensuite, garde le compte.
  await goTo(page, "Identité");
  await page.getByLabel("Nom (user.name)").fill("Camille D.");
  await expectSaved(page);
  await goTo(page, "Comptes");
  await expect(row).toBeVisible();

  // Dans le dépôt (remote gitlab.exemple.fr, profil Boulot) : icône du provider et compte du remote.
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  const origin = page.locator(".refs-sidebar .section-btn").filter({ has: page.locator(".section-name", { hasText: /^origin$/ }) });
  await expect(origin.locator(".section-icon")).toHaveAttribute("data-provider", "gitlab");
  await expect(origin).toHaveAttribute("title", /Compte GitLab : camille\.dupont/);

  // Déconnexion, après confirmation.
  await openProfiles(page);
  await row.getByRole("button", { name: "Déconnecter camille.dupont" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Déconnecter" }).click();
  await expect(accounts).toContainText("Aucun compte connecté.");
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  await expect(origin).toHaveAttribute("title", /Aucun compte GitLab connecté pour ce profil/);
});

test("compte provider : pas avant d'avoir complété le profil ; token perdu signalé", async ({ page }) => {
  await openProfiles(page);
  await page$(page).getByRole("button", { name: "Nouveau profil" }).first().click();
  await goTo(page, "Comptes");
  const accounts = page.getByRole("form", { name: "Comptes GitHub / GitLab" });
  await expect(accounts).toContainText("Complétez le profil pour lui connecter un compte.");
  await expect(accounts.getByRole("button", { name: "Connecter un compte…" })).toHaveCount(0);

  await goTo(page, "Identité");
  await page.getByLabel("Nom du profil").fill("Perso");
  await page.getByLabel("Nom (user.name)").fill("Camille");
  await page.getByLabel("E-mail (user.email)").fill("camille@perso.fr");
  await expectSaved(page);
  await goTo(page, "Comptes");
  await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
  const dialog = page.getByRole("dialog", { name: "Connecter un compte au profil « Perso »" });
  // Backend simulé : `as:<login>` choisit le compte ; un compte `revoked…` a perdu son token.
  await dialog.getByLabel("Token personnel").fill("as:revoked-octo");
  await dialog.getByRole("button", { name: "Connecter", exact: true }).click();
  const row = accounts.getByRole("listitem").filter({ hasText: "revoked-octo" });
  await expect(row.getByRole("alert")).toHaveText("Token refusé : il est incorrect, expiré ou révoqué.");

  // « Reconnecter… » rouvre la fenêtre sur le même provider et la même instance ; Échap la
  // ferme sans fermer la page des profils.
  await row.getByRole("button", { name: "Reconnecter…" }).click();
  await expect(dialog.getByRole("radio", { name: "GitHub" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Instance")).toHaveValue("github.com");
  await dialog.getByRole("button", { name: "Retour" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page$(page).getByRole("heading", { name: "Profils" })).toBeVisible();
});

test("se connecter avec GitHub (OAuth) : code à saisir, puis compte connecté ; avatar du remote", async ({ page }) => {
  await createBoulot(page);
  await goTo(page, "Comptes");
  const accounts = page.getByRole("form", { name: "Comptes GitHub / GitLab" });
  await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
  const dialog = page.getByRole("dialog", { name: "Connecter un compte au profil « Boulot »" });

  // github.com seulement : pas pour GitLab ni pour GitHub Enterprise.
  await dialog.getByRole("radio", { name: "GitLab" }).click();
  await expect(dialog.getByRole("button", { name: "Se connecter avec GitHub" })).toHaveCount(0);
  await dialog.getByRole("radio", { name: "GitHub" }).click();
  await dialog.getByLabel("Instance").fill("github.entreprise.fr");
  await expect(dialog.getByRole("button", { name: "Se connecter avec GitHub" })).toHaveCount(0);
  await dialog.getByLabel("Instance").fill("");

  await dialog.getByRole("button", { name: "Se connecter avec GitHub" }).click();
  await expect(dialog.getByRole("status")).toContainText("WDJB-MJHT");
  await expect(dialog.getByRole("button", { name: "Copier le code et ouvrir GitHub" })).toBeVisible();
  // Validé sur GitHub (backend simulé : à la 4e demande) : la fenêtre se ferme, compte lié.
  await expect(dialog).toBeHidden();
  const row = accounts.getByRole("listitem").filter({ hasText: "octo-demo" }).first();
  await expect(row.getByRole("status").first()).toHaveText("connecté");
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("gitgr.mock-state") ?? "{}").profiles[0].accounts);
  expect(state.map((a: { id: string }) => a.id)).toEqual(["github|https://github.com|octo-demo"]);

  // Annuler une connexion en cours : retour au formulaire.
  await accounts.getByRole("button", { name: "Connecter un compte…" }).click();
  await dialog.getByRole("button", { name: "Se connecter avec GitHub" }).click();
  await expect(dialog.getByRole("status")).toContainText("WDJB-MJHT");
  await dialog.getByRole("button", { name: "Retour" }).click();
  await expect(dialog.getByRole("button", { name: "Se connecter avec GitHub" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Dans le dépôt : l'avatar du propriétaire du dépôt devant le remote.
  await page.getByRole("button", { name: "Fermer les profils" }).click();
  const origin = page.locator(".refs-sidebar .section-btn").filter({ has: page.locator(".section-name", { hasText: /^origin$/ }) });
  await expect(origin.locator(".remote-avatar")).toHaveAttribute("src", /^data:image\/png;base64,/);
});

test("Échap ferme la page Profils, même sans focus dans la page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Profils et comptes" }).click();
  await expect(page.locator(".profiles-page")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(page.locator(".profiles-page")).toHaveCount(0);
});
