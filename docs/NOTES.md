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
  - Retours sur les maquettes à reporter : case « push après le commit » mémorisée par dépôt (étape 4, avec le push), profil discret dans la zone de commit (étape 5).
- **Étape 2 — graphe** : terminée (vérifiée dans le navigateur avec le backend simulé ; à valider dans l'app Tauri sur de vrais dépôts).
  - Backend (`history.rs`) : `git log --all --date-order` par pages de 1 000 (stash exclu), refs (`for-each-ref`, tags annotés déréférencés, ahead/behind), détails d'un commit (message complet, auteur/committer, fichiers via `diff-tree -M` contre le 1er parent ou l'arbre vide), diff d'un fichier parsé en hunks/lignes numérotées (binaire détecté, tronqué au-delà de 20 000 lignes, chemins littéraux). SHA validés avant d'être passés à git.
  - Lanes calculées côté front (`lib/graph.ts`, colonnes stables et réutilisées, 8 couleurs) ; liste virtualisée + canvas limité à la zone visible ; page suivante chargée en approchant du bas ; relecture du log seulement si les refs ont changé (F5 / retour du focus).
  - Ligne « modifications en cours » (WIP) en tête si la copie de travail est sale ; anneau sur HEAD ; étiquettes de branches (locale + distante fusionnées si au même commit), distantes, tags.
  - Panneau de détails (parents cliquables, copie du SHA) ; clic sur un fichier → diff à la place du graphe (Échap pour revenir) ; navigation clavier ↑ ↓ PageUp PageDown Début Fin ; sélection et défilement conservés par onglet.
  - Barre latérale : Local, une section par remote, Tags ; branches à préfixe rangées en dossiers (`feature/…`) ; sections et dossiers repliables, sections masquables, choix mémorisés par dépôt (`repoUi` dans `state.json`) ; filtre ; clic = sélection du commit (charge les pages nécessaires).
  - Limites connues : `--date-order` + `--skip` relit tout l'historique à chaque page (à remplacer par un processus `git log` en flux ou un cache côté Rust si c'est lent sur 100k+ commits) ; diff unifié uniquement (vue côte à côte plus tard) ; pas encore de recherche dans le graphe ni d'avatars.
  - Tests : 97 unitaires front, 28 unitaires Rust, 25 E2E.
- **Étape 3 — copie de travail** : terminée (vérifiée dans le navigateur avec le backend simulé ; à valider dans l'app Tauri sur de vrais dépôts).
  - Backend (`worktree.rs`) : `status --porcelain=v2 -z` (indexés / non indexés / non suivis / conflits, renommages) ; indexer / retirer des fichiers (y compris avant le premier commit), tout indexer / tout retirer ; abandonner des fichiers (non suivis supprimés, liens jamais suivis) ; tout annuler (`reset --hard` + `clean -fd`, refusé sans commit) ou stasher à la place ; commit et amend (message par l'entrée standard, erreurs « identité manquante » / « rien à commiter » traduites).
  - **Blocs et lignes** : indexer / retirer = patch partiel appliqué à l'index (`git apply --cached [-R] --recount`), en-tête réécrit pour une sélection partielle d'un fichier ajouté ou supprimé ; abandonner = réécriture directe du fichier de travail (fonctionne avec `core.autocrlf`, conserve les CRLF). Chaque action vérifie l'empreinte du diff affiché (`diff_changed` sinon) : jamais d'action sur un diff qui a changé entre-temps.
  - Interface : ligne « modifications en cours » sélectionnée d'office quand le dépôt est sale ; panneau Conflits / Non indexés / Indexés (liste ou arborescence, actions au survol, double-clic = indexer/retirer, « tout annuler » avec confirmation et option stash) ; zone de commit (résumé avec compteur /72, description, amend qui reprend le dernier message, Ctrl+Entrée) ; diff de travail avec actions par fichier, par bloc et par lignes sélectionnées (clic, Maj+clic pour une plage), confirmation pour tout abandon.
  - Diffs (commit et copie de travail) : vue **en ligne ou côte à côte**, choix mémorisé dans les réglages ; la sélection de lignes fonctionne dans les deux vues. Dans une ligne modifiée, **les mots réellement changés sont surlignés** (comparaison mot à mot, budget de calcul par diff pour ne jamais figer l'interface ; pas de surlignage si la ligne est presque entièrement réécrite).
  - Limites connues : pas d'indexation partielle d'un fichier non suivi (fichier entier seulement) ; pas de résolution de conflits intégrée (v2) ; amend possible uniquement depuis la ligne « en cours » (donc avec des modifications).
  - Tests : 139 unitaires front, 43 unitaires Rust, 30 E2E.
- **Retours d'utilisation (après l'étape 3)** : faits, vérifiés dans le navigateur avec le backend simulé.
  - Poignées de redimensionnement (glisser, flèches au clavier, double-clic = taille par défaut) : largeur de la barre latérale et du panneau de droite, hauteur de chaque section (barre latérale, Non indexés / Indexés, bloc message + auteur des détails), largeur des colonnes du graphe, partage du diff côte à côte (borné pour laisser de la place aux deux versions). Tailles dans `settings.layout` (`state.json`), enregistrées au relâcher seulement.
  - Colonnes du graphe masquables (bouton à droite de l'en-tête ou clic droit), sauf le message ; choix dans `settings.hiddenColumns`.
  - Compteurs par catégorie `+ajoutés ~modifiés →renommés −supprimés` (détails d'un commit, sections du panneau des modifications).
  - Détails d'un commit : auteur et date sur une ligne (e-mail et committer en infobulle), SHA court + parents sur une ligne.
  - Le logo est l'onglet Accueil (même style que les onglets, sans fermeture).
  - Tests : 151 unitaires front, 43 unitaires Rust, 33 E2E.
- **Rafraîchissement automatique** (bug : après un commit fait en ligne de commande, le graphe montrait le commit mais le panneau gardait ses fichiers « en cours »).
  - Cause : au retour du focus, refs et état de la copie de travail étaient lus en parallèle ; un commit fait entre les deux lectures donnait un état incohérent. Désormais refs/graphe puis état puis diff ouvert, et les demandes pendant un rafraîchissement en cours sont regroupées en un seul.
  - Surveillance du dépôt actif (`watch.rs`, crate `notify`) : une modification faite ailleurs (terminal, éditeur, autre client git) rafraîchit l'app sans attendre le focus. Écartés : objets et verrous de `.git`, fichiers du démon fsmonitor (sinon boucle), fichiers ignorés (`git check-ignore`, sinon une compilation relancerait `git status` sans fin).
  - Deux modes : **récursif** sous Windows / macOS (une seule veille, événements des dossiers ignorés écartés au tri) ; **dossier par dossier** sous Linux, où inotify coûte une veille par dossier (`max_user_watches`) : seuls les dossiers non ignorés sont surveillés (`git ls-files --ignored --directory`), sans `.git/objects`, et les dossiers créés ensuite sont ajoutés à la volée. Une veille refusée (limite atteinte) n'arrête pas les autres et déclenche un rafraîchissement.
  - Limites connues : le mode par dossier est testé sous Windows (même code, backend `notify` différent) mais pas encore sur un vrai Linux / inotify (à valider avec la CI Linux, étape 7) ; un dossier qui *devient* ignoré après coup (`.gitignore` modifié) reste surveillé jusqu'au prochain changement d'onglet ; l'état attend la relecture du graphe (première page du log si les refs ont bougé).
  - Tests : 154 unitaires front, 48 unitaires Rust, 33 E2E.

## À faire / plus tard

Retours d'utilisation, à caser dans une prochaine étape :

- [x] **Hauteur des sections** : pouvoir redimensionner la hauteur de chaque section dans chaque panneau (ex. Local / origin / Tags à gauche, détails / fichiers à droite).
- [x] **Largeur des panneaux** : pouvoir redimensionner la barre latérale, le graphe et le panneau de détails (poignées de glisser, largeurs mémorisées).
- [x] **Colonnes du graphe** : choisir les colonnes affichées (branche/tag, graphe, message, auteur, date, SHA) et leur largeur.
- [x] **Compteurs de fichiers** : distinguer ajoutés / modifiés / renommés / supprimés (ex. `+2 ~3 →1 −1`) au lieu d'un seul total.
- [x] **Détails d'un commit plus compacts** : le bloc auteur (avatar, nom, e-mail, date) prend beaucoup de place pour une info déjà visible dans le graphe, et repousse la liste des fichiers vers le bas. Le rendre discret (ex. une seule ligne « auteur · date », e-mail et committer en infobulle) pour que les fichiers modifiés remontent.
- [x] **Logo = onglet Accueil** : le logo en haut à gauche (retour à l'accueil) doit avoir le même style que les onglets de dépôts, mais sans bouton de fermeture.
- [x] **Diff côte à côte redimensionnable** : pouvoir déplacer le séparateur entre l'ancienne et la nouvelle version.
- [ ] **Publier un dépôt local sur GitHub / GitLab** (comme GitKraken) : pour un dépôt sans remote, créer le dépôt distant via l'API du provider (nom, description, public/privé, groupe/organisation, instance self-hosted), ajouter `origin` et pousser la branche courante **en configurant son suivi** (`push -u`). À noter : GitKraken a créé `origin` et poussé `main` pour GitGR, mais sans configurer l'upstream de `main` (pas d'ahead/behind tant qu'on ne fait pas `git branch -u origin/main`) — à ne pas reproduire. Dépend des étapes 5 (profils) et 6 (providers).
- [ ] **Serveur MCP** : exposer les actions de GitGR via un serveur MCP (Model Context Protocol) pour qu'un agent (Claude Code, etc.) puisse faire commit / push / pull / fetch / checkout… **avec les préférences configurées dans l'app** : profil actif du dépôt (identité injectée, clé SSH), auto-stash au changement de branche, stratégie de pull, push après commit… Outils en lecture aussi (status, log, branches, diff). À prévoir : activation explicite dans les réglages, actions destructives (reset, suppression de branche, push --force) refusées ou soumises à confirmation dans l'app, journal des actions faites par l'agent (et undo via le reflog). Dépend des étapes 3-5.

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
