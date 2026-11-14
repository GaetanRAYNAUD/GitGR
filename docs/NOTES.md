# GitGR — Notes de cadrage

> Document vivant. Tout ce qui est marqué **[?]** est une question encore ouverte.

## 0. Décisions actées

| Sujet | Décision |
|---|---|
| Stack | **Tauri 2** (Rust) — Rust appris au fil de l'eau |
| Frontend | **React + TypeScript** (connu) |
| Nature du projet | Perso, **open source** |
| Signature de code Windows | **Non** — avertissement SmartScreen accepté |
| Self-hosted | **GitLab self-hosted** et **GitHub Enterprise** supportés très tôt (URL d'instance configurable dès la conception). Test réel possible sur un GitLab self-hosted ; GitHub Enterprise non testable pour l'instant |
| Identité Git | Injectée **uniquement par l'app** (`-c user.name/-c user.email`). Bouton optionnel « Appliquer au repo » qui écrit dans `.git/config` |
| Licence | **MIT** |
| Git requis | Au démarrage, détection de `git`. Absent → proposer de l'installer **ou** utiliser un Git embarqué (Windows : MinGit portable téléchargé à la demande) |
| Groupes / workspaces | Évolution future (pas dans le MVP) |
| Thème | Clair **et** sombre, option « suivre l'OS » ou forcer |
| Langue | **i18n dès le départ** (FR + EN) |
| macOS | Porte ouverte, pas de build/test pour l'instant (pas de machine) |
| Répartition du travail | Claude fait le gros du développement ; intervention humaine en cas de blocage |

## État d'avancement

- **Maquettes** (Claude Design) : vue dépôt (graphe + staging), accueil, réglages des profils — https://claude.ai/artifact/3jzWnmWw6aSMV3ivp6KsGz
- **Étape 1 — squelette** : terminée. Barre de titre personnalisée avec onglets de dépôts, accueil (ouvrir un dossier, récents, recherche, retirer), vue dépôt avec résumé (branche, suivi, ↑↓, modifs, remote), détection de Git + fenêtre si absent, thème clair/sombre/système, FR/EN, raccourcis (Ctrl+Tab, Ctrl+W, Ctrl+T, Ctrl+O, Ctrl+1..9, F5). État persisté en JSON (`state.json` dans le dossier de config) ; passage à SQLite prévu avec les profils.
  - Clic sur le logo = retour à l'accueil. Drapeaux dans le choix de langue.
  - Vérifiée dans l'app Tauri sous Windows (ouverture, erreurs, onglets, fenêtre, restauration au redémarrage).
  - Tests à la fin de l'étape : 34 unitaires front, 13 unitaires Rust, 14 E2E Playwright (cf. §8).
  - Retours sur les maquettes à reporter dans l'app aux étapes 3-4 : bouton « tout annuler » avec confirmation (et option stash), case « push après le commit » mémorisée par dépôt, profil discret dans la zone de commit.
- **Étape 2 — graphe** : terminée (vérifiée dans le navigateur avec le backend simulé ; à valider dans l'app Tauri sur de vrais dépôts).
  - Backend (`history.rs`) : `git log --all --date-order` par pages de 1 000 (stash exclu), refs (`for-each-ref`, tags annotés déréférencés, ahead/behind), détails d'un commit (message complet, auteur/committer, fichiers via `diff-tree -M` contre le 1er parent ou l'arbre vide), diff d'un fichier parsé en hunks/lignes numérotées (binaire détecté, tronqué au-delà de 20 000 lignes, chemins littéraux). SHA validés avant d'être passés à git.
  - Lanes calculées côté front (`lib/graph.ts`, colonnes stables et réutilisées, 8 couleurs) ; liste virtualisée + canvas limité à la zone visible ; page suivante chargée en approchant du bas ; relecture du log seulement si les refs ont changé (F5 / retour du focus).
  - Ligne « modifications en cours » (WIP) en tête si la copie de travail est sale ; anneau sur HEAD ; étiquettes de branches (locale + distante fusionnées si au même commit), distantes, tags.
  - Panneau de détails (parents cliquables, copie du SHA) ; clic sur un fichier → diff à la place du graphe (Échap pour revenir) ; navigation clavier ↑ ↓ PageUp PageDown Début Fin ; sélection et défilement conservés par onglet.
  - Barre latérale : Local, une section par remote, Tags ; branches à préfixe rangées en dossiers (`feature/…`) ; sections et dossiers repliables, sections masquables, choix mémorisés par dépôt (`repoUi` dans `state.json`) ; filtre ; clic = sélection du commit (charge les pages nécessaires).
  - Limites connues : `--date-order` + `--skip` relit tout l'historique à chaque page (à remplacer par un processus `git log` en flux ou un cache côté Rust si c'est lent sur 100k+ commits) ; diff unifié uniquement (vue côte à côte plus tard) ; pas encore de recherche dans le graphe ni d'avatars.
  - Tests : 91 unitaires front, 28 unitaires Rust, 24 E2E.

## 1. Vision

Client Git de bureau **visuel, léger et fluide**, inspiré de GitKraken (et pas de Sourcetree).
Usage principal : **voir et gérer son repo** — graphe, commit, push, pull, branches.

Principes directeurs :
- **Le graphe est l'écran principal.** Tout part de lui (clic droit, drag & drop, sélection).
- **L'outil fait le travail pénible à ta place** (auto-stash, fetch en arrière-plan, bon profil auto-sélectionné).
- **Rapide même sur gros repo** (100k+ commits) : rendu virtualisé, chargement incrémental.
- **Peu de modales, peu de clics.** Palette de commandes (Ctrl+P / Ctrl+Shift+P) pour tout.
- **Réversible** : undo/redo des actions Git quand c'est possible (via le reflog).

Cibles : **Windows + Linux** (macOS non exclu plus tard **[?]**).

## 2. Fonctionnalités

### 2.1 Cœur Git (MVP)
- Graphe des commits (branches locales/distantes, tags, stashes, HEAD, nœud « WIP » en haut).
- Panneau de détails : commit sélectionné → fichiers modifiés → diff.
- Zone de staging : stage/unstage fichier, **hunk et ligne** ; message de commit (résumé + description) ; amend.
- Push / pull / fetch (fetch auto périodique en arrière-plan).
- Branches : créer, renommer, supprimer, checkout, suivre une branche distante.
- **Checkout avec auto-stash** (voir §2.2).
- Merge, rebase simple, cherry-pick, revert, reset (soft/mixed/hard avec confirmation).
- Stash : créer, appliquer, pop, supprimer, voir le contenu.
- Tags.

### 2.2 Le « effet GitKraken » — détails qui font la différence
- **Auto-stash au changement de branche** :
  1. working tree sale → `stash push -u -m "GitGR-autostash: <branche-source>"`
  2. checkout
  3. `stash pop`
  4. si conflit au pop → on **garde** le stash, on affiche les conflits, on ne perd rien.
  - Option par repo/global pour désactiver ou demander.
- Drag & drop d'une branche sur une autre → menu « Merge / Rebase / Créer PR ».
- Double-clic sur une branche distante → crée la locale qui la suit et checkout.
- Undo/Redo (Ctrl+Z / Ctrl+Y) des opérations : commit, checkout, reset, merge, suppression de branche…
- Recherche/filtre dans le graphe (message, auteur, SHA, fichier).
- Masquer/solo des branches dans le graphe.
- Pull avec stratégie configurable (ff-only / merge / rebase), « pull = fetch + fast-forward si possible ».

### 2.3 Plus tard (v2+)
- Résolution de conflits intégrée (vue 3 panneaux).
- Rebase interactif visuel (réordonner / squash / fixup par drag & drop).
- Blame, historique d'un fichier.
- Submodules, Git LFS, worktrees.
- Signature des commits (GPG ou SSH) — s'intègre bien au système de profils.

## 3. Profils (multi-identités)

Un **profil** = une identité Git complète :
| Champ | Exemple |
|---|---|
| Nom du profil | « Perso », « Boulot » |
| `user.name` / `user.email` | |
| Clé SSH | chemin vers une clé existante **ou** clé générée par l'app (ed25519) |
| Passphrase | stockée dans le trousseau OS (optionnel) |
| Clé de signature | GPG / SSH (v2) |
| Comptes providers liés | GitHub, GitLab (cf. §4) |

Relation **repo ↔ profils : N–N**.
- Un repo a une liste de profils autorisés + **un profil actif**.
- Sélecteur de profil visible en permanence dans la barre du repo (changement en 1 clic).
- **Auto-suggestion** à l'ouverture/clone : selon l'host du remote (`github.com`, `gitlab.mon-entreprise.fr`) et/ou le dossier parent.
- Garde-fou : alerte si on s'apprête à commiter/pousser avec un profil qui ne correspond pas au remote.

Mise en œuvre envisagée (sans toucher au `~/.ssh/config` ni au `~/.gitconfig` global) :
- Identité : `git -c user.name=… -c user.email=… commit`, injectée par l'app uniquement (acté). Bouton optionnel « Appliquer au repo » → écrit dans `.git/config` pour que l'identité vaille aussi en ligne de commande.
- SSH : variable `GIT_SSH_COMMAND="ssh -i <clé> -o IdentitiesOnly=yes"` injectée par commande réseau.
- Secrets (tokens, passphrases) : **trousseau de l'OS** (Windows Credential Manager, Secret Service/libsecret sous Linux), jamais en clair sur disque.

## 4. Intégrations providers

- **GitHub** (github.com + GitHub Enterprise, URL d'API configurable) : connexion via OAuth *device flow* (pas de secret embarqué dans l'app) ou token personnel.
- **GitLab** (gitlab.com + instances self-hosted) : OAuth PKCE ou token personnel, URL d'instance configurable.

Fonctionnalités :
- Lister ses repos et **cloner** en choisissant le profil.
- **Ajouter la clé SSH du profil** au compte en un clic.
- Créer une PR / MR depuis une branche ; voir les PR/MR ouvertes dans la sidebar.
- Statut CI (pipelines / checks) sur les commits du graphe (v2).
- Avatars des auteurs dans le graphe.

## 5. Multi-repo

- **Onglets** de repos ouverts (comme un navigateur) + Ctrl+Tab / Ctrl+1..9.
- **Sélecteur rapide** (fuzzy) de tous les repos connus.
- Organisation en **groupes / workspaces** (ex. « Client X ») **[?]**.
- Chaque onglet garde son état (sélection, scroll, filtres).
- Fetch en arrière-plan des repos ouverts + badge « x commits à tirer / à pousser ».

## 6. Choix techniques (proposition)

### 6.1 Stack applicative — recommandation : **Tauri 2**
| Option | + | − |
|---|---|---|
| **Tauri 2 (Rust + WebView + TS)** | binaire léger (~10-20 Mo), faible RAM, updater et installeurs intégrés, Rust idéal pour la couche Git | WebKitGTK sous Linux un peu moins performant que Chromium ; Rust à apprendre si pas connu |
| Electron (Node + Chromium) | rendu identique partout, écosystème énorme (c'est ce qu'utilise GitKraken) | lourd (150 Mo+, RAM), justement ce qu'on veut éviter |
| Avalonia (.NET) / Qt | natif, performant | UI riche (graphe, diff) plus longue à construire |

Frontend : TypeScript + **React** (acté).
Rendu du graphe : liste virtualisée + **Canvas** pour les lignes (le DOM/SVG ne tient pas sur 100k commits).

### 6.2 Moteur Git — approche hybride
- **Lecture** (log, graphe, status, diff, refs) : bibliothèque native Rust — `gix` (gitoxide) ou `git2` (libgit2) → rapide, pas de parsing de texte.
- **Écriture & réseau** (commit, push/pull/fetch, merge, rebase, stash, checkout) : **appel au binaire `git`** → compatibilité maximale (hooks, `.gitattributes`, credential helpers, SSH de l'OS, LFS).
- Prérequis : Git installé (sur Windows, on peut embarquer un Git portable **[?]**).
- Surveillance du dossier (`notify`) pour rafraîchir le status en temps réel.

### 6.3 Stockage local
- SQLite (profils, repos connus, liaisons repo↔profils, préférences, cache).
- Secrets → trousseau OS (crate `keyring`).

### 6.4 Distribution & mises à jour
- **Windows** : installeur NSIS (ou MSI) — mise à jour auto via `tauri-plugin-updater`.
- **Linux** : **AppImage** (supporte la mise à jour auto) + `.deb` / `.rpm` (mis à jour par le gestionnaire de paquets, pas par l'app) ; Flatpak éventuel plus tard.
- Mises à jour signées (clé de signature Tauri), manifeste `latest.json` hébergé sur GitHub Releases.
- CI : GitHub Actions, build matrix Windows + Linux à chaque tag.
- Pas de signature de code Windows (acté) : avertissement SmartScreen accepté, à mentionner dans le README.

## 7. Découpage en étapes (proposition)

1. **Squelette** : app Tauri, ouverture d'un repo local, liste des repos, onglets.
2. **Graphe** : calcul des lanes + rendu virtualisé, détails de commit, diff.
3. **Working copy** : status, staging (fichier → hunk → ligne), commit, amend.
4. **Branches & réseau** : checkout avec auto-stash, création/suppression, fetch/pull/push.
5. **Profils** : CRUD, génération de clé SSH, association repo↔profils, injection identité + SSH.
6. **Providers** : connexion GitHub/GitLab, clone depuis la liste, ajout de clé SSH, PR/MR.
7. **Distribution** : installeurs, updater, CI de release.
8. Merge/rebase/cherry-pick, undo/redo, palette de commandes, puis v2.

## 8. Tests

Règle : **chaque étape livre ses tests**, et `npm run test:all` doit passer avant un commit.

| Niveau | Outil | Ce qu'on y teste |
|---|---|---|
| Unitaires front | Vitest + Testing Library (jsdom) | store (onglets, persistance, erreurs), fonctions pures (`lib/format.ts`), composants, cohérence des traductions FR/EN |
| Unitaires Rust | `cargo test` + `tempfile` | parsing de la sortie git, persistance de l'état, **opérations git sur de vrais dépôts temporaires** (remote nu + clones pour ahead/behind, conflits, stash…) |
| E2E interface | Playwright (Chromium), sur Vite avec le backend simulé | parcours utilisateur : ouvrir, onglets et raccourcis, erreurs, réglages, restauration au redémarrage |

Pourquoi Playwright sur le backend simulé : rapide, stable, identique sous Windows et Linux, et ça couvre toute la logique d'interface. La partie Rust est couverte par ses propres tests sur de vrais dépôts.

Plus tard (avant la première release) : quelques E2E **sur l'app Tauri compilée** via WebDriver (`tauri-driver` + WebdriverIO ; supporté sous Windows et Linux, pas macOS), pour les parcours critiques de bout en bout (commit, push, auto-stash). Et une CI GitHub Actions Windows + Linux qui lance `test:all`.

Conventions :
- Front : `*.test.ts(x)` à côté du fichier testé ; état remis à zéro entre deux tests (`src/test/setup.ts`).
- Rust : module `#[cfg(test)] mod tests` en bas de chaque fichier ; un dépôt temporaire par test (`temp_repo()` dans `git.rs`).
- E2E : un fichier par domaine dans `e2e/`, sélecteurs par rôle et libellé accessibles (pas de sélecteurs CSS quand c'est évitable).

## 9. Questions ouvertes

- [x] ~~Rust / framework front~~ → Tauri 2 + React (cf. §0)
- [x] ~~Nature du projet~~ → perso, open source, sans signature (cf. §0)
- [x] ~~Self-hosted~~ → oui, très tôt (cf. §0)
- [x] ~~Identité~~ → injectée par l'app + bouton « Appliquer au repo » (cf. §0)
- [x] ~~Licence~~ → MIT
- [x] ~~Git embarqué~~ → détection + proposition d'install ou Git embarqué
- [x] ~~Groupes~~ → évolution future
- [x] ~~Thème~~ → clair/sombre, sync OS ou forcé
- [x] ~~Langue~~ → i18n dès le départ
- [x] ~~macOS~~ → plus tard
- [ ] Linux : comment fournir Git s'il manque ? (probablement juste indiquer la commande du gestionnaire de paquets)
