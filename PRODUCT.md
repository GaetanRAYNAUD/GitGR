# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Application de bureau Tauri 2 (WebView2 sous Windows, WebKitGTK sous Linux) dont l'interface est en React + TypeScript. Cibles : Windows et Linux ; macOS construit par la CI mais ni testé ni signé.

## Users

Développeurs qui jonglent toute la journée entre plusieurs identités et comptes (perso, pro, clients) et plusieurs dépôts, sur github.com, GitHub Enterprise, gitlab.com et des GitLab self-hosted. Leur travail : voir et gérer leurs dépôts — graphe, commit, push, pull, branches, PR / MR, conflits — sans se tromper d'identité, de clé SSH ou de compte.

## Product Purpose

GitGR est un client Git de bureau visuel, léger et fluide, multi-profils et multi-dépôts. Il existe pour qu'un développeur gère ses dépôts depuis le graphe des commits, avec le bon profil appliqué automatiquement, et que l'outil fasse le travail pénible à sa place. Réussite : on ne commite ni ne pousse jamais avec la mauvaise identité, on ne perd jamais de travail, et les opérations courantes prennent peu de clics.

## Positioning

Par rapport à GitKraken, Fork ou Sourcetree :

- **Profils par dépôt et par remote** : un profil réunit nom, e-mail, clé SSH, signature (GPG ou SSH) et comptes GitHub / GitLab ; des règles (hôte, dossier) choisissent le bon profil pour chaque dépôt, chaque remote peut avoir le sien, et un garde-fou prévient avant un commit ou un push si un autre profil correspond mieux. L'identité est injectée par l'app (`-c user.name/-c user.email`), sans toucher à la config Git.
- **Léger et rapide** : Tauri / Rust, rapide même sur gros dépôt (100k+ commits, rendu virtualisé), peu de modales, peu de clics.
- **Gratuit et open source** (MIT), sans compte ni abonnement, GitLab self-hosted et GitHub Enterprise inclus.
- **L'outil fait le pénible** : auto-stash au changement de branche et au pull (rien n'est perdu en cas de conflit), fetch en arrière-plan, undo / redo des opérations via le reflog (refus plutôt que deviner si le dépôt a changé ailleurs).

## Operating Context

- Le graphe des commits est l'écran principal ; tout part de lui (clic droit, glisser-déposer, sélection, double-clic).
- Un dépôt par onglet ; accueil avec les dépôts récents ; sélecteur rapide et palette de commandes.
- Utilisé à côté d'un terminal et d'un éditeur : le graphe se rafraîchit quand le dépôt change ailleurs.
- Comptes connectés par token personnel (rangé dans le trousseau du système) ou OAuth GitHub (device flow) ; pas d'OAuth pour GitLab self-hosted.
- Mises à jour silencieuses en arrière-plan (tauri-plugin-updater) ; installateur Windows non signé (avertissement SmartScreen accepté).

## Capabilities and Constraints

- Fait : graphe, détails et diff (en ligne / côte à côte), indexation par fichier, bloc et ligne, commit / amend, branches, remotes, pull (ff / merge / rebase), push, fetch, stash, merge, rebase, cherry-pick, reset, undo / redo, blame et historique d'un fichier, PR / MR (vue de suivi : discussion, fichiers, checks), résolution de conflits par bloc avec résultat éditable.
- En cours ou prévu (voir `docs/NOTES.md`) : vue de conflits 3 panneaux façon IntelliJ, groupes de dépôts (un onglet par groupe, deuxième barre), état des dépôts à l'accueil, worktrees, rebase interactif visuel, serveur MCP pour agents, tour guidé, page des raccourcis modifiables.
- Principe de la résolution de conflits : l'utilisateur compose le résultat librement (lignes dans l'ordre des clics, puis réordonnables, résultat éditable) — défaut de GitKraken à ne pas reproduire.
- Groupes de dépôts : ne doivent pas prendre plus de place dans la barre d'onglets.
- Git doit être installé (détecté au démarrage).
- Contraintes durables d'interface :
  - **FR + EN partout** : tout texte passe par i18next ; prévoir les longueurs du français.
  - **Clair + sombre** : chaque écran tient en thème clair, sombre et système.
  - **Tout au clavier** : chaque action accessible au clavier ou par la palette, raccourcis visibles.
  - **Densité d'IDE** : écran riche en information comme IntelliJ ou VS Code, pas d'aération façon site web.

## Brand Commitments

- Nom : **GitGR**. Logo et favicon existants (`src/components/Logo.tsx`, `public/favicon.svg`).
- Descriptions courtes officielles (README) :
  - EN : *A fast, lightweight desktop Git client with a visual commit graph, multiple identities per repository and built-in GitHub / GitLab support.*
  - FR : *Client Git de bureau rapide et léger : graphe des commits, plusieurs identités par dépôt, GitHub et GitLab intégrés.*
- Site prévu : https://git.gaetanraynaud.fr (page de téléchargement à venir).
- Voix des textes : français simple et direct, vouvoiement dans le guide, termes Git courants (commit, push, pull, stash…) gardés tels quels.

## Evidence on Hand

- `README.md`, `GUIDE.md` (guide rapide des fonctionnalités), `docs/NOTES.md` (décisions, fait / reste à faire), `CHANGELOG.md`.
- Pas de témoignages, d'utilisateurs nommés, de benchmarks chiffrés publiés ni de tarifs : n'en inventer aucun.

## Product Principles

1. **Le graphe est l'écran principal** : les actions partent de lui, pas de menus ou de modales séparés.
2. **Jamais la mauvaise identité** : le profil actif est toujours visible et le bon est choisi automatiquement ; prévenir plutôt que laisser faire.
3. **Ne jamais perdre de travail** : auto-stash, undo par reflog, refuser plutôt que deviner.
4. **Peu de clics, peu de modales** : l'outil fait le pénible, tout est faisable au clavier.
5. **Rapide même sur gros dépôt** : la fluidité est une fonctionnalité.

## Accessibility & Inclusion

Navigation entièrement au clavier (voir contraintes). Aucun standard d'accessibilité formel n'a été fixé.
