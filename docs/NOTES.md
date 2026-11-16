# GitGR — Notes de cadrage

> Document vivant. Tout ce qui est marqué **[?]** est une question encore ouverte.

## 0. Décisions actées

| Sujet | Décision |
|-------|----------|
| Stack | **Tauri 2** (Rust) — Rust appris au fil de l'eau |
| Frontend | **React + TypeScript** (connu) |
| Nature du projet | Perso, **open source** |
| Signature de code Windows | **Non** — avertissement SmartScreen accepté |
| Self-hosted | **GitLab self-hosted** et **GitHub Enterprise** supportés très tôt (URL d'instance configurable dès la conception). Test réel possible sur un GitLab self-hosted ; GitHub Enterprise non testable pour l'instant |
| Connexion aux providers | **Token personnel** partout (GitHub, GitHub Enterprise, gitlab.com, GitLab self-hosted) + **OAuth GitHub** (*device flow*). **Pas d'OAuth pour GitLab self-hosted** : il faudrait qu'un administrateur de chaque instance enregistre une application GitGR. OAuth gitlab.com : peut-être plus tard |
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
  - Retours sur les maquettes à reporter : case « push après le commit » mémorisée par dépôt (étape 4, avec le push), profil discret dans la zone de commit (étape 5) — faits.
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
- **Étape 4 — branches et réseau** : terminée (vérifiée dans le navigateur avec le backend simulé et par des tests Rust sur de vrais dépôts avec un remote nu ; à valider dans l'app Tauri sur un vrai serveur).
  - Backend (`branches.rs`) : checkout d'une branche locale, d'une distante (crée la locale qui la suit, ou reprend la locale du même nom) ou d'un commit (HEAD détachée) ; créer (depuis HEAD, un commit, une branche ou un tag, avec ou sans checkout), renommer, supprimer (refus `branch_not_merged` puis suppression forcée sur confirmation), supprimer sur le serveur ; fetch (`--all --prune`) ; pull ff-only / merge / rebase ; push (sans distante : créée sur `origin` **et suivie**, `-u` ; refusé → proposer pull ou `--force-with-lease`) ; stash pop ; opération en cours (merge, rebase, cherry-pick, revert) détectée dans l'état, avec Continuer / Annuler.
  - **Auto-stash** (réglage global, actif par défaut) autour du checkout, de la création de branche et du pull : `stash push -u -m "GitGR-autostash: <branche>"`, opération, `stash pop --index` (sans `--index` s'il échoue). Conflit à la réapplication → stash **gardé** et message persistant ; opération en échec → stash réappliqué tout de suite. Rien n'est stashé quand ce n'est pas utile (copie propre, nouvelle branche sur le commit courant).
  - Erreurs traduites : authentification, clé d'hôte SSH inconnue, serveur injoignable, dépôt distant introuvable, push refusé / lease périmé, branches divergées, modifications locales écrasées…
  - Interface : barre d'outils active (Pull avec menu du mode, Push, Fetch, Branche, Stash, Pop ; compteurs ↑ ↓ et nombre de stash ; icône qui tourne pendant la commande). Double-clic sur une branche (barre latérale ou étiquette du graphe) = checkout. Menus contextuels maison sur les branches, tags et commits ; le menu du navigateur est bloqué partout sauf dans les champs de saisie. Fenêtres de saisie (nom de branche validé à la frappe) et de choix (`store/dialogs.ts`). Case « Pousser après le commit » mémorisée par dépôt (`repoUi.pushAfterCommit`). Bandeau de merge / rebase en cours ; message de merge pré-rempli.
  - Réglages : auto-stash, mode du pull (ff-only par défaut : en cas de divergence, on demande merge ou rebase), **fetch automatique** du dépôt actif (à l'ouverture de l'onglet puis toutes les 5 / 10 / 30 min, 10 par défaut ; silencieux en cas d'erreur).
  - Les commandes d'un même dépôt passent une par une (`store/ops.ts`).
  - **Incident (retour d'utilisation)** : un pull fait avec GitGR *sur le dépôt GitGR lui-même*, sous `tauri dev`, a « planté » l'app. L'auto-stash a remis les `.rs` à leur version commitée, `tauri dev` a tué l'app pour recompiler, et le stash n'a jamais été réappliqué (le travail est resté dans `GitGR-autostash: main`). Corrigé en deux temps :
    - l'auto-stash n'intervient plus que **si git refuse** l'opération à cause des modifications locales (`local_changes_conflict`) ; sinon git les garde telles quelles, sans réécrire un fichier. Un pull déjà à jour ne stashe jamais (même `--rebase`, qui refuse une copie sale) ;
    - si le dernier stash est un `GitGR-autostash` (conflits, ou app interrompue), un **bandeau** propose de le réappliquer (« Plus tard » le masque pour la session).
  - Tests sur la vraie app (`npm run test:app`, `e2e-app/`) : WebView2 expose CDP sur le port de `GITGR_DEVTOOLS_PORT` (build de debug uniquement, fenêtre créée dans `lib.rs` ; la variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` est ignorée sur les runners GitHub), Playwright s'y connecte ; dépôts temporaires (remote nu + clones), config isolée par `GITGR_CONFIG_DIR`. Couvre : pull avec modifications locales, pull à jour en rebase, checkout avec stash réappliqué puis gardé en conflit, bandeau de récupération, push d'une nouvelle branche suivie. Windows seulement (WebKitGTK n'a pas CDP ; sous Linux il faudra `tauri-driver`).
  - Limites connues : pas de progression des commandes réseau ni de délai maximal (une invite SSH dans un terminal bloquerait la commande, cas de `tauri dev` lancé depuis un terminal) ; pas encore de liste des stash (appliquer / supprimer un stash précis) ; l'auto-stash n'est pas réglable par dépôt ; si le stash ne peut pas être réappliqué après une opération **en échec**, seule l'erreur de l'opération est affichée (le stash reste dans la liste).
  - Tests : 176 unitaires front, 64 unitaires Rust, 43 E2E, 5 E2E sur l'app compilée.
- **Étape 5 — profils** : terminée (vérifiée dans le navigateur avec le backend simulé, par des tests Rust sur de vrais dépôts et de vraies clés, et sur l'app compilée pour l'identité des commits).
  - Un profil = nom, `user.name`, `user.email`, clé SSH privée facultative, règles de sélection automatique, couleur, image facultative (choisie dans la page, recadrée en carré de 128 px, gardée en data URL WebP de quelques Ko dans `state.json` ; affichée à la place des initiales et dans la pastille). Stockés dans `state.json` (`profiles`, et `repoProfiles` par dépôt : profils associés + profil actif, relation N–N). Pas de SQLite finalement : quelques dizaines d'entrées tiennent dans le JSON ; à revoir avec un vrai cache (providers).
  - **Injection** (`git.rs`) : chaque commande git lancée dans un dépôt dont le profil est actif reçoit `-c user.name=… -c user.email=…` et, avec une clé, `GIT_SSH_COMMAND="ssh -i '<clé>' -o IdentitiesOnly=yes"` (chemin entre apostrophes, en `/` : il passe par le shell de Git pour Windows). Table des identités par dépôt tenue à jour par `commands.rs` à chaque changement (et au démarrage) ; rien n'est écrit dans la config git. Sans profil actif : la configuration Git s'applique, comme avant.
  - « Écrire l'identité dans .git/config » (menu du profil) : `git config --local user.name / user.email`, pour la ligne de commande.
  - **Clés SSH** (`profiles.rs`, `ssh-keygen` du PATH ou, à défaut, celui de Git pour Windows) : type, empreinte, commentaire, clé publique (`.pub`, sinon dérivée), phrase de passe détectée (`-y -P ""` échoue). Génération ed25519 sans phrase de passe, `~/.ssh/gitgr_<profil>_ed25519` proposé, jamais d'écrasement (`key_exists`). Copie de la clé publique.
  - **Phrases de passe** : rangées dans le trousseau de l'OS (`secrets.rs`, crate `keyring` : Gestionnaire d'identification sous Windows, Secret Service sous Linux — il faut GNOME Keyring, KWallet… —, trousseau sous macOS), par fichier de clé, jamais dans `state.json`. Vérifiées avant d'être rangées (`ssh-keygen -y -P`, `wrong_passphrase` sinon). Page Profils : « Enregistrer la phrase de passe… » (champ masqué) / « Oublier » ; une clé générée peut être protégée d'office. Pendant fetch / pull / push, ssh n'a pas de terminal : `git.rs` pose `SSH_ASKPASS` = l'exécutable de GitGR (avec `SSH_ASKPASS_REQUIRE=force`, `DISPLAY` si absent, et `GITGR_ASKPASS_KEY` = la clé). Lancé ainsi (`askpass.rs`, tout début de `main`), GitGR n'ouvre pas de fenêtre : il lit la phrase dans le trousseau, la donne à ssh et s'arrête ; toute autre question de ssh (hôte inconnu…) est refusée, la commande échoue au lieu d'attendre. Rien n'est lu dans le trousseau tant que ssh ne demande rien. Vérifié de bout en bout sur l'app compilée avec un vrai serveur SSH local (sshd de Git pour Windows) : clé protégée, phrase saisie dans l'app, fetch puis push (`e2e-app/ssh.spec.ts`).
  - **Signature des commits** par profil (`signing.rs`, injection dans `git.rs`) : « Config Git » (rien d'injecté, comme avant), « Ne pas signer » (`commit.gpgsign=false`, l'emporte sur la config), **GPG** (`commit.gpgsign=true`, `gpg.format=openpgp`, `user.signingkey` = clé choisie dans la liste des clés secrètes lue avec gpg, sinon l'e-mail du profil — jamais le `user.signingkey` global) ou **SSH** (`gpg.format=ssh`, `user.signingkey` = clé de signature, sinon la clé SSH du profil ; `.pub` remplacée par la clé privée). Avertissement si aucune identité de la clé GPG n'a l'e-mail du profil (signature « non vérifiée » sur GitHub / GitLab). Phrase de passe : GPG → gpg-agent (fenêtre pinentry) ; SSH → l'askpass de GitGR (`GITGR_ASKPASS_KEY` liste les clés, celle citée par la question est choisie). Échec de signature → `sign_failed`. « Écrire l'identité dans .git/config » écrit aussi ces réglages. Vérifié sur l'app compilée : GPG (trousseau jetable, `git verify-commit`) et SSH avec une clé protégée.
  - **Sélection automatique** (`lib/profiles.ts`) : règles « remote » : un hôte, éventuellement suivi d'un chemin (`github.com`, `*.exemple.fr`, `github.com/mon-org/*`, `gitlab.exemple.fr/groupe/sous-groupe`), comparées à l'hôte et au chemin d'`origin` (schéma, utilisateur, port, `www.` et casse ignorés ; `https://…`, `git@hôte:…` acceptés) ou « dossier » (`~/work/*`, chemin du dépôt ; `~` = dossier personnel, casse ignorée pour les chemins Windows). Un dossier l'emporte sur un remote, puis la règle la plus longue (`github.com/mon-org` avant `github.com`). Appliquée à un dépôt qui n'a encore aucun choix enregistré, dès que son résumé (remote) est lu, et aux onglets ouverts quand on enregistre les profils ; un choix explicite (y compris « aucun profil ») n'est jamais remplacé. Message « Profil X choisi pour Y d'après ses règles ».
  - **Garde-fou** avant un commit et un push : si un autre profil correspond à `origin` mieux que le profil actif (l'actif ne correspond pas, ou seulement par `github.com` face à `github.com/mon-org`) — sauf si l'actif est désigné par un dossier — on propose de garder (plus de question pour ce dépôt et ce profil pendant la session) ou de passer à l'autre.
  - Interface : page **Profils** (Réglages → « Gérer les profils… », ou le menu du profil) d'après la maquette : liste, identité, clé SSH (Parcourir, Générer, Copier, état de la clé), règles en pastilles, dépôts associés (profil actif ou non, Retirer), Dupliquer / Supprimer ; brouillon enregistré d'un bloc, confirmation avant d'abandonner des modifications. Profil actif **discret** dans la zone de commit et dans la barre d'état (toujours visible) ; un clic ouvre le menu (profils associés d'abord, « Aucun profil », écrire dans .git/config, gérer).
  - Limites connues : askpass vérifié sous Windows seulement (sous Linux : à valider avec la CI Linux et un vrai Secret Service ; sans trousseau, la phrase de passe ne peut pas être enregistrée — message `keyring_unavailable`) ; pas encore essayé contre le GitLab self-hosted ; identifiants HTTPS (`GIT_ASKPASS`) pas gérés ; clé GPG protégée par une phrase de passe : dépend du pinentry installé (pas de demande par GitGR, non testé) ; pas de signature des tags ; pas de vérification des signatures dans le graphe ni de comptes providers liés (étape 6) ; un groupe de dépôts ne porte pas encore de profil par défaut.
  - Tests : 198 unitaires front, 86 unitaires Rust, 52 E2E, 10 E2E sur l'app compilée (dont SSH et signatures de bout en bout).
- **Étape 6 — providers**, première partie : **profils par remote** et **gestion des remotes** — terminée (vérifiée dans le navigateur avec le backend simulé, par des tests Rust sur de vrais dépôts, et sur l'app compilée avec deux vrais serveurs SSH). Seconde partie ci-dessous.
  - **Profil d'un remote** (`remotes.rs`, `lib/profiles.ts`) : celui choisi à la main (clic droit sur le remote : un profil, « Aucun profil » ou « Profil automatique »), sinon celui que les règles de remote désignent pour son URL, sinon le profil du dépôt. Choix rangés dans `repoProfiles[dépôt].remotes` (`null` = aucun profil). Le profil du dépôt ne donne plus que l'identité et la signature des commits. Pastille et nom du profil dans l'en-tête de chaque section de remote (infobulle : URL, URL de push si elle diffère, d'où vient le profil).
  - **Clé par remote** : une commande réseau (`fetch`, `pull`, `push`…) reçoit `GIT_SSH_COMMAND="ssh -F <config générée>"` : un bloc `Host` par hôte ssh des remotes (`IdentityFile`, `IdentitiesOnly yes`), puis `Match all` + `Include config` (le `~/.ssh/config` de l'utilisateur, tel que ssh le résout) et `Include /etc/ssh/ssh_config` (`-F` écarte aussi la config du système). Fichier nommé d'après son contenu, dans `<config>/ssh/`, réécrit s'il manque, ceux de plus d'un jour retirés au démarrage. Les remotes sont lus par `git remote -v` (`insteadOf` appliqué) à chaque commande réseau : toujours à jour, rien à synchroniser avec l'interface. Sans clé pour aucun hôte : rien n'est injecté. L'askpass reçoit aussi les clés des remotes (phrases de passe).
  - À savoir : ssh compare les blocs `Host` **en respectant la casse** → l'hôte est écrit tel qu'il est dans l'URL. Un hôte qui n'est pas un nom simple (motif, IPv6 littérale) n'a pas de bloc.
  - Les **règles** sont interprétées des deux côtés (Rust pour la clé, TypeScript pour l'affichage) : les mêmes cas de test servent aux deux (`src/lib/remoteRules.cases.json`).
  - **Push / pull par remote** : menu « Pousser vers… » à côté de Push (un remote, ou « Pousser vers tous les remotes » : `origin` d'abord, un échec n'arrête pas les autres et il est nommé) et « Tirer depuis <remote> » dans le menu du Pull — affichés à partir de deux remotes ; aussi par clic droit sur le remote. Vers un autre remote que celui de la branche suivie : la branche du même nom, sans changer le suivi ; une branche qui ne suit rien suit celle qui est créée. Fetch lit toujours tous les remotes, chacun avec sa clé.
  - **Gérer les remotes** : ajouter (bouton « + » de la barre latérale ou clic droit : nom, URL, fetch immédiat coché d'office), renommer, changer l'URL (une URL de push réglée à part n'est pas touchée), supprimer (confirmation). Un remote sans branche récupérée a sa section. Le profil choisi et les préférences de section suivent un renommage.
  - **Garde-fou** : plus de question quand le profil du dépôt est celui que les règles désignent pour l'un de ses remotes (auteur « client », `origin` chez l'entreprise).
  - Limites connues : deux remotes du même dépôt sur le même hôte avec deux clés (le premier l'emporte ; il faudrait un alias d'hôte) ; hôte en IPv6 littérale : pas de clé de profil ; pas de fetch d'un seul remote ; « Tirer depuis » ne propose que la branche du même nom ; choisir le profil d'un remote sur un dépôt sans profil l'enregistre avec « aucun profil » (plus de sélection automatique pour lui) ; avec `core.sshCommand` vers l'OpenSSH de Windows, la config du système (`%ProgramData%\ssh`) n'est pas incluse ; pas de reconnaissance du provider à l'ajout d'un remote (seconde partie).
  - Tests : 221 unitaires front, 114 unitaires Rust, 57 E2E, 11 E2E sur l'app compilée (dont deux serveurs SSH, une clé par remote).
- **Étape 6 — providers**, seconde partie : **connexion aux providers par token** et **comptes liés aux profils** — terminée (vérifiée dans le navigateur avec le backend simulé, par des tests Rust contre un faux serveur HTTP local, et sur l'app compilée avec un faux GitLab et le vrai trousseau). Reste : OAuth GitHub (*device flow*), clone depuis la liste, ajout de la clé SSH / de signature au compte, PR / MR, avatars.
  - **Compte** (`providers.rs`) : provider (`github` / `gitlab`), adresse de l'instance, login, nom. Rangé dans le profil (`profiles[].accounts` de `state.json`) ; identifiant `<provider>|<url>|<login>`. Le **token** est dans le trousseau de l'OS (`secrets.rs`, entrée `token:<identifiant>`), jamais dans `state.json` ni renvoyé à l'interface. Un même compte lié à deux profils n'a qu'un token ; il est oublié quand plus aucun profil ne porte le compte (déconnexion, profil supprimé).
  - **Instance** : champ vide → github.com / gitlab.com ; sinon un hôte (`gitlab.exemple.fr`, https d'office), `hôte:port`, `hôte/chemin` (GitLab sous un sous-chemin) ou une URL `http(s)://…`. API : `https://api.github.com`, `<instance>/api/v3` (GitHub Enterprise), `<instance>/api/v4` (GitLab). Lue des deux côtés (Rust pour l'appel, TypeScript pour le lien « Créer un token ») : mêmes cas de test (`src/lib/providerUrls.cases.json`).
  - **Connexion** : `GET /user` avec le token (`Authorization: Bearer`, jamais dans l'URL) ; le compte est celui que le token désigne. Client HTTP : `ureq` (bloquant, comme les appels à git), certificats **du système** (une instance d'entreprise signée par une autorité interne passe si l'OS lui fait confiance), délai de 20 s, **aucune redirection suivie** (le token ne part que vers l'adresse saisie). Erreurs traduites : token refusé (401), accès refusé (403 : droits, SSO, limite de requêtes), pas l'API de ce provider à cette adresse (404, redirection), réponse inattendue (une page web répond), serveur injoignable.
  - **Interface** : page Profils, section « Comptes GitHub / GitLab » (profil enregistré seulement ; connexion et déconnexion enregistrées tout de suite, comme les dépôts associés). Fenêtre « Connecter un compte » : provider, instance, token masqué, lien « Créer un token sur <hôte>… » qui ouvre la page de création avec les droits pré-cochés (GitHub : `repo, read:user, read:org, admin:public_key, admin:ssh_signing_key, write:gpg_key` ; GitLab : `api, read_user` — ceux des fonctionnalités à venir) ; un refus s'affiche dans la fenêtre, qui reste ouverte. Une adresse en `http://` est acceptée (instance interne) mais signalée : le token circulerait en clair. Pas d'annulation pendant la vérification (l'appel ne s'interrompt pas). Un compte par instance et par profil (le nouveau remplace l'ancien). À l'affichage, chaque compte est revérifié (« connecté », ou l'erreur et « Reconnecter… »).
  - **Compte d'un remote** (`lib/providers.ts`) : celui du **profil du remote** (cf. première partie) dont l'instance est sur l'hôte du remote — le port ne compte pas (ssh et web diffèrent). **Provider d'un remote** : github.com / gitlab.com, sinon l'instance d'un compte connecté (n'importe quel profil), sinon un nom d'hôte parlant (`gitlab.exemple.fr`). Barre latérale : icône du provider devant le remote ; infobulle « Compte GitLab : camille » ou « Aucun compte GitLab connecté pour ce profil ».
  - Limites connues : pas d'OAuth GitHub (il faut d'abord enregistrer une application OAuth « GitGR » chez GitHub pour avoir son identifiant client) ; les droits du token ne sont pas contrôlés à la connexion ; token *fine-grained* GitHub accepté mais ses droits sont réglés à la main ; lien de création de token GitLab : chemin des versions récentes (`/-/user_settings/personal_access_tokens`) ; hôte en IPv6 littérale refusé ; un hôte ssh différent de celui de l'interface web (`altssh.gitlab.com`) ne retrouve pas son compte ; le compte ne sert encore à rien d'autre qu'à être affiché (clone, clés, PR / MR : parties suivantes) ; pas d'identifiants HTTPS pour git (`GIT_ASKPASS`) tirés du token.
  - Tests rendus indépendants de `safe.bareRepository = explicit` (réglage global de l'utilisateur) : lecture du remote nu avec `--git-dir=.` (Rust) ou `safe.bareRepository=all` par l'environnement (`e2e-app`).
  - Tests : 253 unitaires front, 124 unitaires Rust, 59 E2E, 12 E2E sur l'app compilée.
- **Logo** : un G tracé comme une branche du graphe (trois commits colorés, HEAD au centre). Variante sombre = icône de l'app (`src-tauri/icons/logo.svg`, icônes générées par `tauri icon`, cibles desktop seulement) ; variante claire (`logo-light.svg`) utilisée dans l'app avec le thème clair (`components/Logo.tsx`, couleurs `--logo-*`). Le dessin existe en trois exemplaires (deux SVG + le composant) : les modifier ensemble, puis relancer `npx tauri icon src-tauri/icons/logo.svg` (et retirer les dossiers `android/` et `ios/` générés).

## À faire / plus tard

Retours d'utilisation, à caser dans une prochaine étape :

- [x] **Hauteur des sections** : pouvoir redimensionner la hauteur de chaque section dans chaque panneau (ex. Local / origin / Tags à gauche, détails / fichiers à droite).
- [x] **Largeur des panneaux** : pouvoir redimensionner la barre latérale, le graphe et le panneau de détails (poignées de glisser, largeurs mémorisées).
- [x] **Colonnes du graphe** : choisir les colonnes affichées (branche/tag, graphe, message, auteur, date, SHA) et leur largeur.
- [x] **Compteurs de fichiers** : distinguer ajoutés / modifiés / renommés / supprimés (ex. `+2 ~3 →1 −1`) au lieu d'un seul total.
- [x] **Détails d'un commit plus compacts** : le bloc auteur (avatar, nom, e-mail, date) prend beaucoup de place pour une info déjà visible dans le graphe, et repousse la liste des fichiers vers le bas. Le rendre discret (ex. une seule ligne « auteur · date », e-mail et committer en infobulle) pour que les fichiers modifiés remontent.
- [x] **Logo = onglet Accueil** : le logo en haut à gauche (retour à l'accueil) doit avoir le même style que les onglets de dépôts, mais sans bouton de fermeture.
- [x] **Diff côte à côte redimensionnable** : pouvoir déplacer le séparateur entre l'ancienne et la nouvelle version.
- [x] **Bloquer le menu contextuel du navigateur** : le clic droit ouvre aujourd'hui le menu de la WebView (Recharger, Inspecter…). Le désactiver partout, sauf dans les champs de saisie (copier / coller) ; nos propres menus contextuels (graphe, branches, fichiers) viendront à la place.
- [ ] **Changements cumulés de plusieurs commits** (comme GitKraken) : Ctrl+clic pour ajouter / retirer un commit de la sélection, Maj+clic pour une plage. Le panneau de droite liste les commits choisis puis les fichiers modifiés cumulés (compteurs `~ + −`, liste ou arborescence), et un clic sur un fichier montre le diff cumulé. Limites, comme GitKraken : diff cumulé seulement pour une **plage contiguë** (un parent → un descendant : `git diff <parent du plus ancien>..<plus récent>`) ou pour **deux commits** quelconques (diff de l'un à l'autre) ; pour une sélection éparse, seulement la liste des commits avec un message « sélectionnez une plage contiguë, ou un ou deux commits ». Décidé :
  - **Plage qui traverse un merge** : comme GitKraken, la plage suit les commits du graphe jusqu'à la sélection ; on peut donc sélectionner un commit au milieu d'une branche fusionnée et obtenir le cumul de cette portion.
  - **Clavier** : Maj+↑ / Maj+↓ étendent la sélection.
  - **Actions groupées** : oui, en commençant par le cherry-pick des commits choisis (dans l'ordre de l'historique) ; squash, revert… ensuite.
- [ ] **Résolution de conflits : composer le résultat librement** (défaut de GitKraken à ne pas reproduire). Pour prendre des morceaux de chaque côté, GitKraken ajoute les lignes choisies une par une **à la suite**, dans l'ordre des clics, sans pouvoir ensuite en remonter ou en descendre une. Dans GitGR : chaque ligne (ou bloc) choisie arrive à sa place logique dans le résultat, que l'on peut réordonner (glisser-déposer, Alt+↑ / Alt+↓), et le panneau du résultat reste **éditable directement** (taper, corriger, supprimer). Choix rapides en plus : « tout le côté A », « tout le côté B », « A puis B », « B puis A » pour un bloc. À faire avec la vue 3 panneaux (§2.3).
- [x] **Gérer les remotes** (fait avec l'étape 6, sauf la reconnaissance du provider à l'ajout) : ajouter un remote (nom + URL, fetch immédiat proposé), renommer, changer l'URL (fetch / push séparées si besoin), supprimer (confirmation : ses branches distantes disparaissent de la barre latérale). Depuis la barre latérale (bouton « + » de la section des remotes, clic droit sur une section de remote) et les réglages du dépôt. Préparer le terrain des providers (étape 6) : reconnaître l'hôte (GitHub / GitLab / self-hosted) à l'ajout, et proposer le bon profil.
- [ ] **Gérer les worktrees** : lister les worktrees du dépôt (section dédiée de la barre latérale : chemin, branche, verrouillé / à nettoyer), en créer un depuis une branche ou un commit (nouvelle branche ou existante, dossier proposé à côté du dépôt), l'ouvrir dans un onglet (même dépôt, autre copie de travail), le supprimer (`worktree remove`, confirmation si modifications) et nettoyer ceux dont le dossier a disparu (`worktree prune`). Dans le graphe, signaler les branches extraites dans un autre worktree (git refuse de les checkout ici : proposer d'ouvrir le worktree à la place). À vérifier : la surveillance (`watch.rs`) et `git_dir` gèrent déjà un `.git` hors de la racine, utile pour les worktrees liés.
- [x] **Renommer un onglet** : double-clic sur l’onglet, Entrée pour valider, Échap pour annuler ; champ vide = nom du dossier. Nom gardé à la réouverture, affiché aussi dans les récents de l’accueil. Clic droit : renommer, nom d’origine, couleur, fermer.
- [x] **Personnaliser un onglet** : couleur du rond au clic droit → « Couleur… » (automatique, 8 couleurs de la palette du graphe, ou couleur libre au sélecteur), gardée à la réouverture et affichée dans les récents. Reste à faire : image / icône (fichier local, avatar du dépôt).
- [x] **Couleurs fixes par nom de branche** (réglage global, case dans les réglages) : `main` / `master` en bleu, `develop` en vert, `release/*` en orange, `hotfix/*` en rose, pour les lanes (à partir du commit de la branche) et les étiquettes. Règles modifiables (page Réglages, section Graphe : motif, couleur de la palette ou couleur libre au sélecteur, ordre, ajout / suppression, règles par défaut), la case les désactive sans les perdre.
- [ ] **Groupes de dépôts** : rassembler des dépôts d'un même projet (ex. front + back), pour les voir ensemble à l'accueil et les distinguer dans les onglets (onglets groupés ou couleur / icône commune, cf. personnalisation des onglets). Rejoint « groupes / workspaces » du §5 ; à articuler avec les profils (étape 5 : un groupe pourrait porter le profil par défaut de ses dépôts).
- [ ] **Avatars des remotes** (avec les providers, étape 6) : icône GitHub / GitLab / autre devant chaque remote dans la barre latérale, et, comme GitKraken, l'avatar de l'organisation / du groupe quand le dépôt en fait partie (sinon celui du propriétaire). Mis en cache localement.
- [ ] **PR / MR depuis la vue du dépôt** (étape 6, avec le compte du remote) : tout faire sans quitter GitGR, pour GitHub (PR) comme pour GitLab (MR), instances self-hosted comprises.
  - **Créer** : depuis une branche (clic droit dans la barre latérale ou sur son étiquette dans le graphe, bouton de la barre d'outils pour la branche courante, et glisser-déposer d'une branche sur une autre : menu « Merge / Rebase / Créer une PR »). Branche poussée d'abord si elle ne l'est pas (avec son suivi). Formulaire : remote et **branche cible** (par défaut la branche par défaut du dépôt distant), titre et description pré-remplis d'après les commits (un seul commit : son message ; sinon le nom de la branche et la liste des commits), modèle de PR / MR du dépôt s'il existe, **brouillon**, relecteurs, assignés, étiquettes. Vers un fork : choix du dépôt cible.
  - **Voir** : section « Pull requests » / « Merge requests » de la barre latérale (les miennes, celles à relire, toutes les ouvertes ; filtre) ; **étiquette PR / MR** sur la branche dans le graphe et la barre latérale (numéro, état : brouillon, ouverte, approuvée, changements demandés, fusionnée, fermée ; pastille des checks) ; double-clic sur une PR = checkout de sa branche (créée au besoin, y compris depuis un fork).
  - **Vue de suivi** d'une PR / MR (panneau à la place du graphe, comme un diff) : titre, description, auteur, branches, état ; **relectures** (qui a approuvé, qui demande des changements, relecteurs en attente) ; **fil de discussion** (commentaires généraux et commentaires sur le code, par fil, résolus ou non) ; **checks / pipelines** (état de chaque job, lien vers ses logs) ; commits et fichiers modifiés, avec le diff de GitGR (en ligne ou côte à côte) et les commentaires placés sur leurs lignes ; conflits avec la branche cible signalés. Rafraîchie en arrière-plan (avec le fetch automatique) et à la demande.
  - **Agir** : **ajouter un commentaire** (général, en réponse à un fil, ou sur une ligne du diff), résoudre / rouvrir un fil, **relire** (approuver, demander des changements, commenter), modifier le titre, la description, les relecteurs, les étiquettes, passer de brouillon à prête (et inversement), fermer / rouvrir, mettre la branche à jour avec la cible. **Merger** quand tout est bon : bouton actif seulement si le provider l'autorise (checks passés, approbations requises obtenues, pas de conflit, fils résolus si le dépôt l'exige) — sinon la raison est affichée ; choix du mode permis par le dépôt (merge, squash, rebase), suppression de la branche distante proposée, puis fetch et, si la branche courante est celle qui vient d'être fusionnée, retour proposé sur la branche cible mise à jour (et suppression de la branche locale). « Merger quand les checks passent » (auto-merge / merge when pipeline succeeds) si le dépôt le permet. Toujours « Ouvrir dans le navigateur » et « Copier le lien ».
  - **Statut CI** sur les commits du graphe (pastille par commit, détail au survol) : avec la même lecture des checks / pipelines.
  - Notifications dans l'app : relecture demandée, nouveaux commentaires, checks en échec, PR prête à merger.
  - À prévoir : compte = celui du **profil du remote** (cf. §3) ; droits du token à contrôler (GitHub : `repo` ; GitLab : `api`) avec un message clair s'ils manquent ; limites de requêtes des API (cache local — c'est là que SQLite se justifiera — et requêtes conditionnelles) ; différences GitHub / GitLab à masquer derrière un même modèle (relecture GitHub ↔ approbation GitLab, checks ↔ pipelines, fils de discussion) ; actions destructives ou visibles des autres (merge, fermeture, commentaire) jamais lancées sans un clic explicite.
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
- Drag & drop d'une branche sur une autre → menu « Merge / Rebase / Créer PR » (PR / MR : cf. « À faire / plus tard »).
- Double-clic sur une branche distante → crée la locale qui la suit et checkout.
- Undo/Redo (Ctrl+Z / Ctrl+Y) des opérations : commit, checkout, reset, merge, suppression de branche…
- Recherche/filtre dans le graphe (message, auteur, SHA, fichier).
- Masquer/solo des branches dans le graphe.
- Pull avec stratégie configurable (ff-only / merge / rebase), « pull = fetch + fast-forward si possible ».

### 2.3 Plus tard (v2+)
- Résolution de conflits intégrée (vue 3 panneaux), avec un résultat réordonnable et éditable (cf. « À faire »).
- Rebase interactif visuel (réordonner / squash / fixup par drag & drop).
- Blame, historique d'un fichier.
- Submodules, Git LFS (worktrees : remontés dans « À faire »).
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
| Comptes providers liés | GitHub, GitLab (cf. §4) — fait : token personnel, un compte par instance |

Relation **repo ↔ profils : N–N**.
- Un repo a une liste de profils autorisés + **un profil actif**.
- Sélecteur de profil visible en permanence dans la barre du repo (changement en 1 clic).
- **Auto-suggestion** à l'ouverture/clone : selon l'host du remote (`github.com`, `gitlab.mon-entreprise.fr`) et/ou le dossier parent.
- Garde-fou : alerte si on s'apprête à commiter/pousser avec un profil qui ne correspond pas au remote.

**Profil du dépôt et profils des remotes** (fait, cf. « État d'avancement », étape 6) :
- Le **profil du dépôt** donne l'identité des commits (et leur signature) : un commit n'a qu'un auteur, même s'il est poussé sur plusieurs serveurs.
- Chaque **remote** peut avoir son propre profil, pour la **clé SSH** et le **compte de l'API** (PR / MR). Par défaut : celui que désignent les règles sur l'URL du remote, sinon le profil du dépôt.
- Clé par remote : au lieu de `ssh -i <clé>`, `GIT_SSH_COMMAND="ssh -F <config générée>"` avec un bloc `Host` par hôte de remote du dépôt (`IdentityFile`, `IdentitiesOnly yes`), puis `Include` du `~/.ssh/config` de l'utilisateur pour garder ses réglages. Fetch / pull / push prennent alors la bonne clé sans changer de remote. Limite : deux remotes d'un même dépôt sur le même hôte avec deux comptes (rare) demanderaient un alias d'hôte.
- Le bouton Fetch, qui fait `fetch --all`, en dépend : avec une seule clé injectée, l'un des remotes échouerait.
- Push : en plus du push vers l'upstream, menu **« Pousser vers… »** (un remote au choix) et **« Pousser vers tous les remotes »** (chacun avec sa clé). Pull : **« Tirer depuis… »**. Pas de copie automatique de branches vers un second remote : « Pousser vers tous » suffit.
- Cas d'usage qui l'a motivé : un même dépôt avec un remote sur le GitLab self-hosted de l'entreprise (relecture des MR) et un sur celui du client (CI, seules `develop` / `main` y sont poussées). Profil du dépôt = Client (auteur des commits) ; remote entreprise → profil Entreprise (clé, compte), remote client → profil Client. Que l'instance de l'entreprise reçoive des commits signés de l'identité du client est accepté.
- Autre cas déjà couvert par l'étape 5 : un seul github.com, trois comptes (perso, entreprise, client) distingués par le propriétaire du dépôt (`github.com/org-entreprise/*`…), une clé par compte (GitHub n'accepte une clé que sur un compte).

Mise en œuvre envisagée (sans toucher au `~/.ssh/config` ni au `~/.gitconfig` global) :
- Identité : `git -c user.name=… -c user.email=… commit`, injectée par l'app uniquement (acté). Bouton optionnel « Appliquer au repo » → écrit dans `.git/config` pour que l'identité vaille aussi en ligne de commande.
- SSH : variable `GIT_SSH_COMMAND="ssh -i <clé> -o IdentitiesOnly=yes"` injectée par commande réseau.
- Secrets (tokens, passphrases) : **trousseau de l'OS** (Windows Credential Manager, Secret Service/libsecret sous Linux), jamais en clair sur disque.

## 4. Intégrations providers

- **GitHub** (github.com + GitHub Enterprise, URL d'API configurable) : connexion via OAuth *device flow* (pas de secret embarqué dans l'app) ou token personnel.
- **GitLab** (gitlab.com + instances self-hosted) : token personnel, URL d'instance configurable. Pas d'OAuth pour les instances self-hosted (application à enregistrer par un administrateur de l'instance) ; OAuth PKCE éventuellement plus tard pour gitlab.com seulement.
- Token personnel : bouton qui ouvre la page de création du token sur le bon hôte, droits nécessaires pré-cochés quand le provider le permet. Tokens rangés dans le trousseau de l'OS (comme les phrases de passe), jamais dans `state.json`.
- Comptes liés aux profils (§3) : les règles de remote d'un profil désignent aussi le compte à utiliser pour l'API ; dans un dépôt à plusieurs remotes, chaque remote utilise le compte de son propre profil (§3, « profils des remotes »).

Fonctionnalités :
- Lister ses repos et **cloner** en choisissant le profil.
- **Ajouter la clé SSH du profil** au compte en un clic.
- **PR / MR depuis la vue du dépôt** : créer, voir, suivre (relectures, commentaires, checks), commenter, relire et merger — détaillé dans « À faire / plus tard ». Statut CI (pipelines / checks) sur les commits du graphe avec.
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
- JSON (`state.json` : repos connus, profils, liaisons repo↔profils, préférences) ; SQLite seulement pour un futur cache (providers, avatars).
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
6. **Providers** : profils par remote (clé SSH par hôte, « Pousser vers… / vers tous », « Tirer depuis… ») en premier, puis connexion GitHub (token ou OAuth) / GitLab (token), comptes liés aux profils, clone depuis la liste, ajout de clé SSH et de clé de signature, PR/MR.
7. **Distribution** : installeurs, updater, CI de release.
8. Merge/rebase/cherry-pick, undo/redo, palette de commandes, puis v2.

## 8. Tests

Règle : **chaque étape livre ses tests**, et `npm run test:all` doit passer avant un commit.

| Niveau | Outil | Ce qu'on y teste |
|---|---|---|
| Unitaires front | Vitest + Testing Library (jsdom) | store (onglets, persistance, erreurs), fonctions pures (`lib/format.ts`), composants, cohérence des traductions FR/EN |
| Unitaires Rust | `cargo test` + `tempfile` | parsing de la sortie git, persistance de l'état, **opérations git sur de vrais dépôts temporaires** (remote nu + clones pour ahead/behind, conflits, stash…) |
| E2E interface | Playwright (Chromium), sur Vite avec le backend simulé | parcours utilisateur : ouvrir, onglets et raccourcis, erreurs, réglages, restauration au redémarrage |
| E2E app compilée | Playwright connecté en CDP à WebView2 (`npm run test:app`, Windows) | parcours critiques de bout en bout sur de vrais dépôts : pull, checkout avec auto-stash, push |

Pourquoi Playwright sur le backend simulé : rapide, stable, identique sous Windows et Linux, et ça couvre toute la logique d'interface. La partie Rust est couverte par ses propres tests sur de vrais dépôts.

Sous Linux (avant la première release) : les E2E sur l'app compilée passeront par WebDriver (`tauri-driver`), WebKitGTK n'exposant pas CDP. Et une CI GitHub Actions Windows + Linux qui lance `test:all`.

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
