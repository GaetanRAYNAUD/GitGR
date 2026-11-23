# GitGR

Client Git de bureau visuel, léger et fluide — multi-profils, multi-dépôts — pour Windows et Linux.

> En cours de développement. Guide rapide des fonctionnalités : [GUIDE.md](GUIDE.md). Notes de cadrage : [docs/NOTES.md](docs/NOTES.md).

## Présentation (textes réutilisables)

Site : https://git.gaetanraynaud.fr (à venir : page de téléchargement des installateurs).

Description courte (application OAuth GitHub, fiches de store, métadonnées des installateurs) :

- EN : *A fast, lightweight desktop Git client with a visual commit graph, multiple identities per repository and built-in GitHub / GitLab support.*
- FR : *Client Git de bureau rapide et léger : graphe des commits, plusieurs identités par dépôt, GitHub et GitLab intégrés.*

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

## Compiler l'application

Version release, à lancer à la main pour tester (la première compilation prend quelques minutes : optimisations et LTO ; les suivantes sont plus rapides) :

```bash
npm install
npm run tauri build -- --no-bundle
```

L'exécutable est dans `src-tauri/target/release/` : `gitgr.exe` sous Windows, `gitgr` sous Linux. Il se lance tel quel, sans installation.

Avec les installeurs (NSIS sous Windows ; AppImage, `.deb` et `.rpm` sous Linux ; `.app` et `.dmg` sous macOS), rangés dans `src-tauri/target/release/bundle/<format>/` :

```bash
npm run tauri build                      # tous les formats de la plateforme
npm run tauri build -- --bundles nsis    # un seul format
```

À savoir :

- L'app compilée utilise **votre vraie configuration** : dépôts récents, onglets, réglages et profils dans `state.json` (`%APPDATA%\fr.gitgr.app\` sous Windows, `~/.config/fr.gitgr.app/` sous Linux) ; les phrases de passe des clés SSH sont dans le trousseau du système. Pour tester sans y toucher, lancez-la avec un autre dossier de configuration, par exemple sous PowerShell : `$env:GITGR_CONFIG_DIR = "C:\temp\gitgr-test"; .\src-tauri\target\release\gitgr.exe`.
- Ne lancez pas directement le binaire de **debug** (`src-tauri/target/debug/`, produit par `cargo build` ou `npm run test:app`) : il charge l'interface depuis le serveur Vite (`npm run dev`) au lieu de l'embarquer.

## Tests

| Commande | Quoi | Outil |
|---|---|---|
| `npm test` | tests unitaires de l'interface (store, utilitaires, composants) | Vitest + Testing Library |
| `npm run test:rust` | tests unitaires du backend, dont des tests sur de vrais dépôts Git temporaires | `cargo test` |
| `npm run test:e2e` | parcours utilisateur dans un vrai navigateur, backend simulé | Playwright |
| `npm run test:all` | typage + les trois suites | |
| `npm run test:app` | parcours sur la **vraie app** (Rust compilé + WebView2) et de vrais dépôts temporaires — Windows uniquement | Playwright via CDP |

Avant le premier `test:e2e`, installer le navigateur de Playwright :

```bash
npx playwright install chromium
```

`test:app` compile le binaire de debug, puis chaque test lance l'app avec une config et un profil WebView2 isolés (`GITGR_CONFIG_DIR`, dossier temporaire) : vos dépôts et votre `state.json` ne sont jamais touchés. Voir `e2e-app/app.ts`.

Les tests Rust ont besoin de `git` dans le PATH. Les tests E2E démarrent Vite eux-mêmes, ou réutilisent celui de `npm run tauri dev` s'il tourne déjà.

### Intégration continue

[GitHub Actions](.github/workflows/ci.yml) lance tous les tests à chaque push sur `main` et sur chaque pull request :

| Job | Machine | Contenu |
|---|---|---|
| Interface | Ubuntu | typage, `npm test`, `npm run test:e2e` |
| Backend Rust | Ubuntu et Windows | `cargo test` (dont la surveillance du dépôt : inotify sous Linux) |
| App compilée | Windows | `npm run test:app` |

En cas d'échec, les traces Playwright sont jointes au run (artefacts `playwright-*`).

## Structure

```
src/                 interface React
  components/        barre de titre, réglages, icônes…
  components/graph/  graphe des commits, détails, diff, barre latérale des branches
  views/             écrans (accueil, dépôt, profils)
  store/             état global (zustand) : app.ts (onglets, réglages), graph.ts (historique),
                     worktree.ts (copie de travail), ops.ts (branches, réseau), profiles.ts
                     (profils, profil actif par dépôt), dialogs.ts
  lib/profiles.ts    règles de sélection automatique des profils
  lib/providers.ts   providers : adresse d'une instance, provider et compte d'un remote
  lib/api.ts         façade vers le backend (Tauri ou simulé)
  i18n/              traductions
  **/*.test.ts(x)    tests unitaires, à côté du code testé
e2e/                 tests E2E Playwright (backend simulé)
e2e-app/             tests E2E sur l'app compilée (CDP de WebView2)
src-tauri/src/       backend Rust (tests dans un module `tests` en bas de chaque fichier)
  git.rs             appels au binaire git
  history.rs         historique : log, refs, détails d'un commit, diff
  worktree.rs        copie de travail : état, indexation, commit
  branches.rs        checkout (auto-stash), branches, fetch / pull / push, stash pop
  watch.rs           surveillance du dépôt actif
  profiles.rs        clés SSH des profils (lecture, génération, phrase de passe)
  providers.rs       comptes GitHub / GitLab (token personnel vérifié auprès de l'API)
  signing.rs         clés GPG (signature des commits)
  secrets.rs         trousseau du système (phrases de passe, tokens des comptes)
  askpass.rs         l'exécutable répond à ssh (phrase de passe) quand ssh le lance
  store.rs           état persistant (dépôts, onglets, réglages, profils)
  commands.rs        commandes exposées à l'interface
```

## Publier une version

1. Chaque PR ajoute ses changements sous « Non publié » dans [CHANGELOG.md](CHANGELOG.md).
2. Onglet **Actions** → **Nouvelle version** → **Run workflow**, niveau `patch`, `minor` ou `major` (`current` : garder la version actuelle), ou `gh workflow run version.yml -f niveau=patch`. Le workflow monte la version (`package.json`, `Cargo.toml` et les verrous), date le changelog, pousse le commit « Version x.y.z » et le tag `vx.y.z`.
3. Le tag lance **Release** : paquets des trois plateformes, signatures de l'updater, `latest.json`, et une release GitHub **en brouillon**, notes tirées du changelog.
4. Relire le brouillon sur la page Releases et le publier : les apps installées proposent alors la mise à jour.

Secrets nécessaires : `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (clé de l'updater, `npm run tauri -- signer generate`, clé publique dans `tauri.conf.json`), `RELEASE_DEPLOY_KEY` (clé de déploiement en écriture, en exception du ruleset de `main`).

## Windows : avertissement SmartScreen

Les binaires ne sont pas signés (projet open source sans certificat payant). Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Licence

[MIT](LICENSE)
