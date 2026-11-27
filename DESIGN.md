---
name: GitGR
description: Client Git de bureau rapide et léger — graphe des commits, plusieurs identités par dépôt, GitHub et GitLab intégrés.
colors:
  accent: "#3b7bf0"
  accent-text: "#ffffff"
  accent-fill: "#3366c5"
  del-fill: "#9c494b"
  link: "#7fb0ff"
  bg: "#121418"
  side: "#14161b"
  panel: "#181b21"
  panel2: "#1e222a"
  hover: "#252a33"
  sel: "#22314b"
  border: "#2a2f39"
  border-strong: "#363c49"
  text: "#e7e9ee"
  muted: "#a3a9b5"
  faint: "#878e9b"
  add: "#4cc38a"
  mod: "#e8b84a"
  del: "#f06a6a"
  merged: "#b48cf2"
  lane-0: "#5b95ff"
  lane-1: "#f0913f"
  lane-2: "#2bbcae"
  lane-3: "#b588f2"
  lane-4: "#e8618c"
  lane-5: "#9ccc4a"
  lane-6: "#e8c547"
  lane-7: "#4fc3e8"
typography:
  headline:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
  dialog-title:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
  body:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  eyebrow:
    fontFamily: "Inter Variable, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  xs: "4px"
  chip: "5px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  card: "12px"
  dialog: "14px"
  full: "999px"
spacing:
  "2xs": "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  "2xl": "14px"
  dialog: "24px"
components:
  button:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#4976ca"
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
    height: "44px"
  tool-button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  badge:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.md}"
    padding: "0 4px"
    height: "16px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.faint}"
    rounded: "7px"
    size: "32px"
  icon-button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  op-pill:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "5px 11px"
  input:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  ref-chip:
    textColor: "{colors.text}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.chip}"
    padding: "0 7px"
    height: "20px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "8px 8px 0 0"
    height: "32px"
  tab-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
  window-control:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    width: "46px"
    height: "40px"
  window-control-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  window-close-hover:
    backgroundColor: "{colors.del-fill}"
    textColor: "{colors.accent-text}"
  commit-row:
    textColor: "{colors.text}"
    typography: "{typography.body}"
    height: "28px"
  commit-row-hover:
    backgroundColor: "{colors.hover}"
  commit-row-selected:
    backgroundColor: "{colors.sel}"
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  context-menu:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "4px"
  dialog:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.dialog}"
    width: "480px"
  statusbar:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    height: "26px"
---

# Design System: GitGR

## Overview

**Creative North Star: "L'Établi"**

GitGR est un atelier rangé. Chaque outil est à portée de main, à sa place, et rien n'est là pour décorer. L'écran est dense comme un IDE (IntelliJ, VS Code) : lignes de 28px, texte de 13px, panneaux redimensionnables bord à bord, pas d'aération façon site web. Le bois de l'établi, ce sont des gris bleutés à plat ; les seules couleurs vives sont celles du travail lui-même — les voies du graphe, les puces de branches, les ajouts, modifications et suppressions.

Les contrôles sont précis et discrets : gris par défaut, l'accent bleu réservé à l'action principale, à la sélection et au focus. Les panneaux sont à plat, séparés par des tons et des bordures de 1px ; seul ce qui flotte au-dessus (menu contextuel, dialogue, toast, popover) porte une ombre. Le mouvement est rare et bref, et disparaît avec `prefers-reduced-motion`.

Deux thèmes complets, sombre (par défaut) et clair, plus « suivre le système ». Toutes les couleurs passent par les variables CSS de `src/styles.css` ; le thème clair les redéfinit sous `:root[data-theme="light"]`.

**Key Characteristics:**
- Densité d'IDE : lignes de 28px, corps de 13px, libellés de 11 à 12px.
- Gris bleutés à plat, profondeur par le ton et la bordure, pas par l'ombre.
- La couleur vive appartient au contenu (voies, branches, diff), pas au chrome.
- Accent bleu unique pour l'action principale, la sélection et le focus.
- Clair et sombre à parité ; FR et EN à parité.

## Colors

Une base neutre gris bleuté en cinq paliers, un accent bleu unique, trois couleurs sémantiques de diff, le violet des PR / MR fusionnées et huit couleurs de voies pour le graphe. Les valeurs du frontmatter sont celles du thème sombre (`:root`) ; le thème clair redéfinit chaque jeton avec un contraste renforcé (accent `#2f6fe0`, texte `#191c22`, voies et sémantiques assombries pour rester lisibles sur blanc).

### Primary
- **Bleu Établi** (accent) : sélection active, anneau de focus (`outline: 2px solid`), liseré gauche de l'élément actif (`inset 3px 0`), compteur de notifications.
- **Bleu Plein** (accent-fill) : fond des contrôles pleins sur l'accent — bouton principal, mini-bouton principal, badges des outils. En sombre, `color-mix(in srgb, var(--accent) 80%, var(--bg))` (la valeur du frontmatter en est le résultat) : le texte blanc ne fait que 4.0:1 sur l'accent seul, il passe AA sur ce bleu assombri. En clair, égal à `accent`. Le texte posé dessus est `accent-text`.
- **Bleu Lien** (link) : liens et boutons de type lien, en graisse 600.

### Neutral
- **Fond d'atelier** (bg) : fond de la fenêtre, barre de titre, barre d'état.
- **Ombre de rangement** (side) : barre latérale des refs, un cran sous le fond.
- **Plan de travail** (panel) : panneaux, onglet actif, menus, dialogues, en-tête du graphe.
- **Plan surélevé** (panel2) : boutons au repos, champs de saisie, contrôles segmentés.
- **Survol** (hover) : survol des lignes, des éléments de liste, des boutons.
- **Sélection** (sel) : commit ou fichier sélectionné, bleu très sourd.
- **Bordure** (border) et **Bordure marquée** (border-strong) : séparations de 1px entre panneaux et contour des contrôles.
- **Texte** (text), **Texte secondaire** (muted), **Texte effacé** (faint) : trois niveaux d'encre ; `faint` sert aux libellés en capitales, aux icônes au repos et aux métadonnées.

### Sémantiques
- **Ajout** (add), **Modification** (mod), **Suppression** (del) : diff, statut des fichiers, état des checks (succès, en attente, échec), toasts d'erreur. Les fonds teintés se font par `color-mix(in srgb, var(--add) N%, transparent)`, jamais par une nouvelle couleur.
- **Fusionnée** (merged) : le violet des forges pour une PR / MR fusionnée — icône et contour de sa pastille d'état, mention « fusionnée » en tête de la discussion. En clair, `#7a3fd1`. Jamais ailleurs : ce n'est pas un quatrième accent.

### Voies du graphe
- **lane-0 à lane-7** (`--g0` à `--g7`) : bleu, orange, sarcelle, violet, rose, vert, jaune, cyan. Colorent les voies et nœuds du graphe, les puces de branches (`--chip`), les avatars. Les branches principales (`main`, `develop`, `release/*`…) ont des couleurs fixes, modifiables dans les réglages. La résolution de conflits réutilise accent, add et del (`--m-ours`, `--m-both`, `--m-conflict`).

### Named Rules
**The Variable-Only Rule.** Aucune couleur en dur dans un composant : toujours `var(--jeton)` ou un `color-mix()` d'un jeton. Une couleur en dur casse le thème clair.

**The Filled-Accent Rule.** Un fond plein bleu sous du texte prend `--accent-fill`, jamais `--accent` : l'accent seul reste pour le focus, la sélection et les liserés, où aucun texte blanc ne se pose dessus. Même chose pour le rouge des actions destructives (bouton de confirmation, survol de Fermer dans les contrôles de fenêtre) : `--del-fill` (en sombre `color-mix(del 62%, bg)`, en clair `--del`).

**The Content-Owns-Color Rule.** Le chrome (barres, panneaux, boutons) reste neutre. Les couleurs vives sont réservées à ce qui vient du dépôt : voies, branches, diff, état des checks. L'accent bleu est la seule exception, et il marque une action ou une sélection.

## Typography

**Body Font:** Inter Variable (avec Inter, Segoe UI, system-ui)
**Mono Font:** JetBrains Mono 400 / 500 (avec ui-monospace)

**Character:** Une sans-serif d'interface neutre et lisible à petite taille, doublée d'une mono pour tout ce qui vient de Git (SHA, chemins, diff, noms de branches dans la barre d'état). La hiérarchie se fait par la graisse (600 domine) plus que par la taille.

### Hierarchy
- **Headline** (700, 26px, -0.01em) : titre de l'écran d'accueil.
- **Title** (700, 20px) : en-têtes des pages Réglages et Profils.
- **Dialog title** (700, 18px) : titre des dialogues.
- **Body** (400, 13px, 1.45) : texte par défaut, lignes du graphe, éléments de liste, menus.
- **Body small** (12.5px) : descriptions, textes d'aide, onglets.
- **Label** (600, 12px) : libellés de champs, en-têtes de section.
- **Eyebrow** (600, 11px, 0.05–0.06em, capitales) : en-têtes de colonnes du graphe, titres de groupes dans la barre latérale ; couleur `faint`.
- **Mono** (400, 12px ; 11px dans la barre d'état) : SHA, chemins, diff, code. Sélectionnable (`user-select: text`), alors que le reste de l'interface ne l'est pas.

### Named Rules
**The Weight-Not-Size Rule.** Dans l'app, on hiérarchise par la graisse (400 / 500 / 600 / 700) et la couleur d'encre (text / muted / faint), pas en grossissant le texte. Rien au-dessus de 13px hors titres d'écran et de dialogue.

**The Git-Is-Mono Rule.** Tout identifiant Git (SHA, chemin, ref brute, diff) s'affiche en JetBrains Mono ; la prose et les libellés jamais. Exception : dans la barre latérale, les noms de branches et de tags sont des libellés de liste (police d'interface, plus lisible à 13px) ; leurs compteurs ↑ ↓ restent en mono.

## Layout

Fenêtre plein écran sans marge : barre de titre à onglets (40px), barre d'outils (pastille de branche, pastilles d'état, puis rangée d'actions avec libellé sous l'icône), puis trois colonnes redimensionnables par poignées — barre latérale des refs à gauche, graphe au centre, panneau de détails ou des modifications à droite — et une barre d'état de 26px en bas.

- **Rythme vertical** : lignes de 28px (graphe, barre latérale, menus), contrôles de 32 à 36px, puces de 20px.
- **Espacements** : petits pas de 2, 4, 6, 8, 10, 12 et 14px ; 6px et 8px dominent les `gap`. Les dialogues ont 24px de marge intérieure.
- **Graphe** : grille à colonnes (`--cols`) avec largeurs par variable (`--col-refs` 180px, `--col-author` 130px, `--col-date` 96px, `--col-sha` 72px), en-tête collant, lignes virtualisées en position absolue, largeur minimale 760px.
- **Adaptation** : sous 1240px les colonnes du graphe se resserrent et le SHA disparaît ; sous 1000px la barre d'outils tient sur une ligne (libellés des outils masqués, pastilles réduites au compteur ou à l'icône) ; sous 720px la mise en page des pages se simplifie. Pas de mise en page mobile : c'est une app de bureau.
- **Pages de gestion** (réglages, profils) : barre latérale de 270px sur `side` (titre, fermeture, liste des sections ou des profils, élément courant sur `sel`), puis le contenu aligné à gauche, 760px au plus, en une seule colonne. Jamais de colonne centrée. Chaque section est une **sous-page** (pas de longue page à défiler) : dans les réglages, la barre latérale les liste ; dans les profils, un sous-menu de 200px entre la liste des profils et la fiche. Flèches haut / bas dans la barre ; la sous-page ouverte est retenue.
- **Lignes de réglage** : libellé à gauche (220px), contrôle à droite à sa largeur naturelle, aide dessous en 12px `muted` ; libellé aligné sur la première ligne du contrôle ; dans une fiche, tous les contrôles sur la même largeur (480px) pour un bord droit régulier. Une action qui retire une valeur (« Ne plus utiliser de clé ») est une croix dans le champ, pas un bouton à côté d'actions sans rapport ; une case à cocher se place devant son libellé, comme dans un IDE. Sous 960px, le contrôle passe sous le libellé.
- **Enregistrement** : tout s'applique tout de suite, sans bouton « Enregistrer ». Un objet qui doit rester cohérent (un profil) s'enregistre dès qu'il est complet, après une courte pause pendant la frappe ; tant qu'il ne l'est pas, une ligne d'état sous son nom dit ce qui manque, avec « Voir » qui amène au premier champ à corriger.
- **Accueil** : colonne avec cartes ; c'est le seul écran qui respire davantage.

**The Edge-To-Edge Rule.** Les panneaux de l'app vont bord à bord, séparés par une bordure de 1px. Pas de cartes flottantes ni de marges autour des panneaux de travail.

## Elevation & Depth

Système à plat. La profondeur vient de cinq paliers de ton (`side` < `bg` < `panel` < `panel2` < `hover`) et des bordures de 1px. Les ombres sont réservées aux éléments qui flottent au-dessus de l'app.

### Shadow Vocabulary
- **Flottant** (`--shadow` : `0 12px 32px rgba(0,0,0,0.35)` en sombre, `rgba(20,24,32,0.14)` en clair) : menus contextuels, dialogues, toasts, popovers.
- **Voile** (`--scrim` : `rgba(8,10,14,0.55)` dans les deux thèmes) : derrière une fenêtre modale.
- **Liseré actif** (`box-shadow: inset 3px 0 0 var(--accent)`) : marque l'élément actif d'une liste ; en `var(--mod)` sur un fond teinté à 9 %, il signale la ligne « Modifications en cours » du graphe.
- **Anneau de focus interne** (`inset 0 0 0 2px var(--accent)`) : zones défilantes focalisées au clavier, comme le graphe.

**The Flat-By-Default Rule.** Un panneau, une carte, une ligne ou un bouton n'a jamais d'ombre portée. Si ça ne flotte pas au-dessus du reste, c'est à plat.

## Shapes

Coins doucement arrondis, de plus en plus ronds à mesure que l'élément grandit : 4–5px pour les petites marques et puces, 6px pour les éléments de liste et de menu, 7–8px pour les boutons, champs et onglets, 10px pour les menus et toasts, 12px pour les cartes, 14px pour les dialogues. Les onglets ne sont arrondis qu'en haut (8px 8px 0 0) pour se fondre dans le panneau. Avatars, nœuds du graphe et points d'état sont des cercles parfaits ; les pastilles de compteur sont en pilule (999px).

Icônes au trait, 1.7 d'épaisseur, bouts et jointures arrondis, couleur héritée (`currentColor`).

## Components

### Buttons
Précis et discrets.
- **Shape:** coins doucement arrondis (8px), hauteur 36px, icône et texte espacés de 8px, graisse 500.
- **Default:** fond `panel2`, bordure `border`, texte `text`. Survol : fond `hover`.
- **Primary:** fond et bordure `accent-fill`, texte `accent-text`. Un seul par zone. Survol : `color-mix(in srgb, var(--accent-fill) 88%, var(--text))`, fond et bordure — jamais le survol neutre `hover`, qui mettrait du blanc sur du gris clair.
- **Disabled:** opacité 0.5, curseur par défaut ; une action impossible est grisée, et son infobulle dit pourquoi. Dans la barre d'outils, elle reste focalisable (voir Tool buttons).
- **Icon button:** 32×32px, sans fond ni bordure, icône `faint` ; survol `hover` + icône `text`.
- **Focus:** anneau `2px solid accent`, décalé de 1px, sur tous les contrôles (`:focus-visible`). Dans un conteneur qui rogne son contenu (rangée d'onglets qui défile), l'anneau passe à l'intérieur (décalé de -2px).

### Tool buttons (barre d'outils)
Icône au-dessus d'un libellé court (Pull, Push, Fetch, Branche, Stash…), sans fond au repos : 44px de haut, 52px de large au moins, coins 8px, libellé 11px 500 `muted` ; survol `hover` + `text`. Fetch a l'icône nuage-flèche (`cloudDown`) ; la flèche circulaire reste à Actualiser.
- **Clavier:** la rangée est un `role="toolbar"` à une seule tabulation ; ← / → / Début / Fin passent d'un outil à l'autre. Raccourcis Ctrl+Maj+lettre (Pull L, Push K, Fetch F, Branche B, Stash S, Pop P), annoncés entre parenthèses dans l'infobulle.
- **Grisé:** une action impossible reste focalisable (`aria-disabled`, pas `disabled`), opacité 0.6, curseur par défaut, sans survol ; sa raison est dans l'infobulle et lue par `aria-description`.
- **Badges:** compteur de 16px sur `accent-fill`, texte `accent-text` 10px 600, accolé à l'icône. Cliquable, il a une cible de 24px (pseudo-élément débordant de 4px) ; atténué (0.55) quand son outil est grisé.
- **Étroit (< 1000px):** libellés masqués visuellement mais gardés pour les lecteurs d'écran et en infobulle ; outils de 36px au moins.

### Pastilles d'état (barre d'outils)
- **Branche courante:** bouton de 44px, fond `panel2`, bordure, coins 8px ; nom du dépôt au-dessus, branche et ↑ ↓ en dessous. Survol `hover` ; un clic amène le graphe sur le commit courant.
- **Modifications en cours:** pilule (999px), bordure `color-mix(--mod 45%)`, fond `--mod` à 12 % (22 % au survol ou active), point `mod`, 12px 600.
- **Opération en cours** (merge, rebase…) : même pilule, fond transparent (`--mod` à 12 % au survol), icône alerte en `mod`. Elle dit pourquoi pull, push et stash sont grisés et mène au panneau des modifications.
- **Étroit (< 1000px):** chaque pastille se réduit à son compteur ou à son icône ; le libellé reste lu.

### Chips (puces de refs)
- **Style:** 20px de haut, coins de 5px, 11px en graisse 600. Fond `color-mix(--chip 20%)`, bordure `color-mix(--chip 55%)`, où `--chip` est la couleur de voie de la branche.
- **Variantes:** branche locale, distante (icône nuage), tag, HEAD (coche) ; la branche courante est marquée par une coche.

### Inputs / Fields
- **Style:** 36px, fond `panel2`, bordure `border`, coins 8px, padding 0 10px. Libellé au-dessus en 12px 600 `muted`.
- **Recherche / filtre:** même forme, icône loupe `faint` à gauche, fond `panel`.
- **Focus:** anneau d'accent `2px solid`, comme tous les contrôles.
- **Segmented control:** rangée de boutons dans un conteneur `panel2` de 3px de padding, l'option active sur `sel`, à plat. Un seul arrêt de tabulation par groupe ; les flèches, Début et Fin changent l'option. L'aide de l'option choisie s'affiche dessous, jamais seulement en infobulle.

### Navigation (onglets)
- **Onglets de dépôt:** 32px, coins arrondis en haut seulement, texte `muted` sur fond transparent ; survol `hover` ; actif `panel` + `text`, il se fond dans le panneau en dessous. Couleur d'onglet au choix ; point d'état (travail en attente, à pousser / tirer) sur la pastille. Glissé pour réordonner, l'onglet déplacé passe sur `panel` avec un contour de 1px `border-strong`.
- **Rangée qui défile:** chaque onglet rétrécit de 220px à 120px au plus, puis la rangée défile horizontalement sans barre visible (molette ; l'onglet actif est ramené dans le champ). Un bord où des onglets sont coupés passe en fondu sur 28px (masque en dégradé, d'un côté ou des deux), jamais en flèches de défilement. Le bouton « + » et les fermetures ne rétrécissent pas.
- **Focus des onglets:** l'anneau d'accent passe à l'intérieur de l'onglet (décalé de -2px, coins arrondis en haut) : la rangée qui défile rognerait l'anneau commun.
- **Contrôles de fenêtre:** 46×40px sans fond, icône `muted` ; survol `hover` + `text` ; Fermer au survol prend `del-fill` et `accent-text`.
- **Logo = onglet Accueil:** même forme, sans bouton de fermeture.
- **Barre latérale des refs:** éléments de 28px, coins 6px, indentation de 14px par niveau ; sections repliables avec en-tête en capitales `faint` et compteur. Au clavier, un arbre (`role="tree"`) à une seule tabulation : ↑ / ↓, → / ← (déplier, replier, parent), recherche à la frappe, Entrée (le commit), Maj+Entrée (checkout, comme le double-clic), Maj+F10 (menu, aussi sur les dossiers et en-têtes), Alt+↑ / ↓ sur un en-tête pour sa hauteur ; Ctrl+Maj+E y amène. Le libellé passe avant la méta (↑ ↓, date) ; un nom trop long se raccourcit, jamais de défilement horizontal. Filtre : focus marqué sur son cadre, × et Échap pour le vider, une ligne quand rien ne correspond. Section des PR / MR sans compte : une seule ligne d'invitation.

### Listes de fichiers (modifications, détails d'un commit)
`listbox` (ou `tree` en arborescence) à une seule tabulation : ↑ / ↓ / Début / Fin (le diff suit), Maj+↑ / ↓ et Ctrl+A pour la sélection, Espace = indexer / retirer, Suppr = annuler (confirmé), → / ← sur les dossiers, Maj+F10 = menu. Les boutons d'une ligne (Indexer, poubelle) ne sont pas des arrêts de tabulation ; une sélection multiple porte un liseré de l'accent et remplace « Tout indexer » par « Indexer (N) ». Le nom lu est le fichier, le statut et le dossier en description.

### Diff
Table mono 12px (interligne 1.6), lignes teintées `color-mix(--add / --del 14 %)`, mots modifiés à 45 %, en-têtes de bloc sur `panel2` en `faint`. Numéros `faint` sur le contexte, `muted` sur une ligne modifiée ; signes + / − (aussi en côte à côte) mêlés à 82 % de `text`. En ligne, une ligne longue fait défiler le code seul : numéros et en-tête de bloc sont figés (`position: sticky`, fond `--diff-surface` + teinte de la ligne). En-tête : retour, statut, chemin (le nouveau nom passe avant l'ancien), stats sans compteur nul, actions du fichier, puis les bascules toujours au bout (« Ignorer les espaces », en ligne / côte à côte) ; étroit, les actions passent à la ligne.
- **Clavier:** une grille (`role="grid"`) à une seule tabulation, ligne active par `aria-activedescendant`, anneau de 2px d'accent autour de la ligne (au clavier seulement). ↑ / ↓ / Pg↑ / Pg↓ / Début / Fin, F7 / Maj+F7 de bloc en bloc ; dans la copie de travail, Espace choisit, Maj+flèches étendent, Ctrl+A, Entrée indexe ou retire (la sélection, sinon le bloc), Suppr abandonne (confirmé). Les boutons de bloc ne sont pas des arrêts de tabulation ; les raccourcis sont dans la ligne d'aide sous l'en-tête. Échap vide la sélection, puis ferme la vue et rend le focus au fichier.
- **Lecteurs d'écran:** chaque ligne commence par « Ajout, ligne N : » / « Suppression… » (texte masqué) ; la couleur n'est jamais seule.
- **Vocabulaire:** jeter des modifications = « Abandonner » ; « Annuler » est réservé à l'undo.

### Zone de commit
Résumé (compteur relié au champ), description (une ligne tant qu'elle est vide), Amend / Pousser après, puis **l'identité du commit** — « Commit en tant que Nom ‹e-mail› », lue par git (profil actif, sinon config git), teinte `mod` si aucune — avec le profil à droite ; dessous, la raison du bouton grisé, sinon le raccourci. Commiter est le seul plein ; Stash est secondaire, sans fond (icône seule quand le panneau est étroit).

### Suivi PR / MR
Vue d'une PR / MR dans le panneau central, bord à bord comme le reste de l'app.
- **En-tête:** titre en 600 (une ligne, coupé), pastille d'état, puis une ligne de méta en 12.5px `muted` (branches source → cible, puce « fork » de 4px en `border-strong`, étiquettes de la forge en pilule teintée à 22 % de leur couleur, contour à 60 %, texte `text`), filet bas de 1px.
- **Pastille d'état:** pilule de 10px de rayon, padding 2px 8px, 12px 600. Teintée, jamais pleine : fond `color-mix(--state 16 %)`, contour interne `inset 0 0 0 1px` à 45 %, texte `text` ; seule l'icône prend la couleur d'état (`--state`) — ouverte `add`, fusionnée `merged`, brouillon et fermée `faint`.
- **Onglets internes:** boutons à plat `muted`, l'actif en `text` souligné de 2px d'accent ; compteur dans un badge.
- **Discussion:** une pile de sections pleine largeur séparées d'un filet bas de 1px (padding 12px 16px), pas de cartes arrondies centrées. Seule la mesure du texte est bornée (110ch, interligne 1.5), alignée à gauche. Les commentaires d'un fil sont séparés par un filet `border` ; un fil résolu passe à 0.75 d'opacité, marqué « résolu » en `add` 11px. Le texte est sélectionnable.
- **Lecteurs d'écran:** un badge ou compteur purement visuel est doublé d'un texte masqué (`.visually-hidden`) qui dit ce qu'il compte.

### Commit row (signature)
La ligne du graphe : 28px, grille à colonnes (refs, graphe, message, auteur, date, SHA). Survol `hover`, sélection `sel`. Message en 13px ; auteur avec avatar rond ; date et SHA en `muted`, SHA en mono. Le nœud du graphe prend la couleur de sa voie, avec l'initiale ou l'avatar de l'auteur.

### Context menu
Fond `panel`, bordure `border`, coins 10px, padding 4px, ombre flottante. Éléments de 28px, coins 6px, 13px ; survol et focus clavier `hover`. Séparateurs de 1px ; actions impossibles grisées avec raison en infobulle.

### Dialog
480px de large, padding 24px, fond `panel`, bordure, coins 14px, ombre flottante. Titre 18px 700 ; actions alignées à droite, bouton principal en dernier.

### Toast
Centré en bas (40px du bord), fond `panel`, bordure, coins 10px, padding 10px 14px ; icône `del` pour une erreur. Discret, jamais modal.

### Status bar
26px, fond `bg`, bordure haute, texte 11.5px `muted`, éléments espacés de 18px : chemin, remote, profil actif (cliquable), nombre de commits, ↑ ↓, dernier fetch.

## Do's and Don'ts

### Do:
- **Do** passer chaque couleur par `var(--jeton)` ou `color-mix()` d'un jeton, et vérifier l'écran en thème clair et sombre.
- **Do** garder les lignes de liste à 28px et le corps à 13px ; hiérarchiser par graisse et par encre (`text` / `muted` / `faint`).
- **Do** afficher SHA, chemins, refs et diff en JetBrains Mono.
- **Do** réserver l'accent bleu à l'action principale, à la sélection et au focus.
- **Do** griser une action impossible et dire pourquoi en infobulle, plutôt que la cacher ; dans une barre d'outils, la laisser focalisable (`aria-disabled`).
- **Do** poser le texte blanc sur `accent-fill`, pas sur `accent`.
- **Do** donner à toute animation une durée courte (≤ 150ms) et une variante `prefers-reduced-motion`.
- **Do** prévoir la longueur des libellés français (souvent plus longs que l'anglais).

### Don't:
- **Don't** mettre d'ombre portée sur un panneau, une carte ou une ligne : l'ombre est réservée à ce qui flotte.
- **Don't** introduire une couleur vive dans le chrome (barres, panneaux, boutons) ; la couleur appartient au contenu du dépôt.
- **Don't** aérer les écrans de travail façon site web, ni entourer les panneaux de marges ou de cartes flottantes.
- **Don't** écrire une couleur en hexadécimal dans un composant.
- **Don't** ajouter une modale là où une action directe, un menu ou un bandeau suffit.
