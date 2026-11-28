// Worktrees dans la vraie app : `git worktree` sur un dépôt temporaire.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, git, launchApp, test } from "./app";

test("worktree : créé depuis une branche et ouvert dans un onglet ; checkout refusé ailleurs ; suppression forcée", async ({ sandbox }) => {
  const mine = sandbox.clone("mine");
  git(mine, "branch", "sujet");

  const app = await launchApp(sandbox, [mine]);
  try {
    const { page } = app;
    const sidebar = page.getByRole("navigation", { name: "Branches et tags" });
    const locals = sidebar.locator(".side-group").first();
    await locals.getByRole("treeitem", { name: /^sujet/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Créer un worktree…" }).click();
    const dialog = page.getByRole("dialog", { name: "Nouveau worktree" });
    const dir = await dialog.getByLabel("Dossier").inputValue();
    expect(dir).toMatch(/mine-sujet$/);
    await dialog.getByRole("button", { name: "Créer" }).click();

    // Ouvert dans un onglet : la branche sujet y est extraite.
    await expect(page.getByRole("tab", { name: /mine-sujet/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".branch-chip-label")).toHaveText("sujet");
    expect(git(dir, "branch", "--show-current")).toBe("sujet");

    // Retour au dépôt principal : sa section Worktrees, et un checkout de sujet refusé avec
    // de quoi ouvrir le worktree.
    await page.getByRole("tab", { name: /^mine/ }).first().click();
    await expect(sidebar.getByRole("treeitem", { name: /^Worktrees/ })).toBeVisible();
    await locals.getByRole("treeitem", { name: /^sujet/ }).dblclick();
    await expect(page.getByText("Cette branche est déjà extraite dans un autre worktree")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ouvrir le worktree dans un onglet" })).toBeVisible();

    // Verrouillé puis déverrouillé : git le note avec sa raison.
    const item = sidebar.getByRole("treeitem", { name: /^sujet/ }).last();
    await item.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Verrouiller…" }).click();
    const lock = page.getByRole("dialog", { name: /^Verrouiller le worktree/ });
    await lock.getByLabel("Raison (facultative)").fill("disque USB");
    await lock.getByRole("button", { name: "Verrouiller" }).click();
    await expect(item).toContainText("verrouillé");
    expect(git(mine, "worktree", "list", "--porcelain")).toContain("locked disque USB");
    await item.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Déverrouiller" }).click();
    await expect(item).not.toContainText("verrouillé");
    expect(git(mine, "worktree", "list", "--porcelain")).not.toContain("locked");

    // Une modification dans le worktree : la suppression demande confirmation deux fois.
    writeFileSync(join(dir, "neuf.txt"), "x");
    await item.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Supprimer le worktree…" }).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await page.getByRole("button", { name: "Supprimer quand même" }).click();
    await expect(sidebar.getByRole("treeitem", { name: /^Worktrees/ })).toHaveCount(0);
    expect(existsSync(dir)).toBe(false);
    // L'onglet du worktree supprimé est fermé.
    await expect(page.getByRole("tab", { name: /mine-sujet/ })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
