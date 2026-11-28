import { expect, test, type Page } from "@playwright/test";
import { openNextRepo } from "./fixtures";

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
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
        accounts: [{ id: "gitlab|https://gitlab.exemple.fr|camille", kind: "gitlab", url: "https://gitlab.exemple.fr", login: "camille", name: null }],
      },
    ];
    localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
  });
  await page.reload();
  await openNextRepo(page, "GitGR");
}

test("exécutions de CI : depuis la palette, filtres, relancer un échec, depuis le menu d'une branche", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("Control+p");
  await page.getByRole("combobox").fill("exécutions");
  await page.keyboard.press("Enter");
  const view = page.getByRole("region", { name: "Exécutions de CI" });
  const list = view.getByRole("listbox", { name: "Exécutions, la plus récente d’abord" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await expect(list).toBeFocused();
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-label", "CI, En cours");

  // Filtre par workflow (deux dans la liste : CI et Nuit).
  await view.getByRole("button", { name: /^Workflow/ }).click();
  await page.getByRole("menuitemradio", { name: "Nuit" }).click();
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-label", /^Nuit/);
  await view.getByRole("button", { name: /^Workflow/ }).click();
  await page.getByRole("menuitemradio", { name: "Tous les workflows" }).click();
  await expect(list.getByRole("option")).toHaveCount(3);

  await view.getByRole("button", { name: "En échec" }).click();
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Relancer les jobs en échec" }).click();
  await expect(page.getByText("CI : jobs en échec relancés.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  const locals = page.getByRole("navigation", { name: "Branches et tags" }).locator(".side-group").first();
  await locals.getByRole("treeitem", { name: /^main( |$)/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Voir ses exécutions de CI" }).click();
  await expect(view.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await expect(view.getByRole("button", { name: /^Branche/ })).toContainText("main");
});
