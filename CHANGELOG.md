# Changelog

Les changements de chaque version de GitGR. Chaque PR ajoute ses lignes sous « Non publié » ;
le workflow « Nouvelle version » en fait la section de la version, et ce texte devient les
notes de la release GitHub (et celles que l'app affiche à la mise à jour).

## Non publié

- Profils : plus de bouton « Enregistrer » — chaque modification s'enregistre dès que le profil est complet ; sinon, une ligne sous son nom dit ce qui manque (« Voir » amène au champ). Même présentation que les réglages (une ligne par réglage), focus dans le nom à la création, choix de la signature aux flèches, et pour chaque règle de sélection automatique le nombre de dépôts récents qu'elle désigne, avec des exemples cliquables.
- Conflits : nouvelle vue en trois panneaux, comme dans IntelliJ — notre version à gauche, le résultat au centre, l'autre version à droite, alignés et défilant ensemble. Les modifications sans conflit sont déjà appliquées ; sur chaque conflit, » / « envoient un côté dans le résultat (le second s'ajoute après le premier), X l'écarte, la baguette le résout quand les deux côtés ont changé des mots différents. Mots modifiés surlignés, lignes prises une à une ou glissées dans le résultat, résultat modifiable à la main, F7 / Maj+F7 pour passer d'une modification à l'autre, « Accepter notre version / l'autre version ».
- Un clic sur un fichier en conflit ouvre directement sa résolution ; après l'enregistrement, le fichier en conflit suivant s'ouvre tout seul.
- Réglages : même présentation que les profils — les sections à gauche (Apparence, Git, Notifications, Graphe, À propos), un clic y amène, et une ligne par réglage au lieu d'une longue colonne centrée. Les choix se parcourent aux flèches, l'explication de l'option choisie s'affiche dessous, « Fréquence » se grise quand les notifications sont coupées, et « Règles par défaut » des couleurs de branches demande confirmation.

## [0.3.1] — 2026-11-24

- Remotes en HTTPS : le token du compte GitHub / GitLab du profil du remote sert à fetch, pull, push et clone (avant, seuls les identifiants enregistrés dans Git étaient essayés, d'où « Authentification refusée »).

## [0.3.0] — 2026-11-24

- Résolution des conflits dans GitGR (bouton « Résoudre » d'un fichier en conflit) : chaque bloc avec ses deux côtés et un peu de contexte, lignes colorées (ajoutée, modifiée, supprimée), une case par ligne pour composer le résultat dans l'ordre des clics, choix rapides (A, B, A puis B, B puis A), résultat modifiable à la main (Alt+↑ / Alt+↓ pour déplacer des lignes), et le fichier résultant entier en bas. « Enregistrer » écrit le fichier et le marque résolu.
- Historique d'un fichier (clic droit sur un fichier) : les commits qui l'ont modifié, renommages suivis, avec le diff de chacun.
- Blame d'un fichier : le commit de chaque ligne, au commit choisi ou sur la copie de travail, couleur selon l'âge des lignes, et « Blame avant ce commit » pour remonter.
- Tags : créer un tag (léger ou annoté) sur un commit, le pousser, le supprimer ici et / ou sur le remote.
- Recherche dans le graphe (Ctrl+F) par message, auteur ou SHA ; les résultats de « Chercher dans les modifications » peuvent y être mis en évidence (F3 pour passer de l'un à l'autre).
- Sélecteur rapide de dépôts (Ctrl+E), avec recherche floue.
- Onglets : une marque sur la pastille signale des fichiers pas encore commités ou des commits à pousser / tirer.
- Accueil : branche, commits à pousser / tirer et fichiers pas encore commités de chaque dépôt récent.
- Glisser une branche sur une autre : merge, rebase ou PR / MR. Glisser une sélection de commits sur une branche : cherry-pick du lot.
- Auto-stash réglable par dépôt (clic droit sur l'onglet).

## [0.2.0] — 2026-11-23

- Barre du bas : date du dernier fetch.
- Annuler / rétablir (Ctrl+Z / Ctrl+Y, ou les boutons de la barre d'outils) la dernière opération : commit, checkout, branche créée ou supprimée, pull, merge, rebase, cherry-pick, reset… Les modifications en cours sont gardées.
- Glisser un commit du graphe sur une branche : cherry-pick dessus, reset de la branche courante, ou déplacement d'une autre branche sur ce commit.
- Menu contextuel d'une branche bien plus complet : pull (avance rapide) et push d'une branche sans y passer, branche suivie à choisir, merge dans la branche courante et rebase de la courante dessus, reset de la courante (soft / mixed / hard), cherry-pick et revert de son commit, suppression de la locale et de la distante en une fois. Les actions impossibles sont grisées avec la raison.

## [0.1.3] — 2026-11-23

- Aucun changement fonctionnel : version qui sert à vérifier la mise à jour silencieuse (téléchargement en arrière-plan, installation à la fermeture) depuis la 0.1.2.

## [0.1.2] — 2026-11-23

- Mises à jour silencieuses : la nouvelle version se télécharge en arrière-plan et s'installe à la fermeture de GitGR, sans rien à faire ni interruption. « Redémarrer maintenant » pour l'installer tout de suite ; une case des Réglages pour revenir à l'annonce seule.
- Barre du bas : un clic sur le dossier du dépôt l'ouvre dans l'explorateur, un clic sur origin ouvre la page du dépôt dans le navigateur.

## [0.1.1] — 2026-11-23

- Aucun changement fonctionnel : version qui sert à vérifier la mise à jour automatique depuis la 0.1.0.

## [0.1.0] — 2026-11-23

Première version publique.

- Graphe des commits de tous les dépôts ouverts en onglets, détails et diff (en ligne ou côte à côte).
- Copie de travail : indexation par fichier, bloc ou ligne, commit, amend, stash.
- Branches et réseau : checkout avec auto-stash, fetch / pull / push, plusieurs remotes.
- Profils : identité Git, clé SSH et signature des commits par profil, appliqués par dépôt et par remote.
- Comptes GitHub et GitLab (y compris auto-hébergés) : clone depuis la liste, publication d'un dépôt, pull / merge requests, notifications.
- Mises à jour automatiques (installateur Windows, AppImage) ; les paquets deb / rpm passent par le gestionnaire de paquets.
