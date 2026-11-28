import { defineConfig } from "@playwright/test";

// Tests sur la **vraie app** (Rust compilé + WebView2), pilotée par CDP : voir app.ts.
// Windows uniquement (WebKitGTK, sous Linux, n'expose pas CDP). Lancés par `npm run test:app`,
// qui compile d'abord le binaire de debug ; celui-ci charge l'interface depuis Vite (port 1420).
export default defineConfig({
  testDir: ".",
  // Chaque test lance sa propre app (config, profil WebView2 et dépôts isolés), sur un port CDP
  // propre à son worker : plusieurs apps à la fois. 3 en CI (runner Windows à 4 cœurs, un job
  // unique car son nom est un check requis). `GITGR_APP_WORKERS` pour forcer (1 : en série).
  workers: Number(process.env.GITGR_APP_WORKERS) || (process.env.CI ? 3 : 4),
  fullyParallel: true,
  // En CI, un lancement de WebView2 raté sur le runner chargé (« Interface absente après
  // 90 s ») ne doit pas faire échouer la PR : un second essai, signalé comme instable.
  retries: process.env.CI ? 1 : 0,
  timeout: process.env.CI ? 150_000 : 60_000,
  // Sur un runner chargé, un push suivi de la relecture du dépôt peut dépasser les 5 s par
  // défaut : le message « poussée » arrivait trop tard (échec intermittent sur main).
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  // En CI, les échecs deviennent aussi des annotations de la PR (lisibles sans connexion).
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "off" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
