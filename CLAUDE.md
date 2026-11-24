# GitGR — consignes pour Claude

Client Git de bureau, Tauri 2 (Rust) + React / TypeScript. Le README décrit la stack, les commandes et la structure du code. `docs/NOTES.md` tient la feuille de route (décisions, fait, reste à faire) ; `PRODUCT.md` le produit ; `DESIGN.md` le système visuel.

## Langue

- Textes du dépôt en français : commits, PR, CHANGELOG, docs, commentaires.
- Titre de commit : « Zone : ce qui change » (ex. « Conflits : lignes cochées dans l'ordre des clics »), sans préfixe `feat:` / `fix:`.
- Chaque PR ajoute ses lignes sous « Non publié » dans `CHANGELOG.md`, écrites pour l'utilisateur : elles deviennent les notes de version affichées dans l'app.

## Interface

- Tout texte visible passe par i18next, en français **et** en anglais (`src/i18n/locales/fr.json`, `en.json`) ; prévoir les libellés français plus longs.
- Chaque écran tient en thème clair et sombre : couleurs uniquement par `var(--jeton)` de `src/styles.css`, jamais en dur.
- Toute action est faisable au clavier.
- Avant de toucher à l'interface, lire `DESIGN.md` (règles « L'Établi » : densité d'IDE, à plat, ombre réservée à ce qui flotte, couleur vive réservée au contenu du dépôt).

## Processus pour une fonctionnalité

1. **Nouvel écran ou gros changement d'interface** : `/impeccable shape <écran>` avant d'écrire le code (états, raccourcis, cas vides, longueurs FR). Pas pour les petits ajustements.
2. **Implémentation + tests** à côté du code : Vitest (`*.test.ts(x)`), tests Rust dans le module `tests` du fichier, E2E Playwright dans `e2e/`.
3. **Vérifier dans la vraie app**, pas seulement l'interface simulée : `npm run test:app` (Rust compilé + WebView2, dépôts temporaires) ; ajouter un test `e2e-app/` pour toute fonctionnalité qui touche à Git. Ne jamais tester d'opération destructive ou de stash sur le dépôt GitGR lui-même.
4. **Écran terminé** : `/impeccable critique` puis `/impeccable polish` sur cet écran, captures en clair et en sombre.
5. **Gros changement** (étape de la feuille de route, grosse fonctionnalité) : `/code-review high --fix`, puis `npm run test:all` avant de conclure.
6. **Jetons modifiés** (nouvelle couleur, nouveau composant récurrent dans `styles.css`) : `/impeccable document` pour remettre `DESIGN.md` et `.impeccable/design.json` à jour.

Le hook de design Impeccable tourne après chaque modification d'un fichier d'interface : corriger ce qu'il signale, ou poser l'exception la plus étroite avec `impeccable hooks ignore-value` en disant pourquoi.

## Git

- Travail sur une branche `feat/…` ou `fix/…`, PR vers `main` avec merge automatique (méthode merge).
- Docs simples et fichiers de configuration Claude / Impeccable : commit et push directs sur `main`, sans PR.
