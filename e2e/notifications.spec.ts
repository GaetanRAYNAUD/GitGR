import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

// Backend simulé : src/lib/mockNotifications.ts (deux notifications par compte au départ).

const ACCOUNT = "gitlab|https://gitlab.exemple.fr|camille.dupont";
const bell = (page: Page) => page.locator(".notif-wrap > button");
const panel = (page: Page) => page.getByRole("dialog", { name: "Notifications" });

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate((account) => {
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
          accounts: [{ id: account, kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille.dupont", name: null }],
        },
      ],
    };
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  }, ACCOUNT);
  await page.reload();
}

test("cloche : badge, panneau par dépôt, ouverture de la MR dans GitGR, vu et lu", async ({ page }) => {
  await seed(page);
  await openNextRepo(page, "GitGR");
  await expect(bell(page)).toHaveAccessibleName("Notifications (2 nouvelles)");
  await bell(page).click();
  await expect(panel(page).locator(".notif-group")).toHaveText(["gitlab.exemple.fr · demo/gitgr", "gitlab.exemple.fr · demo/api-backend"]);

  // Dépôt ouvert dont origin est demo/gitgr : la MR s'ouvre dans GitGR.
  await panel(page).getByRole("button", { name: /Corriger la phrase de passe/ }).click();
  await expect(page.locator(".pull-view .pull-view-title")).toHaveText("Corriger la phrase de passe de l'agent SSH");
  await expect(bell(page)).toHaveAccessibleName("Notifications (1 nouvelle)");

  // Marquer comme lu sur GitLab : retirée de la liste.
  await bell(page).click();
  await panel(page).getByRole("button", { name: "Marquer comme lu sur GitLab" }).first().click();
  await expect(panel(page).locator(".notif-item")).toHaveCount(1);
  await panel(page).getByRole("button", { name: "Tout marquer comme vu" }).click();
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(page.locator(".notif-badge")).toHaveCount(0);
});

test("nouvelle notification : annoncée par le système ; réglages pour la couper", async ({ page }) => {
  await seed(page);
  await expect(bell(page)).toHaveAccessibleName("Notifications (2 nouvelles)");
  await page.evaluate((account) => {
    (window as unknown as { __mockAddNotification: (n: unknown) => void }).__mockAddNotification({
      id: "n9", account, kind: "gitlab", url: "https://gitlab.exemple.fr", repo: "demo/gitgr", subject: "pull", number: 12,
      title: "Rendu du graphe", reason: "ci_failed", webUrl: null, updatedAt: Math.floor(Date.now() / 1000),
    });
  }, ACCOUNT);
  await bell(page).click();
  await panel(page).getByRole("button", { name: "Actualiser" }).click();
  await expect(bell(page)).toHaveAccessibleName("Notifications (3 nouvelles)");
  const sent = await page.evaluate(() => (window as unknown as { __mockSystemNotifications: unknown[] }).__mockSystemNotifications);
  expect(sent).toEqual([{ title: "Pipeline / checks en échec", body: "demo/gitgr !12 — Rendu du graphe" }]);

  // Réglages : fréquence, notifications du système, tout couper (la cloche disparaît).
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("radiogroup", { name: "Fréquence" }).getByRole("radio", { name: "Rapide" }).click();
  await page.getByRole("checkbox", { name: "Notifications du système" }).uncheck();
  await page.getByRole("checkbox", { name: "Notifications des comptes GitHub / GitLab" }).uncheck();
  await expect(bell(page)).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Notifications du système" })).toBeDisabled();
  await expect(page.getByRole("radiogroup", { name: "Fréquence" }).getByRole("radio", { name: "Rapide" })).toBeDisabled();
});
