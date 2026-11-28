import { defineConfig, devices } from "@playwright/test";

// Tests E2E de l'interface, servie par Vite avec le backend simulé (lib/api.ts).
// Ils couvrent les parcours utilisateur ; le backend Rust a ses propres tests (`cargo test`).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // En CI, tous les cœurs du runner (Playwright n'en prend que la moitié par défaut).
  workers: process.env.CI ? "100%" : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1420",
    locale: "fr-FR",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    // Réutilise le serveur de `npm run tauri dev` s'il tourne déjà.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
