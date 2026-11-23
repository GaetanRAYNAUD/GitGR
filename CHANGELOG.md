# Changelog

Les changements de chaque version de GitGR. Chaque PR ajoute ses lignes sous « Non publié » ;
le workflow « Nouvelle version » en fait la section de la version, et ce texte devient les
notes de la release GitHub (et celles que l'app affiche à la mise à jour).

## Non publié

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
