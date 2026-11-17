// Profils dans la vraie app : l'identité du profil actif est injectée dans les commandes git.

import { expect, git, launchApp, test } from "./app";

const boulot = {
  id: "boulot",
  name: "Boulot",
  userName: "Camille Boulot",
  userEmail: "camille@boulot.fr",
  sshKey: null,
  rules: [],
  color: 1,
};

test("le commit prend l'identité du profil actif, sans toucher à la config git", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  const top = sandbox.top(mine);
  sandbox.write(mine, "b.txt", "nouveau\n");
  git(mine, "add", "b.txt");

  const app = await launchApp(sandbox, [mine], {
    profiles: [boulot],
    repoProfiles: { [top]: { active: "boulot", allowed: ["boulot"] } },
  });
  try {
    const { page } = app;
    await expect(page.locator(".commit-profile")).toHaveText("Boulot");
    await page.getByPlaceholder("Résumé").fill("commit du profil");
    await page.locator(".commit-btn").click();
    await expect.poll(() => git(mine, "log", "-1", "--format=%s")).toBe("commit du profil");
    expect(git(mine, "log", "-1", "--format=%an <%ae> / %cn <%ce>")).toBe(
      "Camille Boulot <camille@boulot.fr> / Camille Boulot <camille@boulot.fr>",
    );
    // La config du dépôt n'a pas bougé…
    expect(git(mine, "config", "--local", "user.name")).toBe("mine");

    // … jusqu'à « Écrire l'identité dans .git/config ».
    await page.locator(".status-profile").click();
    await page.getByRole("menuitem", { name: "Écrire l’identité dans .git/config" }).click();
    // Tant que la clé n'est pas écrite, `git config` échoue (code 1) : lu comme vide, et on attend.
    const localEmail = () => {
      try {
        return git(mine, "config", "--local", "user.email");
      } catch {
        return "";
      }
    };
    await expect.poll(localEmail).toBe("camille@boulot.fr");
    expect(git(mine, "config", "--local", "user.name")).toBe("Camille Boulot");
  } finally {
    await app.close();
  }
});

test("sans profil actif, la configuration git s'applique", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  sandbox.write(mine, "b.txt", "nouveau\n");
  git(mine, "add", "b.txt");

  const app = await launchApp(sandbox, [mine], { profiles: [boulot] });
  try {
    const { page } = app;
    await expect(page.locator(".commit-profile")).toHaveText("Config Git");
    await page.getByPlaceholder("Résumé").fill("commit sans profil");
    await page.locator(".commit-btn").click();
    await expect.poll(() => git(mine, "log", "-1", "--format=%s")).toBe("commit sans profil");
    expect(git(mine, "log", "-1", "--format=%an <%ae>")).toBe("mine <mine@exemple.fr>");
  } finally {
    await app.close();
  }
});
