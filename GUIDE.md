# GitGR — guide rapide

GitGR est un client Git de bureau pour Windows et Linux : un graphe des commits au centre, plusieurs identités (profils) par dépôt, et GitHub / GitLab intégrés. Ce guide présente l'essentiel en attendant le guide complet.

## Avant de commencer

- **Git doit être installé.** GitGR le détecte au démarrage et vous prévient s'il manque.
- **Windows** : l'installateur n'est pas signé, donc SmartScreen peut afficher « Windows a protégé votre ordinateur ». Cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**.
- Thème clair, sombre ou celui du système, en français ou en anglais : tout se règle dans **Réglages** (icône ⚙ en haut à droite).

## Ouvrir et cloner

- **Accueil** (logo en haut à gauche) : vos dépôts récents, avec une recherche.
- **Ouvrir un dépôt** (Ctrl+O) : choisissez un dossier qui contient déjà un dépôt Git.
- **Cloner** : collez une URL (https ou ssh), ou choisissez un dépôt dans la liste d'un compte GitHub / GitLab connecté. Les dépôts y sont rangés par propriétaire. GitGR propose le dossier de destination et le profil à utiliser, puis ouvre le dépôt dans un nouvel onglet.
- **Onglets** : un dépôt par onglet. Ctrl+Tab passe d'un onglet à l'autre, Ctrl+1…9 va directement à un onglet, Ctrl+W ferme l'onglet. Double-cliquez sur un onglet pour le renommer ; un clic droit permet de lui donner une couleur.

## Le graphe

- Toutes les branches, les tags, la HEAD et une ligne « Modifications en cours » quand vous avez des changements non commités.
- **Avatars** des auteurs sur les commits et les branches, ou leurs initiales s'ils n'en ont pas. On peut les désactiver dans les Réglages.
- Cliquez sur un commit pour voir ses détails et ses fichiers, puis sur un fichier pour voir son diff (en ligne ou côte à côte). Échap revient au graphe.
- Navigation au clavier : ↑ ↓, Page préc. / Page suiv., Début / Fin ; Maj+↑ / Maj+↓ étendent la sélection. Maj+F10 (ou la touche Menu) ouvre le menu du commit, Entrée passe au panneau de détails, Ctrl+G revient au graphe. Ctrl+F cherche un commit parmi ceux chargés.
- Les colonnes s'affichent ou se masquent d'un clic droit sur l'en-tête, et se redimensionnent à la souris. Les branches principales (`main`, `develop`, `release/*`…) ont des couleurs fixes, modifiables dans les Réglages ou d'un clic droit sur une branche (« Couleur fixe pour ce nom… »).
- Le graphe se rafraîchit tout seul quand le dépôt change ailleurs (terminal, éditeur). F5 force le rafraîchissement.

## Préparer et faire un commit

- Le panneau de droite liste les fichiers **Non indexés**, **Indexés** et **en conflit**. Un double-clic indexe ou retire un fichier.
- Dans le diff, vous pouvez indexer, retirer ou annuler **un bloc** ou **des lignes choisies** (clic, Maj+clic pour une plage).
- Écrivez un résumé et une description, puis validez avec **Commiter** ou Ctrl+Entrée. La case **Amend** corrige le dernier commit. **Pousser après le commit** est retenu pour chaque dépôt.

## Branches et serveur

- **Double-clic** sur une branche (barre latérale ou étiquette du graphe) pour l'extraire. Sur une branche distante, GitGR crée la branche locale qui la suit.
- Le clic droit sur une branche, un tag ou un commit donne accès aux actions : créer, renommer, supprimer, extraire…
- Sur une branche qui n'est pas la courante, le clic droit permet aussi de la **mettre à jour** (avance rapide) ou de la **pousser** sans y passer, de la **fusionner** dans la branche courante ou de **rebaser** la courante dessus, de choisir la branche qu'elle suit, et de supprimer à la fois la branche locale et sa distante. Une action impossible est grisée ; survolez-la pour savoir pourquoi.
- **Glissez un commit** du graphe sur une branche (barre latérale ou étiquette du graphe) pour le cherry-pick dessus, remettre la branche courante sur ce commit (reset), ou y déplacer une autre branche. Échap annule le glisser.
- **Annuler / Rétablir** (Ctrl+Z / Ctrl+Y, ou les boutons de la barre d'outils) : la dernière opération de GitGR (commit, checkout, branche créée ou supprimée, pull, merge, rebase, cherry-pick, reset…) est défaite, vos modifications en cours restent. Si le dépôt a changé entre-temps (commande lancée ailleurs), GitGR refuse plutôt que de deviner.
- Barre d'outils : **Pull** (mode au choix : avance rapide, merge ou rebase), **Push**, **Fetch**, **Branche**, **Stash** / **Pop**. Les compteurs ↑ ↓ indiquent ce qu'il reste à pousser ou à tirer.
- **Mise de côté automatique** : si des modifications locales empêchent un changement de branche ou un pull, GitGR les met de côté puis les réapplique. En cas de conflit, rien n'est perdu : un bandeau propose de les réappliquer.
- **Fetch automatique** du dépôt affiché, toutes les 10 minutes par défaut (réglable).
- **Remotes** : ajout, renommage, changement d'URL et suppression depuis la barre latérale (bouton +, ou clic droit). Avec plusieurs remotes, vous pouvez **pousser vers un remote précis** ou vers tous.

## Profils : une identité par contexte

Un profil réunit un nom, un e-mail, une clé SSH, une signature des commits et des comptes GitHub / GitLab. On les gère depuis l'icône **Profils et comptes** en haut à droite.

- **Identité** : GitGR l'applique à chaque commande du dépôt, sans toucher à votre configuration Git. Vous pouvez aussi l'écrire dans `.git/config` pour la ligne de commande.
- **Clé SSH** : choisissez une clé existante ou faites-en générer une. La phrase de passe est rangée dans le trousseau du système.
- **Signature des commits** : GPG ou SSH, par profil.
- **Choix automatique** : des règles (un hôte comme `github.com/mon-org`, ou un dossier comme `~/travail/*`) désignent le bon profil pour chaque dépôt. Chaque remote peut avoir son propre profil, donc sa propre clé.
- **Garde-fou** : avant un commit ou un push, GitGR vous prévient si un autre profil correspond mieux au dépôt.
- Le profil actif reste visible en bas de l'écran ; un clic dessus permet d'en changer.

## Comptes GitHub et GitLab

- Dans un profil, cliquez sur **Connecter un compte**. Pour github.com, **Se connecter avec GitHub** suffit : saisissez le code affiché sur la page de GitHub. Pour GitLab, GitHub Enterprise ou une instance d'entreprise, utilisez un **token personnel** (un lien ouvre sa page de création, avec les droits déjà cochés).
- Les tokens sont rangés dans le trousseau du système, jamais en clair.
- Sous chaque compte, GitGR indique si la clé SSH et la clé de signature du profil sont déjà enregistrées sur le compte. **Ajouter au compte** les envoie en un clic.
- Les avatars des organisations et des groupes s'affichent devant les remotes et dans la fenêtre de clone.

## Mises à jour

- Vous n'avez rien à faire : au démarrage, GitGR télécharge la nouvelle version en arrière-plan, sans vous interrompre, puis l'installe quand vous le fermez. Le lancement suivant ouvre la nouvelle version.
- Un message discret prévient quand elle est prête ; **Redémarrer maintenant** l'installe tout de suite, **Nouveautés** ouvre les notes de version.
- En bas des **Réglages** : la version installée, **Rechercher les mises à jour**, et la case **Installer les mises à jour automatiquement**. Décochée, GitGR annonce seulement la nouvelle version, avec **Installer et redémarrer**.
- Installé avec un paquet `.deb` ou `.rpm`, GitGR prévient seulement : la mise à jour passe par votre gestionnaire de paquets (`apt`, `dnf`…).
- Windows : à l'installation, la case « Créer un raccourci sur le bureau » est décochée par défaut ; les mises à jour n'en créent pas.

## À venir

Groupes de dépôts, état des dépôts sur l'accueil, résolution de conflits intégrée… Le détail est dans [docs/NOTES.md](docs/NOTES.md).
