import { expect, test, type Page } from "@playwright/test";

/** Profil « Perso » (clé SSH, signature SSH avec la même clé) et ses comptes. */
async function seed(page: Page, accounts: { login: string; kind?: "github" | "gitlab" }[], extra: Record<string, unknown> = {}) {
  await page.goto("/");
  await page.evaluate(
    ({ accounts, extra }) => {
      const state = { repos: [], session: { openTabs: [], active: null }, settings: { theme: "system", language: "system" } } as Record<string, unknown>;
      state.profiles = [
        {
          id: "p-perso",
          name: "Perso",
          userName: "Demo",
          userEmail: "demo@exemple.fr",
          sshKey: "~/.ssh/id_ed25519",
          rules: [],
          color: 0,
          signing: "ssh",
          signingKey: null,
          accounts: accounts.map(({ login, kind = "github" }) => {
            const url = kind === "github" ? "https://github.com" : "https://gitlab.exemple.fr";
            return { id: `${kind}|${url}|${login}`, kind, url, login, name: null };
          }),
          ...extra,
        },
      ];
      localStorage.setItem("gitgr.mock-state", JSON.stringify(state));
    },
    { accounts, extra },
  );
  await page.reload();
  await page.getByRole("button", { name: "Profils et comptes" }).click();
}

const keysOf = (page: Page, login: string) => page.getByRole("list", { name: `Clés du profil sur le compte ${login}` });

test("clés du profil sur le compte : absentes, ajoutées en un clic", async ({ page }) => {
  await seed(page, [{ login: "octo-demo" }]);
  const keys = keysOf(page, "octo-demo");
  await expect(keys.getByRole("listitem")).toHaveCount(2);
  const auth = keys.getByRole("listitem").filter({ hasText: "Clé SSH" }).first();
  const signing = keys.getByRole("listitem").filter({ hasText: "Clé de signature SSH" });
  await expect(auth).toContainText("absente du compte");
  await expect(auth).toContainText("SHA256:");

  await auth.getByRole("button", { name: "Ajouter au compte" }).click();
  await expect(auth).toContainText("sur le compte");
  await expect(auth.getByRole("button")).toHaveCount(0);
  await expect(signing).toContainText("absente du compte");
  await signing.getByRole("button", { name: "Ajouter au compte" }).click();
  await expect(signing).toContainText("sur le compte");
});

test("clés : droits du token insuffisants, clé déjà prise, profil modifié", async ({ page }) => {
  await seed(page, [{ login: "noscope-octo" }, { login: "camille", kind: "gitlab" }], { sshKey: "~/.ssh/ailleurs_ed25519", signing: "" });
  await expect(page.getByRole("alert").filter({ hasText: "Le token n’a pas les droits sur les clés" })).toBeVisible();

  const keys = keysOf(page, "camille");
  await expect(keys.getByRole("listitem")).toHaveCount(1);
  await keys.getByRole("button", { name: "Ajouter au compte" }).click();
  await expect(keys.getByRole("alert")).toContainText("Cette clé est déjà enregistrée");

  // Profil incomplet (pas enregistré) avec une clé modifiée : rien n'est ajouté tant qu'il ne
  // l'est pas.
  await page.getByLabel("E-mail (user.email)").fill("");
  await page.getByRole("radio", { name: "Ne pas signer" }).click();
  await expect(keys).toContainText("Complétez le profil pour vérifier ses nouvelles clés");
  await expect(keys.getByRole("button", { name: "Ajouter au compte" })).toBeDisabled();
});
