# Trame — Board des dépendances GitLab

Spécifications fonctionnelles et techniques, version 0.1 (20 novembre 2026).
Ce document décrit l'application telle que la maquette la montre (`board.html`).

> « Trame » est un nom de travail provisoire.

---

## 1. Objectif

Les boards natifs de GitLab ne montrent pas les dépendances entre epics et issues dans le temps. Trame affiche les **dépendances** entre ces artefacts sur une frise d'**itérations**. Le but est de repérer les chaînes de blocage, les risques de retard et les dépendances entre équipes.

L'outil ne suit **pas l'avancement**. Il n'affiche ni pourcentage, ni poids, ni compteur d'éléments fermés.

### Utilisateurs visés

- Product managers et responsables de programme qui coordonnent plusieurs équipes ou groupes.
- Tech leads qui veulent savoir ce qui bloque leurs epics et ce que leurs epics bloquent.

---

## 2. Périmètre

| Inclus | Exclu |
|---|---|
| Epics | Milestones |
| Issues **qui bloquent au moins un epic** | Issues sans lien « bloque » vers un epic |
| Liens « bloque », « lié à », « epic parent → issue » | Indicateurs d'avancement (progression, poids, burndown) |
| Itérations d'une cadence GitLab | Modification des données GitLab (lecture seule, v1) |
| Couloirs configurables par groupes, types et labels | |

---

## 3. Concepts et vocabulaire

| Terme | Définition |
|---|---|
| **Itération** | Itération GitLab d'une cadence (par exemple « Itération 15, 18 nov. – 1 déc. »). Chaque itération est une **colonne** du board. |
| **Fenêtre** | Plage d'itérations consécutives affichées (de *N* à *M*). |
| **Couloir** | Ligne horizontale du board, définie par un **filtre** : groupes, types d'artefact et labels. |
| **Epic** | Epic GitLab de niveau groupe, positionné de son itération de début à son itération de fin. |
| **Issue bloquante** | Issue qui a au moins un lien « bloque » vers un epic. |
| **Dépendance hors fenêtre** | Lien vers un élément qui correspond au couloir mais se trouve en dehors de la fenêtre. |

---

## 4. Fonctionnalités

### 4.1 Le board

- **Colonnes** : une par itération de la fenêtre. Chaque colonne affiche le nom et les dates de l'itération. L'itération en cours est mise en évidence (fond teinté et badge « En cours »).
- **Couloirs** : un par couloir actif, dans l'ordre configuré. Leurs en-têtes forment une **colonne fixe à gauche**, qui reste visible pendant le défilement horizontal.
- **Placement des éléments**, dans chaque couloir :
  1. les epics en barres horizontales, de l'itération de début à l'itération de fin. Les barres sont rangées sur le moins de lignes possible sans chevauchement ;
  2. les issues bloquantes en cartes, empilées dans la colonne de leur itération.
- **Liens** : courbes dessinées entre les éléments (voir 4.5).
- **En-tête de couloir** : il affiche
  - le nom et la couleur du couloir ;
  - les groupes ciblés et l'option sous-groupes ;
  - les labels filtrés et le mode (« au moins un » ou « tous ») ;
  - le nombre d'epics et d'issues visibles, et le nombre d'éléments hors fenêtre ;
  - un bouton **replier / déplier** et un bouton **modifier**.
- Un couloir sans élément dans la fenêtre affiche un message vide.

### 4.2 Identification visuelle des types

Chaque type est reconnaissable par sa **forme**, sa **couleur** et son **pictogramme** :

| Type | Forme | Couleur | Pictogramme |
|---|---|---|---|
| Epic | Barre pleine, coins arrondis, texte blanc, étiquette « EPIC » | Violet `#5b3fb0` | Pile de calques |
| Issue | Carte blanche avec en-tête teinté | En-tête bleu `#e8f0fd`, gris si fermée | Cercle avec point (ouverte) ou coche (fermée) |

- Un **epic coupé** par la fenêtre a un bord pointillé et une flèche ‹ ou › du côté coupé. L'infobulle donne l'itération réelle de début ou de fin.
- Une **issue** affiche :
  - sa référence (`#110`) et la personne assignée (avatar) ;
  - son titre, sur deux lignes au plus ;
  - la mention « Bloque &xx » avec les epics qu'elle bloque ;
  - deux labels au plus, puis « +N » pour les suivants.
- Une **issue fermée** reste visible, avec un en-tête gris et la mention « Fermée » : c'est un bloqueur levé.
- La même forme miniature sert dans la légende, dans les réglages des couloirs et dans le panneau de détail.

### 4.3 Fenêtre temporelle

- Deux listes permettent de choisir la **première** et la **dernière** itération. La première ne peut pas dépasser la dernière.
- Les boutons ‹ et › décalent la fenêtre d'une itération, en gardant sa largeur.
- Trois réglages rapides :
  - **En cours ± 2** : de l'itération en cours − 2 à l'itération en cours + 2 ;
  - **6 prochaines** : de l'itération en cours à l'itération en cours + 5 ;
  - **Toutes** : toutes les itérations de la cadence.
  Le réglage actif est mis en évidence.
- La fenêtre par défaut va de l'itération en cours − 1 à l'itération en cours + 3.
- Règles d'affichage :
  - un epic est affiché si sa période **chevauche** la fenêtre. Il est alors coupé aux bords ;
  - une issue est affichée si son itération est **dans** la fenêtre.
- Les colonnes, « Non planifié » comprise, se partagent à parts égales la largeur disponible du board. Elles ne descendent pas sous 212 px, ou 180 px au-delà de 7 colonnes : en dessous, le board défile horizontalement.
- La fenêtre est mémorisée.

### 4.4 Couloirs configurables

Chaque couloir a les propriétés suivantes :

| Propriété | Description |
|---|---|
| Nom | Texte libre |
| Couleur | Couleur du filet et de la pastille de l'en-tête |
| Groupes GitLab | Un ou plusieurs groupes, parmi les groupes disponibles |
| Inclure les sous-groupes | Oui / non. Si oui, un élément de `a/b/c` correspond au groupe `a/b`. |
| Afficher les epics | Oui / non |
| Afficher les issues | Oui / non. Seules les issues bloquant un epic sont concernées (voir 5.1). |
| Labels | Liste de labels (vide = pas de filtre) |
| Mode de correspondance | « Au moins un » (OU) ou « Tous » (ET) |
| Actif | Couloir affiché ou masqué |

Le panneau **Configurer les couloirs** permet de :
- créer, modifier, supprimer, monter ou descendre un couloir. L'ordre de la liste est l'ordre d'affichage ;
- activer ou masquer un couloir ;
- ajouter un **groupe GitLab disponible** en saisissant son chemin (`plateforme/atlas/mobile`). Le groupe peut ensuite être choisi dans n'importe quel couloir ;
- rétablir la configuration d'exemple.

Le panneau a des boutons **Annuler** et **Appliquer** : rien ne change sur le board avant « Appliquer ».

Les couloirs peuvent se **recouper**. Un élément qui correspond à plusieurs couloirs apparaît dans chacun.

### 4.5 Liens

| Type | Source GitLab | Style | Sens |
|---|---|---|---|
| **Bloque** | Lien `blocks` / `is_blocked_by` | Trait plein orange `#c8501f`, flèche | De l'élément bloquant vers l'élément bloqué |
| **Lié à** | Lien `relates_to` | Trait plein bleu `#2f6fdb` | Sans sens |
| **Epic parent → issue** | Relation de hiérarchie | Tirets violets `#7a68c0` | Du parent vers l'enfant |

- Les liens sont tracés pour les couples **epic ↔ epic**, **issue → epic** et **issue ↔ issue**, ce dernier seulement si les deux issues sont affichées.
- **Les filtres de type de lien s'appliquent à tout le board**, pas couloir par couloir. Par défaut : « Bloque » et « Lié à » sont affichés, « Epic parent → issue » est masqué.
- Tracé des courbes :
  - deux éléments côte à côte : courbe horizontale, du bord droit au bord gauche ;
  - deux éléments l'un au-dessus de l'autre : courbe verticale, alignée sur l'élément le plus étroit ;
  - deux issues dans la même colonne : boucle sur le côté droit, pour ne pas traverser les cartes intermédiaires.
- Élément présent dans plusieurs couloirs : on relie en priorité l'occurrence du même couloir, sinon la première.
- **Dépendance hors fenêtre** : le lien n'est pas dessiné. L'élément visible porte un badge « › N hors fenêtre ».

### 4.6 Sélection et panneau de détail

- Cliquer ou toucher un élément :
  - le sélectionne (contour bleu) ;
  - met en évidence ses liens, en plus épais ;
  - atténue les autres éléments et les autres liens.
- Un nouveau clic, un clic dans une zone vide ou le bouton ✕ annule la sélection.
- Le **panneau de détail** affiche :
  - le type, la référence, l'état et le titre ;
  - le groupe, les couloirs où l'élément apparaît, l'itération (issue) ou la période (epic) ;
  - pour une issue : l'epic parent et la personne assignée ;
  - les labels ;
  - les dépendances, regroupées par catégorie :
    - epic : « Bloque », « Bloqué par (epics) », « Bloqué par (issues) », « Lié à » ;
    - issue : « Bloque », « Lié à » ;
  - un lien « Ouvrir dans GitLab ».
- Un élément listé dans le détail mais **hors fenêtre** porte son itération ou sa période (`It. 13`). Le cliquer **déplace la fenêtre** jusqu'à lui, en gardant sa largeur, le sélectionne et le fait défiler dans la zone visible.
- Sur mobile, le panneau de détail s'ouvre depuis le bas de l'écran.

### 4.7 Filtres et options globales

- **Recherche** sur la référence (`#110`, `&18`) et sur le titre, dans tous les couloirs.
- **Masquer les issues fermées**.
- **Types de lien** (voir 4.5).
- **Compteurs** en haut du board : couloirs actifs, epics, issues bloquantes et blocages visibles. Un élément présent dans plusieurs couloirs n'est compté qu'une fois.

### 4.8 Panneau de configuration de gauche

Le panneau contient :
- la liste des couloirs, avec une case à cocher, la couleur et un bouton modifier ;
- le bouton « Nouveau couloir » ;
- les types de lien ;
- les options d'affichage.

Il est **repliable** avec le bouton ‹. Replié, il devient une bande de 52 px qui garde le bouton › et des pastilles de couleur pour les couloirs actifs. Son état est mémorisé.

Sur mobile (largeur ≤ 760 px), il est masqué et s'ouvre avec le bouton « Filtres ».

---

## 5. Règles métier

### 5.1 Issues affichées

Une issue est affichable si **elle a au moins un lien `blocks` dont la cible est un epic**. Ensuite :
- elle doit correspondre au couloir (groupe, type « issues » activé, labels) ;
- son itération doit être dans la fenêtre ;
- elle doit passer la recherche et l'option « Masquer les issues fermées ».

Les autres issues synchronisées sont ignorées. Le panneau de gauche en indique le nombre.

### 5.2 Rattachement d'un epic aux itérations

GitLab ne relie pas un epic à des itérations. Il lui donne des dates de début et de fin, fixes ou héritées. Règle proposée :
- **itération de début** : celle qui contient la date de début de l'epic ;
- **itération de fin** : celle qui contient sa date de fin ;
- date tombant entre deux itérations : on prend l'itération **suivante** pour le début, la **précédente** pour la fin ;
- epic sans date : on calcule ses dates à partir des itérations de ses issues enfants (min / max). S'il n'en a aucune, il va dans une zone « Non planifié » (à concevoir, voir § 9).

### 5.3 Appartenance d'un élément à un groupe

- Epic : le groupe qui le porte.
- Issue : le groupe parent du projet qui la porte.
- Avec l'option « sous-groupes », un chemin qui commence par `groupe/` correspond aussi.

### 5.4 Normalisation des liens

GitLab renvoie les liens dans les deux sens (`blocks` et `is_blocked_by`). On les ramène à un seul lien orienté, **bloquant → bloqué**, et on supprime les doublons.

---

## 6. Données GitLab

> Les points d'API ci-dessous sont à **vérifier sur la version et l'édition de votre instance**. Les epics, les itérations et les liens « bloque » demandent une édition **Premium ou Ultimate**. Les epics passent progressivement au modèle *work items*. Pour les liens entre epic et issue, l'API GraphQL des work items est la voie recommandée.

| Besoin | Source suggérée |
|---|---|
| Groupes disponibles | REST `GET /groups/:id/subgroups` et `GET /groups/:id/descendant_groups` |
| Cadence et itérations | GraphQL `group { iterationCadences { … } iterations { … } }` ou REST `GET /groups/:id/iterations` |
| Epics (dates, labels, état) | GraphQL work items de type *Epic* (ou REST `GET /groups/:id/epics`, déprécié) |
| Liens entre epics | Widget *linked items* des work items (ou REST `GET /groups/:id/epics/:iid/related_epics`) |
| Issues (itération, labels, état, personne assignée, epic parent) | GraphQL `group { issues(includeSubgroups: true) { … } }` |
| Liens issue ↔ issue | REST `GET /projects/:id/issues/:iid/links` |
| Liens issue → epic | Widget *linked items* du work item de l'issue |

### Modèle interne (après normalisation)

```text
Iteration { id, title, startDate, dueDate, cadenceId, isCurrent }
Group     { id, fullPath, name }
Epic      { id, iid, ref:"&18", groupPath, title, labels[], state, startIteration, endIteration, webUrl }
Issue     { id, iid, ref:"#110", groupPath, projectPath, title, labels[], state, iterationId, parentEpicId, assignee, webUrl }
Link      { sourceRef, targetRef, type: "blocks" | "relates" | "parent" }
Lane      { id, name, color, groups[], includeSubgroups, showEpics, showIssues, labels[], labelMode: "any"|"all", active, order }
BoardPrefs{ windowFrom, windowTo, linkTypes{blocks,relates,parent}, hideClosed, sidePanelCollapsed, collapsedLanes[] }
```

### Synchronisation

- Bouton **Synchroniser** et indication de la dernière synchro (« il y a 3 min »).
- Rafraîchissement **incrémental** sur `updated_after`, et rafraîchissement complet à la demande.
- Authentification : jeton d'accès personnel ou OAuth GitLab, en **lecture seule** (`read_api`).
- On ne garde que ce que l'utilisateur a le droit de voir. Les permissions GitLab sont respectées.

---

## 7. Persistance des préférences

| Donnée | Portée (maquette) | Portée cible proposée |
|---|---|---|
| Couloirs et groupes disponibles | Navigateur (`localStorage`) | Par utilisateur, côté serveur, avec des **vues partageables** |
| Fenêtre d'itérations | Navigateur | Par vue |
| Panneau replié ou déplié | Navigateur | Par utilisateur |
| Types de lien, masquer les fermées, couloirs repliés | Session | Par vue |

---

## 8. Exigences non fonctionnelles

- **Performance** : jusqu'à environ 300 epics, 1 000 issues bloquantes et 3 000 liens affichés sans ralentissement visible (rendu en moins de 300 ms). Au-delà, envisager le rendu par canvas et la virtualisation des couloirs.
- **Accessibilité** :
  - tous les éléments cliquables sont de vrais `<button>` ;
  - contraste du texte ≥ 4,5:1 ;
  - les types se distinguent par la forme et pas seulement par la couleur ;
  - libellés ARIA sur les boutons-icônes ;
  - fermeture du panneau de configuration avec Échap.
- **Responsive** :
  - le board défile horizontalement ;
  - la colonne des couloirs reste fixe ;
  - les panneaux s'adaptent au mobile.
- **Langue** : interface en français. Prévoir l'internationalisation.
- **Sécurité** : application en lecture seule, jeton stocké côté serveur, aucun contenu GitLab interprété comme du HTML.

---

## 9. Questions ouvertes

1. **Epics sans date** : faut-il une zone « Non planifié » par couloir, ou les exclure ?
2. **Issues sans itération** qui bloquent un epic : faut-il une colonne « Sans itération » ?
3. **Plusieurs cadences** : choisir une seule cadence par board, ou les aligner sur le calendrier ?
4. **Liens epic ↔ epic** : faut-il les distinguer visuellement des liens issue → epic, avec un filtre séparé ?
5. **Chemin critique** : faut-il calculer et mettre en évidence la plus longue chaîne de blocages ?
6. **Alertes** : faut-il signaler un epic bloqué par un élément planifié **après** lui (conflit de dates) ?
7. **Vues partagées** : faut-il pouvoir enregistrer une configuration de couloirs et une fenêtre comme une vue nommée, avec un lien partageable ?
8. **Écriture** : en v2, faut-il pouvoir créer ou supprimer un lien « bloque » depuis le board ?

---

## 10. Livrables

- `board.html` : maquette interactive autonome (HTML, CSS et JS sans dépendance, données d'exemple).
- `SPECIFICATIONS.md` : ce document.