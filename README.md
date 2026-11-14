# GitGR

Client Git de bureau visuel, léger et fluide — multi-profils, multi-dépôts — pour Windows et Linux.

> En cours de développement. Notes de cadrage : [docs/NOTES.md](docs/NOTES.md).

## Stack

- [Tauri 2](https://tauri.app) (Rust) pour l'application et l'accès à Git
- React + TypeScript (Vite) pour l'interface
- i18n (FR / EN) avec i18next, thème clair / sombre / système

## Prérequis

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) (stable)
- **Windows** : Microsoft C++ Build Tools (charge de travail « Développement Desktop en C++ ») et WebView2 (déjà présent sur Windows 10/11)
- **Linux** : les paquets système listés dans les [prérequis Tauri](https://tauri.app/start/prerequisites/#linux)
- Git installé (GitGR le détecte au démarrage)

## Développement

```bash
npm install
npm run tauri dev     # application complète (Rust + interface)
npm run dev           # interface seule dans le navigateur, avec un backend simulé
```

## Tests

| Commande | Quoi | Outil |
|---|---|---|
| `npm test` | tests unitaires de l'interface (store, utilitaires, composants) | Vitest + Testing Library |
| `npm run test:rust` | tests unitaires du backend, dont des tests sur de vrais dépôts Git temporaires | `cargo test` |
| `npm run test:e2e` | parcours utilisateur dans un vrai navigateur, backend simulé | Playwright |
| `npm run test:all` | typage + les trois suites | |

Avant le premier `test:e2e`, installer le navigateur de Playwright :

```bash
npx playwright install chromium
```

Les tests Rust ont besoin de `git` dans le PATH. Les tests E2E démarrent Vite eux-mêmes, ou réutilisent celui de `npm run tauri dev` s'il tourne déjà.

## Structure

```
src/                 interface React
  components/        barre de titre, réglages, icônes…
  components/graph/  graphe des commits, détails, diff, barre latérale des branches
  views/             écrans (accueil, dépôt)
  store/             état global (zustand) : app.ts (onglets, réglages), graph.ts (historique)
  lib/api.ts         façade vers le backend (Tauri ou simulé)
  i18n/              traductions
  **/*.test.ts(x)    tests unitaires, à côté du code testé
e2e/                 tests E2E Playwright
src-tauri/src/       backend Rust (tests dans un module `tests` en bas de chaque fichier)
  git.rs             appels au binaire git
  history.rs         historique : log, refs, détails d'un commit, diff
  store.rs           état persistant (dépôts, onglets, réglages)
  commands.rs        commandes exposées à l'interface
```

## Windows : avertissement SmartScreen

Les binaires ne sont pas signés (projet open source sans certificat payant). Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Licence

[MIT](LICENSE)
