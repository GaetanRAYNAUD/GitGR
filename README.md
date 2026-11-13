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

Tests Rust :

```bash
cd src-tauri && cargo test
```

## Structure

```
src/                 interface React
  components/        barre de titre, réglages, icônes…
  views/             écrans (accueil, dépôt)
  store/             état global (zustand)
  lib/api.ts         façade vers le backend (Tauri ou simulé)
  i18n/              traductions
src-tauri/src/       backend Rust
  git.rs             appels au binaire git
  store.rs           état persistant (dépôts, onglets, réglages)
  commands.rs        commandes exposées à l'interface
```

## Windows : avertissement SmartScreen

Les binaires ne sont pas signés (projet open source sans certificat payant). Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Licence

[MIT](LICENSE)
