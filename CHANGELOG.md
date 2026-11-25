# Changelog

Les changements de chaque version de GitGR. Chaque PR ajoute ses lignes sous « Non publié » ;
le workflow « Nouvelle version » en fait la section de la version, et ce texte devient les
notes de la release GitHub (et celles que l'app affiche à la mise à jour).

## Non publié

- Diff au clavier : une seule tabulation, puis ↑ / ↓ de ligne en ligne et F7 / Maj+F7 de bloc en bloc. Dans les modifications en cours, Espace choisit une ligne, Maj+flèches une plage, Ctrl+A toutes ; Entrée indexe (ou retire) la sélection ou le bloc, Suppr l'abandonne (avec confirmation). Échap vide d'abord la sélection, puis ferme le diff et vous ramène au fichier.
- Diff : « Ignorer les espaces » (bouton à côté de la bascule en ligne / côte à côte) masque les changements qui ne touchent que des espaces ; l'indexation par bloc ou par ligne est alors suspendue, le temps de les réafficher.
- Diff : avec une ligne très longue, les numéros de ligne et les boutons des blocs restent à l'écran pendant le défilement horizontal. La dernière ligne sans retour à la ligne est marquée ; les lecteurs d'écran annoncent ajouts et suppressions, et le côte à côte montre les signes + / −. Plus de « −0 » sur un fichier ajouté ; chemin complet en infobulle ; « Réessayer » si le diff ne se charge pas ; numéros plus lisibles en thème sombre.
- Jeter des modifications se dit désormais « Abandonner » (le fichier, le bloc, les lignes, tout) : « Annuler » reste réservé à l'annulation d'une opération (Ctrl+Z).
- Zone de commit : « Commit en tant que Nom ‹e-mail› » au-dessus du bouton — l'identité que git va vraiment écrire (profil actif, sinon votre configuration git), avec un avertissement s'il n'y en a aucune. Le bouton grisé dit toujours pourquoi (« Écrivez un résumé pour commiter. »), sinon rappelle Ctrl+Entrée.
- Listes de fichiers au clavier : une seule tabulation par liste, ↑ ↓ (le diff suit), Maj+↑ ↓ et Ctrl+A pour sélectionner, Espace pour indexer ou retirer, Suppr pour abandonner (avec confirmation) ; Entrée depuis le graphe arrive dans la liste. Une sélection multiple se voit mieux et « Tout indexer » devient « Indexer (N) ».
- Modifications en cours : le bandeau « Merge en cours » tient sur une ligne et la description se replie tant qu'elle est vide, pour laisser la place aux fichiers ; Stash devient un bouton discret ; les fichiers en partie indexés le disent ; chemins longs raccourcis ; « Réessayer » si l'état ne peut pas être lu ; couleurs des statuts lisibles sur une ligne sélectionnée.
- Barre latérale au clavier : un arbre à une seule tabulation — ↑ / ↓, → / ← pour déplier, replier ou remonter, recherche à la frappe, Entrée montre le commit, Maj+Entrée fait le checkout (comme le double-clic), Maj+F10 ouvre le menu (aussi sur les dossiers et les sections) ; Ctrl+Maj+E y amène. La PR / MR d'une branche s'ouvre aussi depuis son menu.
- Barre latérale : le filtre montre son focus, se vide avec × ou Échap, et dit quand rien ne correspond (au lieu d'une barre vide). Sans compte connecté, la section des merge requests se réduit à une ligne d'invitation. Les noms longs (remote, stash, MR) se raccourcissent sans faire défiler la barre ; un clic ne surligne plus que la ref cliquée.
- Barre d'outils au clavier : une seule tabulation, puis ← / → d'un outil à l'autre ; raccourcis Ctrl+Maj+L (Pull), Ctrl+Maj+K (Push), Ctrl+Maj+F (Fetch), Ctrl+Maj+B (Branche), Ctrl+Maj+S (Stash), Ctrl+Maj+P (Pop), rappelés dans les infobulles. Un clic sur la pastille de la branche amène le graphe sur le commit courant.
- Barre d'outils : une action impossible dit toujours pourquoi (« Merge en cours : terminez-le ou annulez-le d'abord », « Aucune modification à mettre de côté »…), y compris au clavier et pour les lecteurs d'écran. Pendant un merge, un rebase ou un cherry-pick, une pastille l'indique dans la barre et mène aux modifications en cours ; Branche et Pop sont alors grisés comme Pull, Push et Stash.
- Barre d'outils : Fetch a sa propre icône (un nuage) et son explication, Actualiser rejoint les autres outils ; sous 1000 px de large, les outils tiennent sur une ligne (icônes seules) ; badges plus lisibles en thème sombre et plus faciles à cliquer ; boutons principaux un peu plus foncés en thème sombre pour rester lisibles.
- Conflits : les côtés portent le nom de l'opération en cours — « Notre branche » / « Branche fusionnée » pour un merge, « Branche de base » / « Vos commits » pour un rebase (où « nous » est la branche de base), « Commit repris » pour un cherry-pick.
- Conflits au clavier : le focus est dans le résultat du premier conflit à l'ouverture, F7 / Maj+F7 vont au conflit encore à régler (Alt+F7 : toute modification), Alt+← / Alt+→ prennent un côté, Ctrl+S enregistre, Échap sort du résultat ; dans une colonne, ↑ / ↓ passent d'une ligne à l'autre. Les raccourcis sont rappelés en bas de la vue.
- Conflits : les lignes longues du résultat passent à la ligne comme celles des côtés ; « Accepter » une version entière demande confirmation si des choix seraient perdus ; une modification réglée s'efface et porte une coche, le statut passe au vert quand tout est réglé ; une erreur d'enregistrement s'affiche sans faire disparaître la grille ; l'enregistrement du fichier précédent est annoncé en haut de la vue suivante.
- Bouton principal lisible au survol en thème clair.
- Graphe tout au clavier : le focus est sur le graphe à l'ouverture d'un dépôt, Ctrl+G y revient de n'importe où, Maj+F10 (ou la touche Menu) ouvre le menu du commit ou de la sélection, Entrée passe au panneau de détails. En sélection multiple, la ligne au bout de la plage est encadrée.
- Clic droit sur la ligne « Modifications en cours » : Tout indexer, Stasher les modifications, Tout abandonner. Elle s'affiche aussi dans un dépôt qui n'a pas encore de commit.
- Graphe : si la suite de l'historique ne se charge pas, les commits déjà affichés restent et « Réessayer » relance le chargement (avant, une erreur remplaçait tout le graphe) ; « Réessayer » aussi quand le dépôt ne peut pas être lu. « Début de l'historique » sous le premier commit.
- Graphe : date et SHA plus lisibles sur la ligne survolée ou sélectionnée en thème sombre, initiales lisibles sur les nœuds jaunes et verts, message raccourci complet en infobulle. L'icône du remote n'apparaît sur les étiquettes de branches qu'à partir de deux remotes. Plus d'anneau de focus autour du graphe après un simple clic.
- Réglages et profils : une sous-page par section au lieu d'une longue page (dans les profils, un sous-menu à droite de la liste : Identité, Clé SSH, Signature, Dépôts, Comptes), retenue à la réouverture ; flèches haut / bas pour passer d'une section à l'autre. Profils sur une seule colonne, contrôles alignés ; « Ne plus utiliser de clé » devient une croix dans le champ, « Copier la clé publique » va sur la ligne de la clé, et la sélection automatique est avec les dépôts associés.
- Profils : plus de bouton « Enregistrer » — chaque modification s'enregistre dès que le profil est complet ; sinon, une ligne sous son nom dit ce qui manque (« Voir » amène au champ). Même présentation que les réglages (une ligne par réglage), focus dans le nom à la création, choix de la signature aux flèches, et pour chaque règle de sélection automatique le nombre de dépôts récents qu'elle désigne, avec des exemples cliquables.
- Conflits : nouvelle vue en trois panneaux, comme dans IntelliJ — notre version à gauche, le résultat au centre, l'autre version à droite, alignés et défilant ensemble. Les modifications sans conflit sont déjà appliquées ; sur chaque conflit, » / « envoient un côté dans le résultat (le second s'ajoute après le premier), X l'écarte, la baguette le résout quand les deux côtés ont changé des mots différents. Mots modifiés surlignés, lignes prises une à une ou glissées dans le résultat, résultat modifiable à la main, F7 / Maj+F7 pour passer d'une modification à l'autre, « Accepter notre version / l'autre version ».
- Un clic sur un fichier en conflit ouvre directement sa résolution ; après l'enregistrement, le fichier en conflit suivant s'ouvre tout seul.
- Réglages : même présentation que les profils — les sections à gauche (Apparence, Git, Notifications, Graphe, À propos), un clic y amène, et une ligne par réglage au lieu d'une longue colonne centrée. Les choix se parcourent aux flèches, l'explication de l'option choisie s'affiche dessous, « Fréquence » se grise quand les notifications sont coupées, et « Règles par défaut » des couleurs de branches demande confirmation.
- Couleur d'une branche sans passer par les Réglages : clic droit sur une branche (graphe ou barre latérale), « Couleur fixe pour ce nom… », puis choisissez la couleur (palette ou couleur libre, au clic ou aux flèches). La règle se range en tête des couleurs par nom de branche ; « Retirer la couleur fixe » l'enlève. Une branche distante prend la règle de son nom sans le remote.

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
