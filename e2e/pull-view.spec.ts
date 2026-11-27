import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Dépôt simulé « GitGR » : origin sur gitlab.exemple.fr. Backend simulé : src/lib/mockPulls.ts
// (!12 de camille.dupont, à relire par max ; !13 de max, à relire par camille.dupont, prête à
// fusionner ; !14 brouillon d'un fork).

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Branches et tags" });
const pulls = (page: Page) => sidebar(page).locator(".pulls-group");
const item = (page: Page, ref: string) => pulls(page).locator(".pull-item", { hasText: ref });
const view = (page: Page) => page.locator(".pull-view");
const actions = (page: Page) => page.evaluate(() => (window as unknown as { __mockPullActions: { number: number; action: { type: string } }[] }).__mockPullActions);

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const state = {
      repos: [],
      session: { openTabs: [], active: null },
      settings: { theme: "system", language: "system" },
      profiles: [
        {
          id: "p-boulot",
          name: "Boulot",
          userName: "Demo",
          userEmail: "demo@boulot.fr",
          sshKey: null,
          rules: ["gitlab.exemple.fr"],
          color: 1,
          accounts: [{ id: "gitlab|https://gitlab.exemple.fr|camille.dupont", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille.dupont", name: null }],
        },
      ],
    };
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  });
  await page.reload();
  await openNextRepo(page, "GitGR");
}

test("section Merge requests : filtres, étiquettes des branches, vue de suivi", async ({ page }) => {
  await seed(page);
  await expect(pulls(page).locator(".section-name")).toHaveText("Merge requests");
  await expect(pulls(page).locator(".pull-item")).toHaveCount(3);
  await pulls(page).getByRole("button", { name: "Les miennes" }).click();
  await expect(pulls(page).locator(".pull-item")).toHaveCount(1);
  await expect(item(page, "!12")).toBeVisible();
  await pulls(page).getByRole("button", { name: "À relire" }).click();
  await expect(pulls(page).locator(".pull-item")).toHaveCount(1);
  await expect(item(page, "!13")).toBeVisible();
  await pulls(page).getByRole("button", { name: "Ouvertes" }).click();

  // La branche de la MR porte son numéro (barre latérale et graphe) ; un clic ouvre la vue.
  await expect(page.locator(".chip .chip-pull", { hasText: "!12" })).toBeVisible();
  await sidebar(page).locator(".side-pull", { hasText: "!12" }).first().click();
  await expect(view(page).locator(".pull-view-title")).toHaveText("Rendu du graphe sur canvas");
  await expect(view(page).getByText("Approbations requises manquantes.")).toBeVisible();
  await expect(view(page).getByRole("button", { name: /^Merger$/ }).last()).toBeDisabled();
  // Description en Markdown : commentaire du modèle masqué, titre, gras, code, cases, lien.
  const desc = view(page).locator(".pull-desc .md");
  await expect(desc).not.toContainText("Décrivez le changement");
  await expect(desc.getByRole("heading", { name: "Contexte" })).toBeVisible();
  await expect(desc.locator("strong")).toHaveText("canvas");
  await expect(desc.locator("p code")).toHaveText("drawVisible");
  await expect(desc.locator("pre code")).toHaveText("ctx.drawImage(lane, 0, y);");
  await expect(desc.getByRole("checkbox")).toHaveCount(2);
  await expect(desc.getByRole("checkbox").first()).toBeChecked();
  await expect(desc.getByRole("link", { name: "la doc" })).toHaveAttribute("href", "https://example.com/canvas");

  // Réponse à un fil sur le code, puis résolution.
  await view(page).getByRole("button", { name: "Répondre" }).click();
  await view(page).getByRole("textbox", { name: "Répondre" }).fill("Pour rester lisible.");
  // Échap pendant la saisie ne ferme pas la vue.
  await view(page).getByRole("textbox", { name: "Répondre" }).press("Escape");
  await expect(view(page)).toBeVisible();
  await view(page).locator(".pull-reply").getByRole("button", { name: "Répondre" }).click();
  await expect(view(page).locator(".pull-text").getByText("Pour rester lisible.")).toBeVisible();
  await view(page).getByRole("button", { name: "Résoudre le fil" }).click();
  await expect(view(page).getByText("résolu")).toBeVisible();

  // Fichiers : liste lue en local, diff avec le nombre de lignes ajoutées / supprimées.
  await view(page).getByRole("tab", { name: "Fichiers" }).click();
  await view(page).locator(".pull-file-list .file-row").first().click();
  await expect(view(page).locator(".pull-file-diff .diff-stats")).toHaveText(/\+\d+−\d+/);
  // Clic droit sur un fichier (liste ou en-tête du diff) : le menu des fichiers.
  await view(page).locator(".pull-file-list .file-row").first().click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Copier le chemin", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await view(page).locator(".pull-file-diff .diff-path").click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Montrer dans le dossier" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Checks : 1 réussi sur 2, dans le titre de l'onglet.
  await expect(view(page).getByRole("tab", { name: /Checks/ })).toContainText("1/3");
  await view(page).getByRole("tab", { name: /Checks/ }).click();
  // Groupés par état : en cours ouvert, réussis repliés.
  await expect(view(page).locator(".checks-total")).toHaveText("1 / 3 réussis");
  await expect(view(page).locator(".checks-row")).toHaveCount(2);
  await expect(view(page).locator(".check-spinner")).toHaveCount(1);
  await view(page).getByRole("button", { name: "Réussis (1)" }).click();
  await expect(view(page).locator(".checks-row")).toHaveCount(3);
  // Relancer les jobs en échec : le check repasse en cours.
  await view(page).getByRole("button", { name: "Relancer les jobs en échec" }).click();
  await expect(view(page).locator(".check-spinner")).toHaveCount(2);
  await expect(view(page).getByRole("button", { name: "Relancer les jobs en échec" })).toHaveCount(0);

  // Échap revient au graphe.
  await page.keyboard.press("Escape");
  await expect(view(page)).toHaveCount(0);
  expect((await actions(page)).map((a) => a.action.type)).toEqual(["reply", "resolve", "retryFailed"]);
});

test("relire puis fusionner après confirmation ; la MR quitte la liste", async ({ page }) => {
  await seed(page);
  await item(page, "!13").click();
  await expect(view(page).getByText("Prête à être fusionnée.")).toBeVisible();
  await view(page).getByRole("textbox", { name: "Commenter" }).fill("Bon pour moi");
  await view(page).getByRole("button", { name: "Approuver" }).click();
  await expect(view(page).locator(".pull-reviews")).toContainText("Camille Dupont");
  await expect(view(page).getByRole("button", { name: "Retirer mon approbation" })).toBeVisible();

  await view(page).getByLabel("Mode de fusion").selectOption("squash");
  await view(page).getByRole("button", { name: "Squash et merger" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Fusionner la merge request !13 ?" });
  await expect(confirm).toBeVisible();
  // Retour : rien n'est envoyé.
  await confirm.getByRole("button", { name: "Retour" }).click();
  expect((await actions(page)).map((a) => a.action.type)).toEqual(["review"]);

  await view(page).getByRole("button", { name: "Squash et merger" }).click();
  await confirm.getByRole("button", { name: "Squash et merger" }).click();
  await expect(view(page).locator(".pull-state")).toHaveText("Fusionnée");
  await expect(pulls(page).locator(".pull-item")).toHaveCount(2);
  const merge = (await actions(page)).find((a) => a.action.type === "merge");
  expect(merge).toEqual({ number: 13, action: { type: "merge", method: "squash", deleteBranch: true, auto: false } });
});

test("fermer une MR demande confirmation ; brouillon d'un fork sans droits", async ({ page }) => {
  await seed(page);
  await item(page, "!12").click();
  await view(page).getByRole("button", { name: "Fermer la merge request" }).click();
  await page.getByRole("alertdialog", { name: "Fermer la merge request !12 ?" }).getByRole("button", { name: "Fermer la merge request" }).click();
  await expect(view(page).locator(".pull-state")).toHaveText("Fermée");
  await expect(view(page).getByRole("button", { name: "Rouvrir la merge request" })).toBeVisible();

  await item(page, "!14").click();
  await expect(view(page).locator(".pull-view-meta")).toContainText("fork");
  await expect(view(page).getByText("C’est un brouillon : marquez-la comme prête d’abord.")).toBeVisible();
  // Pas de droits : ni brouillon ni fermeture proposés.
  await expect(view(page).getByRole("button", { name: "Marquer comme prête" })).toHaveCount(0);
});

test("modifier la MR après sa création : titre, description, relecteurs, étiquettes", async ({ page }) => {
  await seed(page);
  await item(page, "!12").click();
  await view(page).getByRole("button", { name: "Modifier" }).click();
  await view(page).getByLabel("Titre").fill("Rendu du graphe (canvas)");
  await view(page).getByLabel("Description").fill("Nouvelle description");
  const reviewers = view(page).getByRole("combobox", { name: "Relecteurs" });
  await reviewers.fill("dev-007");
  // La recherche répond après un délai : Entrée choisit la première option une fois là.
  await expect(view(page).getByRole("option", { name: /dev-007/ }).first()).toBeVisible();
  await reviewers.press("Enter");
  await view(page).locator(".mpick-chip", { hasText: "enhancement" }).getByRole("button").click();
  await view(page).getByRole("button", { name: "Enregistrer" }).click();
  await expect(view(page).locator(".pull-view-title")).toHaveText("Rendu du graphe (canvas)");
  await expect(view(page).getByText("Nouvelle description")).toBeVisible();
  await expect(item(page, "!12")).toContainText("Rendu du graphe (canvas)");
  const edit = (await actions(page)).at(-1)?.action as unknown as { type: string; reviewers: { login: string }[]; labels: string[] };
  expect(edit.type).toBe("edit");
  expect(edit.reviewers.map((r) => r.login)).toEqual(["max", "dev-007"]);
  expect(edit.labels).toEqual([]);
});
test("section Merge requests décochée : rien n'est lu d'office, relu dès qu'elle est recochée", async ({ page }) => {
  await seed(page);
  await expect(pulls(page).locator(".pull-item")).toHaveCount(3);
  await sidebar(page).getByRole("button", { name: "Sections affichées" }).click();
  await page.getByRole("dialog", { name: "Sections affichées" }).getByRole("checkbox", { name: "Merge requests" }).uncheck();
  await page.keyboard.press("Escape");

  // Au redémarrage (préférence gardée), aucune liste lue : pas d'étiquette !12 sur la branche.
  await page.reload();
  await expect(page.locator(".commit-row").first()).toBeVisible();
  await expect(pulls(page)).toHaveCount(0);
  // Laisse au backend simulé le temps de répondre s'il avait été appelé.
  await page.waitForTimeout(500);
  await expect(page.locator(".chip .chip-pull")).toHaveCount(0);

  await sidebar(page).getByRole("button", { name: "Sections affichées" }).click();
  await page.getByRole("dialog", { name: "Sections affichées" }).getByRole("checkbox", { name: "Merge requests" }).check();
  await expect(pulls(page).locator(".pull-item")).toHaveCount(3);
  await expect(page.locator(".chip .chip-pull", { hasText: "!12" })).toBeVisible();
});

test("liens d'un message de commit : !12 ouvre la MR dans GitGR, un SHA sélectionne le commit", async ({ page }) => {
  await seed(page);
  const graph = page.getByRole("listbox", { name: "Historique des commits" });
  const details = page.getByRole("complementary", { name: "Détails du commit" });
  await graph.getByRole("option").nth(1).click();
  const body = details.locator(".details-body");
  // Le parent, cité par son SHA court : sélectionné au clic.
  const parent = body.locator(".commit-link").filter({ hasText: /^[0-9a-f]{8}$/ });
  const short = (await parent.textContent())!;
  await parent.click();
  await expect(details.locator(".sha-line .mono")).toHaveText(new RegExp(`^${short}`));
  // Le focus suit : titre du commit atteint.
  await expect(details.locator("h2.details-subject")).toBeFocused();

  await details.locator(".details-body .commit-link", { hasText: "!12" }).click();
  await expect(view(page).locator(".pull-view-title")).toHaveText("Rendu du graphe sur canvas");
  // Même chose dans la description d'une MR : !13 ouvre l'autre MR.
  await view(page).locator(".pull-text .commit-link", { hasText: "!13" }).click();
  await expect(view(page).locator(".pull-view-title")).toHaveText("Corriger la phrase de passe de l'agent SSH");
});
