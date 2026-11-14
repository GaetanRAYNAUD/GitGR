import { defineConfig } from "@playwright/test";

// Tests sur la **vraie app** (Rust compilé + WebView2), pilotée par CDP : voir app.ts.
// Windows uniquement (WebKitGTK, sous Linux, n'expose pas CDP). Lancés par `npm run test:app`,
// qui compile d'abord le binaire de debug ; celui-ci charge l'interface depuis Vite (port 1420).
export default defineConfig({
  testDir: ".",
  // Une seule app à la fois : chaque test lance la sienne, sur son propre port CDP.
  workers: 1,
  timeout: process.env.CI ? 150_000 : 60_000,
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
