# Décisions d'architecture

Ce fichier consigne les choix qui structurent Gleipnir, sous forme de courts ADR : contexte, décision, conséquences.

- Une décision qui change donne un **nouvel** ADR, qui remplace l'ancien. On ne réécrit pas l'histoire : l'ancien ADR est marqué « Remplacé par ADR-n ».
- Les références « § » renvoient à `docs/specifications.md`.

| # | Décision | Date |
|---|---|---|
| 1 | Backend Go sans dépendance externe | 2026-11-23 |
| 2 | GraphQL GitLab écrit à la main | 2026-11-23 |
| 3 | Cache mémoire « stale-while-revalidate » (remplacé par ADR-24) | 2026-11-23 |
| 4 | Le backend normalise, le frontend met en page (amendé par ADR-35) | 2026-11-23 |
| 5 | Couloirs stockés dans le navigateur (remplacé par ADR-31 et ADR-32, repris par ADR-34 et ADR-36) | 2026-11-23 |
| 6 | Une seule cadence par board (remplacé par ADR-38) | 2026-11-23 |
| 7 | Frontend sans dépendance d'exécution | 2026-11-23 |
| 8 | Déploiement en deux images | 2026-11-23 |
| 9 | Mode démo (remplacé par ADR-25) | 2026-11-23 |
| 10 | Règles pour les questions ouvertes de la spec | 2026-11-23 |
| 11 | Écarts d'interface assumés | 2026-11-23 |
| 12 | Pas d'étiquette « EPIC » | 2026-11-23 |
| 13 | Itération en cours mise en évidence sans rouge | 2026-11-23 |
| 14 | Identité d'un élément : le GID du work item | 2026-11-23 |
| 15 | Palette fixe pour les couleurs des couloirs | 2026-11-23 |
| 16 | Documentation en français, code en anglais | 2026-11-23 |
| 17 | Stratégie de tests | 2026-11-23 |
| 18 | Content-Security-Policy stricte | 2026-11-23 |
| 19 | Cas limites du rattachement et de l'analyse | 2026-11-23 |
| 20 | Synchros forcées limitées | 2026-11-23 |
| 21 | Écarts assumés par rapport à `style.md` | 2026-11-23 |
| 22 | Outillage de développement dans le devcontainer | 2026-11-23 |
| 23 | Couverture de tests : 90 % de lignes et de fonctions | 2026-11-23 |
| 24 | Synchro complète périodique et rafraîchissement ciblé | 2026-11-23 |
| 25 | Faux GitLab pour la démo et les e2e | 2026-11-24 |
| 26 | Jeton de démo vérifié par le faux GitLab | 2026-11-24 |
| 27 | Seeder : le jeu de démo dans un vrai GitLab | 2026-11-24 |
| 28 | E2E agnostiques : même suite sur le faux et le vrai GitLab | 2026-11-24 |
| 29 | Colonnes à la largeur du board | 2026-11-24 |
| 30 | La recherche montre la chaîne de dépendances des résultats | 2026-11-24 |
| 31 | La vue dans l'URL, partageable par un lien (remplacé par ADR-36) | 2026-11-24 |
| 32 | Couloirs en lecture seule : les groupes cochés de l'arbre GitLab (remplacé par ADR-34) | 2026-11-24 |
| 33 | `AGENTS.md` en anglais | 2026-11-24 |
| 34 | Couloirs éditables | 2026-11-26 |
| 35 | Mode d'affichage des issues par couloir | 2026-11-26 |
| 36 | Vue mémorisée dans le navigateur | 2026-11-26 |
| 37 | Dépendances hors couloirs | 2026-11-26 |
| 38 | Toutes les cadences, cadences actives choisies par l'utilisateur | 2026-11-26 |

---

## ADR-1 — Backend Go sans dépendance externe

*2026-11-23 · Accepté*

**Contexte.** Le backend fait peu de choses :

- lire GitLab ;
- appliquer des règles métier ;
- servir deux routes JSON.

Depuis Go 1.22, `net/http.ServeMux` route par méthode (`"GET /api/board"`), et `log/slog` existe. Le projet est en Go 1.27 depuis le 2026-11-24. Nornir utilise Gin et godotenv, qui n'apportent rien d'essentiel ici.

**Décision.**

- Le backend n'utilise que la **bibliothèque standard** : `net/http`, `encoding/json`, `log/slog`. Le module `gleipnir` déclare **aucune dépendance** : pas de `go.sum`.
- Pas de godotenv : la configuration vient des variables d'environnement. Compose les fournit par `env_file` ; en natif, on exporte le `.env`.
- Une bibliothèque ne sera ajoutée que si elle évite du code non métier conséquent, après un nouvel ADR.

**Conséquences.**

- Surface d'attaque et maintenance minimales, build reproductible sans réseau, image légère.
- Le routage, la journalisation et l'arrêt propre sont écrits à la main, dans `cmd/server`.
- Le Dockerfile ne copie pas de `go.sum` et n'exécute pas `go mod download`.

## ADR-2 — GraphQL GitLab écrit à la main

*2026-11-23 · Accepté*

**Contexte.** Les données utiles (work items, widgets, liens, itérations) ne sont complètes que dans l'API GraphQL. Nornir a déjà un client éprouvé : `doGraphQL` et `paginate` dans `Nornir/backend/internal/gitlab/client.go`.

**Décision.** On reprend ce client, sans bibliothèque GraphQL :

- requêtes en chaînes constantes (`queries.go`) ;
- structures de réponse typées (`structs.go`) ;
- pagination par curseur, avec un curseur `null` à la première page ;
- détection des erreurs GraphQL renvoyées en HTTP 200 ;
- widgets distingués par `__typename`.

Les erreurs sont typées : `ErrUnauthorized`, `ErrGroupNotFound`, `ErrPremiumRequired`, `ErrNoCadence` et `ErrCadenceNotFound`. L'API les traduit en codes.

**Conséquences.**

- Aucune dépendance (ADR-1) et un contrôle total des requêtes.
- En contrepartie, aucune vérification du schéma à la compilation : toute requête modifiée doit être validée sur un vrai GitLab (tests `@live`). Les pièges connus sont listés dans `AGENTS.md`.

## ADR-3 — Cache mémoire « stale-while-revalidate »

*2026-11-23 · Remplacé par ADR-24*

**Contexte.** Une synchro complète d'un groupe parcourt plusieurs pages GitLab. Plusieurs utilisateurs ouvrent le board en même temps. Nornir a un cache qui répond à ce besoin (`internal/cache/cache.go`).

**Décision.**

- Le board est gardé **encodé** en mémoire :
  - il est frais pendant `CACHE_TTL` (5 min par défaut) ;
  - ensuite, il est servi tel quel (`STALE`) pendant qu'une synchro le rafraîchit en arrière-plan ;
  - il est jeté après 24 h.
- **Une seule synchro à la fois** : les requêtes simultanées la partagent.
- `?refresh=1` force une synchro complète et l'attend.
- La **synchro incrémentale** (`updatedAfter`, §6) est **reportée** : avec environ 1 300 éléments, une synchro complète reste raisonnable.

**Conséquences.**

- Le board s'affiche vite, et GitLab n'est pas sollicité à chaque visite.
- Les données peuvent avoir jusqu'à `CACHE_TTL` de retard ; le bouton Synchroniser contourne ce délai.
- Le cache est propre à chaque instance du backend.
- Si les volumes grossissent nettement, la synchro incrémentale sera à revoir.

## ADR-4 — Le backend normalise, le frontend met en page

*2026-11-23 · Accepté · Amendé par l'ADR-35 : le backend envoie toutes les issues, le couloir décide lesquelles afficher*

**Contexte.** Les règles métier (§5) doivent être identiques pour tous et testables sans navigateur. La mise en page, elle, dépend de choix d'interface faits dans le navigateur : couloirs, fenêtre, recherche.

**Décision.**

- Le backend (`internal/board`) calcule tout ce qui est **métier et stable** :
  - le rattachement des epics aux itérations (§5.2) ;
  - la normalisation des liens (§5.4) ;
  - les issues bloquantes (`blocksEpics`, §5.1) ; depuis l'ADR-35, il envoie **toutes** les issues, et le mode d'affichage du couloir choisit côté frontend ;
  - les éléments non planifiés ;
  - les conflits ;
  - le chemin critique.
- Le frontend calcule ce qui dépend de l'**interface** : appartenance aux couloirs, fenêtre, recherche, placement, tracé des liens, compteurs.

**Conséquences.**

- Le JSON de `GET /api/board` est un contrat (`model.go` ↔ `src/api/types.ts`) : ces deux fichiers évoluent ensemble.
- Les règles métier sont testées en Go, table par table. La logique de mise en page est testée en TypeScript pur (`src/board`).

## ADR-5 — Couloirs stockés dans le navigateur

*2026-11-23 · Remplacé par l'ADR-31 (vue dans l'URL) et l'ADR-32 (couloirs = groupes GitLab) · Repris par l'ADR-34 (couloirs éditables, mêmes couloirs par défaut, groupes choisis dans GitLab) et l'ADR-36 (couloirs et fenêtre mémorisés dans le navigateur)*

**Contexte.** La spec (§7) vise des vues partagées côté serveur. Mais les couloirs sont une préférence d'interface, pas une donnée GitLab, et la v1 n'a ni base de données ni identité utilisateur.

**Décision.**

- Les couloirs sont stockés dans `localStorage` (`gleipnir.lanes`), validés à la lecture contre les groupes connus.
- Par défaut, il y a un couloir par **sous-groupe direct** du groupe racine. S'il n'y en a pas, un seul couloir couvre le groupe racine.
- « Rétablir » régénère ces couloirs par défaut.
- La fenêtre (`gleipnir.window`) et l'état du panneau latéral (`gleipnir.sidebar`) sont aussi mémorisés dans le navigateur.
- Les groupes disponibles viennent de GitLab : plus de saisie de chemin à la main (§4.4).

**Conséquences.**

- Pas de stockage serveur.
- La configuration ne suit pas l'utilisateur d'un navigateur à l'autre et ne se partage pas. Les vues nommées et partageables (§9.7) restent à faire.

## ADR-6 — Une seule cadence par board

*2026-11-23 · Remplacé par l'ADR-38*

**Contexte.** Un groupe peut avoir plusieurs cadences d'itérations, qui ne s'alignent pas forcément (§9.3). Une colonne du board doit être une itération.

**Décision.**

- Le board affiche **une seule cadence**, choisie par `GITLAB_CADENCE` (titre ou id).
- Par défaut, c'est la cadence qui contient l'itération en cours.
- Les itérations des autres cadences sont ignorées.

**Conséquences.**

- Les colonnes sont simples et sans ambiguïté.
- Une issue planifiée dans une autre cadence est traitée comme **sans itération**.
- Pour afficher une autre cadence, il faut une autre instance ou une autre configuration.

## ADR-7 — Frontend sans dépendance d'exécution

*2026-11-23 · Accepté*

**Contexte.** Le board doit rester léger et durable. Odin montre qu'une application React 19 sans routeur ni bibliothèque d'état suffit pour ce genre d'outil.

**Décision.**

- **Pile** : React 19, Vite et TypeScript. Les seules dépendances d'exécution sont `react` et `react-dom`.
  - Pas de routeur, pas de bibliothèque d'état ni de données : `fetch` et des hooks maison suffisent.
  - Pas de framework CSS ni de police externe.
- **Dessin** : le board est dessiné en HTML/CSS, avec un seul SVG pour les liens.
- **Textes** : tous les textes de l'interface, en français, sont centralisés dans `src/strings/`, pour pouvoir internationaliser plus tard.

**Conséquences.**

- Bundle petit, aucune mise à jour de dépendance tierce à suivre, application utilisable hors ligne une fois chargée.
- Les composants d'interface (menus, feuilles `<dialog>`, champ de recherche, interrupteurs) sont écrits ou repris de Nornir.

## ADR-8 — Déploiement en deux images

*2026-11-23 · Accepté*

**Contexte.** Le modèle de Nornir a fait ses preuves : un backend Go et un nginx qui sert le SPA et proxifie l'API, chacun dans son image.

**Décision.**

- **Image backend** :
  - build `golang:1.27-alpine`, binaire statique (`CGO_ENABLED=0`) ;
  - exécution sur `alpine:3.24` avec `ca-certificates` et `tzdata` (Go 1.22 et `alpine:3.20` jusqu'au 2026-11-24 ; `alpine:3.20` n'était plus maintenue) ;
  - utilisateur non-root **numérique** `10001` ;
  - healthcheck sur `/api/health`.
- **Image frontend** :
  - build `node:22-alpine` ;
  - exécution sur `nginxinc/nginx-unprivileged` (port 8080) ;
  - configuration par `nginx.conf.template` : proxy `/api`, gzip, délai de lecture long, cache des assets, en-têtes de sécurité.
- `docker-compose.yml` sert au développement local et aux démonstrations.
- Le chart Helm **n'est pas couvert en v1**.

**Conséquences.**

- Deux images petites et non-root, prêtes pour Kubernetes, mais sans chart pour l'instant.
- `tzdata` est requis, car `TZ` décide de l'itération en cours.

## ADR-9 — Mode démo

*2026-11-23 · Remplacé par ADR-25*

**Contexte.** Développer l'interface, la tester et la montrer ne doit pas exiger un GitLab Premium et un jeton.

**Décision.**

- Avec `GLEIPNIR_DEMO=1`, le backend sert `board.DemoRaw` : le jeu d'exemple de la maquette, où « Itération 15 » est en cours.
- Ce jeu passe par le **même** `board.Build` que les données GitLab.
- `GITLAB_GROUP` n'est alors plus obligatoire.
- `/api/health` indique `demo: true`.

**Conséquences.**

- `GLEIPNIR_DEMO=1 docker compose up` marche sans `.env` : l'`env_file` du compose est optionnel.
- Les tests e2e tournent contre le vrai backend en mode démo, sans mock d'API.
- Le jeu démo est aussi une fixture des tests Go.
- Il doit rester cohérent avec la maquette.

## ADR-10 — Règles pour les questions ouvertes de la spec

*2026-11-23 · Accepté · Amendé par l'ADR-35 : toute issue sans itération est non planifiée*

**Contexte.** La spec laisse ouvertes la zone « Non planifié » (§9.1, §9.2), le chemin critique (§9.5) et les conflits de dates (§9.6). La v1 les traite.

**Décision.**

- **Conflit** : un lien « bloque » dont l'itération de fin du bloqueur est **strictement postérieure** à l'itération de début de l'élément bloqué. Depuis l'ADR-35, cela vaut pour tout lien « bloque », issue → issue compris.
  - Même itération : pas de conflit.
  - Bloqueur fermé : jamais de conflit.
  - Le conflit est affiché en rouge, seul usage du rouge sur le board.
- **Chemin critique** : la plus longue chaîne de liens « bloque » entre éléments **ouverts**, dans le graphe orienté. Il ne passe que par les epics et les issues qui bloquent un epic (ADR-35).
  - Les cycles sont détectés, cassés et signalés dans les logs.
  - À longueur égale, on garde la chaîne qui finit le plus tard.
- **Non planifié** :
  - un epic sans dates ni enfant planifié ;
  - une issue sans itération de la cadence (seulement les issues bloquantes avant l'ADR-35).
  
  Ces éléments vont dans une colonne « Non planifié », en fin de board, que l'on peut masquer.

**Conséquences.**

- Ces règles sont calculées par le backend (ADR-4) et testées table par table, cycles et égalités compris.
- On compare des itérations, pas des dates : deux éléments dans la même itération ne sont jamais en conflit.

## ADR-11 — Écarts d'interface assumés

*2026-11-23 · Accepté*

**Contexte.** La maquette suit la spec à la lettre. L'interface réelle applique la charte Apple (`docs/style.md`), dont le principe est : la couleur porte un seul sens, la forme distingue.

**Décision.**

- **Liens neutres, distingués par leur forme**, et non par trois couleurs :
  - « Bloque » : trait plein avec une flèche ;
  - « Lié à » : pointillé sans flèche ;
  - « Parent » : tirets.
  
  Le rouge reste réservé aux conflits, et le noir au chemin critique.
- **Panneau latéral entièrement masquable**, comme une sidebar macOS, au lieu de la bande de 52 px avec des pastilles (§4.8). Une bande de pastilles sans libellé n'aide pas.
- **Fenêtre réglée par un seul bouton pop-up** `‹ [It. 14 – It. 18 ▾] ›`, au lieu de deux listes et trois boutons. Le pop-up contient les listes de début et de fin et les réglages rapides, avec une coche sur le réglage actif. La barre d'outils reste compacte et le réglage courant se lit d'un coup d'œil.

**Conséquences.**

- Moins de couleurs, donc un conflit saute aux yeux.
- La légende et le panneau montrent un aperçu du trait de chaque type de lien.
- Les tests e2e ciblent ce bouton pop-up, pas des listes déroulantes.

## ADR-12 — Pas d'étiquette « EPIC »

*2026-11-23 · Accepté*

**Contexte.** La spec (§4.2) prévoit une étiquette « EPIC » sur chaque barre. Sur une barre de 28 px, elle prend la place du titre.

**Décision.**

- Pas d'étiquette.
- L'epic se reconnaît par trois signes :
  - sa **forme** : une barre pleine qui couvre ses itérations ;
  - sa **couleur** : `--epic`, violet ;
  - son **pictogramme** : des calques.
- La référence `&18` s'affiche avant le titre.

**Conséquences.**

- Le titre a plus de place.
- L'accessibilité ne dépend pas de la couleur : la forme et le libellé ARIA (« Epic &18 … ») portent le type.

## ADR-13 — Itération en cours mise en évidence sans rouge

*2026-11-23 · Accepté*

**Contexte.** Le rouge signale un conflit (ADR-10). Une itération en cours en rouge, ou une ligne « aujourd'hui » rouge, brouillerait ce signal.

**Décision.** La colonne de l'itération en cours se distingue par trois signes, sans rouge :

- un fond `--current-column` léger (`--fill` à demi-intensité) ;
- son nom en bleu (accent) ;
- un petit libellé « En cours ».

**Conséquences.**

- Le rouge garde un seul sens sur tout le board.
- L'itération en cours dépend de l'horloge du serveur et de `TZ`.

## ADR-14 — Identité d'un élément : le GID du work item

*2026-11-23 · Accepté*

**Contexte.** Les références GitLab `#110` ne sont uniques que dans un projet : deux projets du groupe ont chacun leur `#110`. Les epics sont désormais des work items.

**Décision.**

- Un élément est identifié partout par le **GID de son work item** (`gid://gitlab/WorkItem/…`). Cela vaut pour les liens, `parentEpic`, `blocksEpics`, `criticalPath`, la sélection et les clés React.
- `ref` (`&18`, `#110`) sert **à l'affichage seulement**.

**Conséquences.**

- Il n'y a pas de collision entre projets.
- La recherche par `#110` peut trouver plusieurs issues : c'est voulu.
- Les tests et le jeu démo utilisent des GID.

## ADR-15 — Palette fixe pour les couleurs des couloirs

*2026-11-23 · Accepté · Amendé par l'ADR-34 : la couleur se choisit dans la palette, par couloir*

**Contexte.** La spec prévoit une couleur libre par couloir. Un sélecteur libre permettrait du rouge (conflits), du violet (epics) ou du teal (issues), et donnerait des couleurs illisibles en mode sombre.

**Décision.**

- Un couloir choisit parmi **8 couleurs système Apple**, définies en jetons clair et sombre : indigo, bleu, cyan, menthe, jaune, orange, rose et brun (`--lane-*`).
- Rouge, vert, violet et teal sont exclus : ils portent déjà un sens.
- La couleur d'un couloir se **choisit dans la palette**, dans le panneau de réglages (ADR-34). Un nouveau couloir prend la première couleur qu'aucun autre couloir n'utilise, sinon la palette recommence. Les couloirs par défaut prennent la palette dans l'ordre. (Sous l'ADR-32, la couleur venait du sous-groupe de premier niveau.)
- Le composant n'expose que `data-lane-color` ; le CSS en déduit `--lane`.

**Conséquences.**

- Couleurs harmonieuses et lisibles dans les deux apparences, sans conflit de sens.
- Au-delà de 8 couloirs, les couleurs se répètent.
- Une couleur stockée invalide retombe sur une couleur de la palette, selon la place du couloir.

## ADR-16 — Documentation en français, code en anglais

*2026-11-23 · Accepté · Amendé par l'ADR-33 : `AGENTS.md` est en anglais*

**Contexte.** L'équipe écrit en français et les utilisateurs sont francophones. Le code, lui, suit les conventions de l'écosystème et des projets voisins.

**Décision.**

- En **français** :
  - la documentation (`README.md`, `docs/`) ; `AGENTS.md` l'était jusqu'à l'ADR-33 ;
  - l'interface, centralisée dans `src/strings/`.
- En **anglais** :
  - le code, les identifiants et les commentaires ;
  - les messages d'erreur techniques du backend ;
  - les titres de commit.

**Conséquences.**

- L'internationalisation reste possible, puisque les textes sont centralisés.
- Les tests Playwright sélectionnent par les libellés français : ils changent avec eux.

## ADR-17 — Stratégie de tests

*2026-11-23 · Accepté · Amendé par ADR-25 (les e2e lisent un faux GitLab) et ADR-28 (e2e agnostiques)*

**Contexte.** Les règles métier, la mise en page et l'intégration GitLab échouent de façons différentes. Chacune demande son outil.

**Décision.**

- **Go** :
  - tests **table par table** des règles de `internal/board`, avec une horloge injectée ;
  - cache testé avec `-race` ;
  - client GitLab et handlers testés face à un **faux GitLab `httptest`**.
- **Vitest** :
  - la logique pure de `src/board` en environnement node (`*.test.ts`) ;
  - les composants avec Testing Library en jsdom (`*.test.tsx`, première ligne `// @vitest-environment jsdom`).
- **Playwright** :
  - `*.spec.ts` tournent contre le **backend réel en mode démo**, lancé par `webServer` avec Vite, sans mock d'API. Les erreurs se simulent avec `page.route`.
  - `*.live.spec.ts`, marqués `@live`, tournent contre un vrai GitLab. Ils ne sont pas lancés par défaut, mais sont obligatoires quand une requête GraphQL change.
- Les sélecteurs passent par les rôles et les libellés.
- Tout nouveau test e2e est gardé dans le projet.

**Conséquences.**

- La suite par défaut ne demande ni réseau ni GitLab.
- Seuls les tests `@live` vérifient le schéma GraphQL réel (ADR-2).

## ADR-18 — Content-Security-Policy stricte

*2026-11-23 · Accepté*

**Contexte.** L'application affiche du contenu GitLab saisi par des tiers (titres, labels). Elle n'interprète jamais de HTML, mais une CSP limite les dégâts d'une erreur. `index.html` contient un script inline qui applique le thème avant le premier rendu.

**Décision.** nginx envoie ces en-têtes :

- **Content-Security-Policy** :
  - `script-src 'self'` plus le **hash sha256** du script de thème. Pas de `'unsafe-inline'` pour les scripts.
  - `style-src 'self' 'unsafe-inline'` : React pose des attributs `style`, dont la couleur des labels GitLab.
  - `img-src 'self' data:` : le favicon est en `data:`.
  - `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- **`X-Content-Type-Options: nosniff`**.
- **`Referrer-Policy: same-origin`**.

**Conséquences.**

- Toute modification du script de thème, même d'un espace, doit recalculer le hash dans `frontend/nginx.conf.template`. La commande est dans `AGENTS.md`.
- Aucun autre script inline n'est permis.
- En développement (Vite), la CSP ne s'applique pas : vérifiez la console sur l'image Docker.

---

## ADR-19 — Cas limites du rattachement et de l'analyse

**Contexte.** La spec (§5.2, §9) ne tranche pas plusieurs cas limites. Les règles ci-dessous sont celles de `internal/board`. Chacune est couverte par un test. Elles restent **à valider avec l'équipe**.

**Décision.**

- **Ordre des itérations** : par date de début, puis date de fin, puis cadence (par titre), puis `sequence`, puis ID ; celles qui ont les mêmes dates ne font qu'une colonne (ADR-38). Un titre vide devient « Itération {sequence} ». Une itération en double (même ID, d'une page à l'autre) ou sans dates valides (manquantes, illisibles, fin avant le début) est ignorée : elle fausserait la recherche dichotomique du rattachement.
- **Itération en cours** : la première dont l'intervalle `[début, fin]`, bornes incluses, contient la date du jour (dans le fuseau `TZ`). Si aucune ne la contient, `current = -1`. Le frontend affiche alors par défaut les cinq premières itérations.
- **Début d'un epic** : la première itération qui finit au plus tôt le jour du début. C'est celle qui contient la date, ou la suivante quand la date tombe entre deux itérations ou avant la première. Avec des cadences décalées, les colonnes se chevauchent et leurs dates de fin ne sont plus triées : la recherche parcourt les colonnes dans l'ordre (ADR-38).
- **Fin d'un epic** : la dernière itération qui commence au plus tard le jour de la fin. C'est celle qui contient la date, la précédente dans un intervalle, ou la dernière quand la date est après la dernière itération.
- **Dates inversées** (début après la fin) : elles sont d'abord échangées.
- **Epic entièrement dans un intervalle** entre deux itérations : il est rattaché à l'itération **suivante** (début = fin).
- **Epic entièrement hors des colonnes**, qui finit avant la première itération ou commence après la dernière : il est **non planifié**. On ne le borne pas aux extrémités, pour ne pas suggérer une date fausse.
- **Une seule date** : le côté manquant vient des issues enfants (min pour le début, max pour la fin), sans jamais dépasser le côté connu. Sans enfant, l'epic tient sur une itération. `datesFromChildren` reste faux.
- **Dates propres et enfants planifiés** : les dates de l'epic priment toujours. Les enfants ne servent que s'il n'a pas de date, ou n'en a qu'une.
- **Sans date** : le min et le max des colonnes de **toutes** les issues enfants planifiées, affichées ou ignorées, ouvertes ou fermées, quelle que soit la cadence de leur itération (ADR-38). Sans enfant planifié, l'epic est non planifié.
- **Issue bloquante** : seulement si elle est la **source** d'un lien `blocks` vers un epic. Une issue bloquée par un epic n'est pas bloquante pour cette raison. Depuis l'ADR-35, toutes les issues sont envoyées ; ce critère sert au mode « Uniquement celles qui bloquent un epic » et au chemin critique.
- **Liens** :
  - deux liens `blocks` A→B et B→A sont gardés tous les deux, comme un cycle ;
  - les liens `parent` ne relient qu'un epic à une de ses issues (toutes depuis l'ADR-35) : la hiérarchie entre epics n'est pas dessinée.
- **Labels** : en cas de doublon de titre, la première couleur rencontrée l'emporte.
- **Conflit** : seul l'état du bloqueur compte. Un côté non planifié ne donne jamais de conflit, car il n'y a rien à comparer.
- **Chemin critique** :
  - il faut au moins 2 éléments ;
  - à longueur égale, on prend la chaîne qui finit le plus tard, puis celle qui **commence le plus tôt** (elle couvre la plus grande partie du plan), puis la plus petite liste d'IDs ;
  - les cycles sont cassés par un parcours en profondeur dans l'ordre des IDs, et les liens ignorés sont journalisés.

**Conséquences.** Changer l'une de ces règles demande de modifier son test dans `internal/board/*_test.go` et cette section.

## ADR-20 — Synchros forcées limitées

*2026-11-23 · Accepté, amendé par ADR-24 (l'intervalle s'applique par groupe)*

**Contexte.** `?refresh=1` attend une synchro complète, qui parcourt toutes les pages GitLab. Un client qui le répète en boucle ferait travailler l'instance et consommerait la limite de débit de GitLab, alors qu'aucune authentification ne protège l'API. De même, quand GitLab échoue, chaque requête sur un board périmé relançait aussitôt une synchro.

**Décision.** Le cache (`internal/cache`, `MinRefresh`, 10 s dans `cmd/server`) impose un intervalle minimal :

- un `?refresh=1` reçu moins de 10 s après la dernière synchro **réussie** est ignoré : le board est servi depuis le cache (`X-Cache: HIT`, ou `STALE` si `CACHE_TTL` est plus court) ;
- après l'échec d'un rafraîchissement en arrière-plan, le board périmé est servi sans nouvel essai pendant 10 s.

Une synchro en cours reste partagée par toutes les requêtes. Sans données en cache, une requête tente toujours une synchro : les erreurs ne sont pas mises en cache.

**Conséquences.**

- Un client ne peut pas déclencher plus d'un parcours de GitLab toutes les 10 s.
- Deux clics rapprochés sur Synchroniser ne relisent GitLab qu'une fois ; `X-Fetched-At` dit de quand datent les données.

---

## ADR-21 — Écarts assumés par rapport à `style.md`

**Contexte.** `docs/style.md` vient de Nornir, un Gantt où le bleu désigne l'epic et le vert « dans les temps ». Gleipnir n'a ni jalon ni avancement, et son board posait des contraintes de lisibilité propres. `style.md` reste la référence : ces écarts sont consignés ici plutôt que réécrits dans le guide.

**Décision.**

- **Epic violet** : `--epic` vaut `--purple`, pas `--blue`. Le bleu reste l'accent : sélection, liens, focus. Le remplissage des barres est mélangé à du noir (90 % en clair, 84 % en sombre) pour que le texte blanc atteigne 4,5:1.
- **Menus opaques** : `--menu-bg` est opaque (`#f6f6f8` / `#2c2c2e`) au lieu de 97 %. Un menu qui déborde de la barre d'outils floutée laissait voir le board au travers, dans Chromium.
- **Interrupteurs bleus** : la piste « activée » est `--blue`. Le vert est réservé au sens « dans les temps ».
- **`--inset-bg`** : un nouveau jeton pour les listes groupées « inset » (inspecteur, réglages). En sombre, `--bg` noir faisait des blocs noirs sur la carte.
- **Éléments estompés** : un voile à 65 % de la couleur de fond, au lieu de l'opacité de l'élément. Ainsi les courbes de liens ne transparaissent pas dans le texte.

**Conséquences.** Les nouveaux composants suivent `style.md`, sauf sur ces points.

---

## ADR-22 — Outillage de développement dans le devcontainer

**Contexte.** Dans le devcontainer (montage WSL), inotify ne voit pas les modifications de fichiers : Vite servait du code périmé. Par ailleurs, plusieurs exécutions Playwright en parallèle se marchaient dessus, sur les ports comme dans `test-results/`.

**Décision.**

- Le serveur Vite surveille les fichiers par **polling** (300 ms). `VITE_POLLING=0` le désactive.
- Playwright lit **`E2E_API_PORT`** (8081 par défaut) et **`E2E_WEB_PORT`** (5174 par défaut). Hors des ports par défaut, ses résultats vont dans `test-results/<port>`.
- Une pile déjà lancée sur ces ports est réutilisée, hors CI.

**Conséquences.** Deux suites e2e peuvent tourner côte à côte, par exemple `E2E_API_PORT=8093 E2E_WEB_PORT=5193 npm run test:e2e`.


## ADR-23 — Couverture de tests : 90 % de lignes et de fonctions

**Contexte.** La couverture n'était pas mesurée côté frontend. Côté Go, `cmd/server` n'était presque pas testé : `run` lisait l'environnement du processus et attendait un signal, ce qui le rendait intestable.

**Décision.**

- **Seuil** : au moins **90 % des lignes et 90 % des fonctions** couvertes, pour le backend comme pour le frontend. Les cas limites sont testés explicitement (bornes, valeurs vides, erreurs), pas seulement les chemins nominaux.
- **Frontend** : dev-dépendance **`@vitest/coverage-v8`**, à la même version que `vitest`. C'est le fournisseur officiel de Vitest ; il s'appuie sur la couverture native de V8, sans instrumentation Babel ni dépendance d'exécution. `vitest.config.ts` fixe les seuils, donc `npm run test:coverage` échoue en dessous. Sont exclus :
  - les tests et leur setup ;
  - `fixtures.ts` ;
  - les fichiers de types seuls ;
  - `main.tsx`, couvert par Playwright.
- **Backend** : la bibliothèque standard suffit (`go test -coverprofile`, puis `go tool cover -func`).
- **`cmd/server`** :
  - `run(ctx, getenv, logger)` reçoit son contexte et sa lecture de l'environnement ;
  - `serve` porte les signaux, le logger et le code de sortie ;
  - `main` se réduit à `os.Exit(serve(os.Getenv, os.Stderr))` ;
  - `shutdownTimeout` est une variable, pour tester la fermeture forcée des connexions.

**Conséquences.** Les tests de `cmd/server` démarrent un vrai serveur sur un port libre et s'envoient SIGTERM. Ils ne le font qu'une fois `serve` à l'écoute du signal, sinon le binaire de test serait tué. Seul `main` reste non couvert côté Go.

---

## ADR-24 — Synchro complète périodique et rafraîchissement ciblé

*2026-11-23 · Accepté · Remplace ADR-3, amende ADR-20*

**Contexte.** Une synchro complète parcourt toutes les pages `workItems` du groupe, l'une après l'autre (3 à 8 s par page). Le bouton Synchroniser en lançait une et l'attendait : c'était très lent. La synchro de fond, elle, ne partait qu'à la première requête après `CACHE_TTL`. Or l'utilisateur ne regarde souvent que quelques couloirs.

**Décision.**

- **Synchro complète périodique** (`cache.Store.Run`) : au démarrage, puis `CACHE_TTL` après la fin de chaque synchro, pour qu'elles ne se chevauchent pas. Le board en cache reste servi pendant la synchro (`X-Cache: HIT`). Une requête ne lance une synchro complète que s'il n'y a encore aucune donnée.
- **Rafraîchissement ciblé** : `GET /api/board?refresh=1&groups=a,b`.
  - Le frontend envoie les groupes des couloirs actifs (tous les groupes de chaque couloir, ADR-34), sans ceux dont un ancêtre est déjà listé (`refreshScope`).
  - Le backend relit **seulement** les work items du sous-arbre de chaque groupe (`group(fullPath)` + `includeDescendants`), jusqu'à 4 en parallèle. Il ne relit ni les groupes, ni les cadences, ni les itérations.
  - Le sous-arbre est toujours lu en entier, même pour un couloir sans sous-groupes : les issues vivent dans les projets, sous le groupe.
  - Les groupes inconnus sont ignorés. Sans groupe connu : HTTP 400 `invalid_scope`. Il n'y a plus de synchro complète depuis l'interface.
- **Fusion** (`board.MergeScope`, règles métier testées table par table) :
  - les éléments du sous-arbre sont remplacés, ainsi que tout élément qui porte l'ID d'un élément relu (déplacé dans le sous-arbre) ;
  - le côté relu fait foi pour les liens qui le touchent : les liens des autres éléments qui pointent dans le sous-arbre sont retirés. Sinon, un lien supprimé dans GitLab survivrait par l'autre côté, puisque `Build` réunit les deux sens ;
  - le board entier est ensuite reconstruit avec `board.Build`, puis réencodé.
- **Date de lecture par groupe** :
  - chaque groupe garde l'heure de **début** de la lecture dont viennent ses éléments ;
  - `groups[].syncedAt` la sert au frontend ;
  - « Mis à jour il y a… » montre la plus ancienne des groupes affichés par les couloirs actifs ;
  - `X-Fetched-At` donne la plus ancienne de tout le board.
- **Lectures concurrentes** : une synchro complète et un rafraîchissement ciblé peuvent se croiser. Pour chaque groupe, on garde la lecture **commencée le plus tard** : ni l'un ni l'autre n'écrase des données plus récentes. La fusion et l'encodage se font sous un seul verrou, dans l'ordre d'application.
- **Intervalle minimal** (ADR-20) : il s'applique désormais **par groupe**, compté depuis la **fin** de la lecture. Un rafraîchissement dont tous les groupes ont été relus depuis moins de 10 s est servi depuis le cache. Deux rafraîchissements de la même portée partagent une seule lecture.
- **Plus de purge après 24 h** : un board ancien, dont l'âge est affiché honnêtement, vaut mieux qu'une erreur.

**Conséquences.**

- Le bouton est d'autant plus rapide que les couloirs actifs sont peu nombreux. Avec tous les couloirs par défaut, la portée couvre presque tout le groupe. Le gain vient alors seulement du parallélisme et des requêtes évitées.
- Le board peut mêler des groupes d'âges différents, au plus `CACHE_TTL` plus la durée d'une synchro.
- Un élément déplacé **hors** du sous-arbre relu disparaît jusqu'à la synchro complète suivante, ou jusqu'au rafraîchissement de son nouveau groupe.
- La date de chaque groupe est servie dans le board : le frontend recalcule l'âge à chaque changement de couloir, sans nouvelle requête.

## ADR-25 — Faux GitLab pour la démo et les e2e

*2026-11-24 · Accepté · Remplace ADR-9, amende ADR-17 · Amendé par ADR-26 (jeton vérifié)*

**Contexte.** Le mode démo de l'ADR-9 vivait dans le binaire de production : `GLEIPNIR_DEMO=1` faisait servir `board.DemoRaw` au lieu de GitLab.

- Le binaire livré embarquait un jeu factice et un interrupteur : une variable oubliée dans un `.env` suffisait à servir de fausses données.
- Les e2e court-circuitaient le client GitLab : requêtes, pagination et conversion n'étaient jamais exercées de bout en bout.
- Les liens de la démo pointaient vers `gitlab.exemple.fr`, un domaine réel que n'importe qui peut enregistrer.

**Décision.**

- **Le backend n'a plus de mode démo.** `GLEIPNIR_DEMO` n'est plus lue ; `GITLAB_GROUP` est toujours obligatoire ; `/api/health` perd son champ `demo`.
  - Une ancienne configuration de démo **échoue fermée** : sans `GITLAB_GROUP`, le backend refuse de démarrer, avec un message qui renvoie vers l'overlay. Si la variable traîne à côté d'une vraie configuration, elle donne seulement un avertissement.
- **Un faux GitLab** (`gitlab-mock/`) imite l'API GraphQL de GitLab pour les **seules** requêtes de Gleipnir et sert le jeu de démo.
  - Module Go séparé, bibliothèque standard uniquement, qui n'importe rien de `backend/` : il ne partage avec le backend que le contrat HTTP.
  - Il aiguille sur le nom de l'opération (`Groups`, `Cadences`, `Iterations`, `WorkItems`) et répond `unsupported query` à toute autre. Un `fullPath` inconnu donne `group: null`, comme GitLab. `CurrentIterations` a disparu avec l'ADR-38.
  - Il pagine (10 nœuds par page par défaut) et filtre par groupe : les cadences du groupe et de ses ancêtres, les itérations de ses ancêtres et de ses descendants, les work items de son sous-arbre (`includeDescendants`).
  - Il ignore le jeton et ne journalise aucun en-tête.
  - Les `webUrl` utilisent `gitlab.example.com`, domaine réservé (RFC 2606).
- **Démo Docker** : un overlay `docker-compose.demo.yml`, absent du compose de base.
  - Il ajoute `gitlab-mock`, sans port publié, en `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, uid 10001.
  - Il impose au backend `GITLAB_URL=http://gitlab-mock:8080` et `GITLAB_TOKEN=""`. `environment` l'emporte sur `env_file` : un vrai jeton du `.env` n'est jamais envoyé au faux GitLab.
- **E2E** : Playwright démarre le faux GitLab, puis le vrai backend branché dessus (jeton vidé), puis Vite.
- **Jeton en clair** : le backend avertit quand un jeton part en `http://` vers une autre machine que la boucle locale.

**Conséquences.**

- Le binaire et l'image de production ne contiennent plus de données factices. `board.DemoRaw` reste une fixture des tests Go (`demo_fixture_test.go`), non compilée dans le binaire.
- Les e2e couvrent maintenant le client GitLab et le rafraîchissement ciblé.
- Le jeu de démo existe en deux exemplaires : `gitlab-mock/dataset.go` (démo, e2e) et la fixture Go. Ils peuvent diverger sans casser la démo ; seule la version du faux GitLab est visible.
- Le faux GitLab **ne valide pas le schéma** : il ignore la sélection de champs. Un changement de requête se valide toujours sur un vrai GitLab (test `@live`).
- Lancer la démo demande l'overlay : `docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build`.

## ADR-26 — Jeton de démo vérifié par le faux GitLab

*2026-11-24 · Accepté · Amende ADR-25*

**Contexte.** Selon l'ADR-25, le faux GitLab acceptait n'importe quel jeton et l'overlay vidait celui du backend. L'envoi du jeton n'était donc jamais exercé : un backend qui l'aurait perdu ou mal formé serait passé inaperçu dans la démo et les e2e.

**Décision.**

- Le faux GitLab **exige** le jeton de `GITLAB_MOCK_TOKEN`, obligatoire au démarrage. Il le lit comme GitLab, dans `Authorization: Bearer …` ou `PRIVATE-TOKEN`, et le compare en temps constant.
- Tout autre jeton, ou son absence, reçoit **HTTP 401** `{"message":"401 Unauthorized"}`. Le backend le traduit en `unauthorized`, comme pour un vrai GitLab.
- Les logs disent `token rejected` avec l'adresse distante, **jamais** le jeton reçu ni le jeton attendu. `/-/health` reste ouvert.
- L'overlay donne la **même** valeur aux deux côtés : `${GLEIPNIR_DEMO_TOKEN:-DEMO-JETON-TEST}`. Elle écrase toujours le jeton du `.env`.
- Playwright passe `DEMO-JETON-TEST` aux deux processus.

**Conséquences.**

- Chaque chargement du board en démo et en e2e prouve que le backend envoie bien son jeton. Un test Go de `cmd/server` vérifie qu'un jeton refusé donne 401 `unauthorized`, sans fuite du jeton.
- En démo, le backend avertit que le jeton circule en `http://` : c'est voulu, il est factice.
- `go run .` dans `gitlab-mock/` demande `GITLAB_MOCK_TOKEN`.

## ADR-27 — Seeder : le jeu de démo dans un vrai GitLab

*2026-11-24 · Accepté*

**Contexte.** Le faux GitLab (ADR-25) ne valide ni le schéma ni le comportement de GitLab. On veut faire tourner la pile entière, et ses e2e, sur une vraie instance Premium/Ultimate remplie avec **les mêmes données**.

**Décision.**

- **Un seul jeu de démo**, `gitlab-mock/dataset`, sémantique et **stockable dans GitLab** :
  - noms de groupe sans « & » ;
  - usernames `demo-*`, pour ne jamais tomber sur un vrai compte ;
  - titres uniques ;
  - parents dans le groupe du projet ;
  - un seul lien par paire.
  
  Un test vérifie ces contraintes. Le faux GitLab le rend en GraphQL ; le seeder l'écrit.
- **Seeder** `gitlab-mock/cmd/seed`, bibliothèque standard uniquement, REST + GraphQL.
  - **Sous un groupe existant** (`SEED_GROUP`) : il ne crée pas de groupe de premier niveau.
  - **Dry-run par défaut** : sans `-apply`, il lit et affiche ce qu'il ferait.
  - **Idempotent** : il retrouve par chemin (groupes, projets) ou par titre (labels, cadence, itérations, work items) ce qu'une exécution précédente a créé. Il ne crée que ce qui manque et corrige ce qui a dérivé : nom, couleur, état, itération, parent, assigné, labels manquants, liens manquants.
  - **Recalage** : les itérations et les dates d'epic suivent aujourd'hui, pour que « Itération 15 » reste en cours. Les itérations sont déplacées dans l'ordre qui évite tout chevauchement.
  - **Aucune suppression**, jamais.
  - **Deux cadences** (ADR-38) : « Sprints produit » dans le groupe racine, et « Squad data » dans le sous-groupe `data`, aux dates de l'Itération 13 à 18, où sont planifiées les issues de l'équipe data.
  - **Cadences manuelles** par défaut (titres et trou de vacances). `-cadence=auto` crée une cadence automatique si l'instance refuse les manuelles : les epics sont alors datés d'après les itérations générées.
  - **Utilisateurs** : créés seulement si le jeton est admin, puis ajoutés en Reporter. Sinon, les éléments restent sans assigné, avec un avertissement.
- **Sécurité** :
  - le jeton d'écriture (`api`) vient de `SEED_TOKEN`, **jamais d'un flag**, et n'est jamais affiché ; il est distinct du jeton `read_api` de Gleipnir ;
  - `http://` est refusé hors boucle locale, sauf avec `-insecure-http` ;
  - les mots de passe des utilisateurs créés sont aléatoires et jamais affichés ; leurs e-mails sont en `@gitlab.example.com`.

**Conséquences.**

- Les tests du seeder tournent contre un **faux GitLab à état** qui refuse ce que GitLab refuse : noms avec « & », chevauchement d'itérations, parent non-epic, assigné non membre, lien en double. Ils vérifient la création, la deuxième exécution sans écriture, le recalage dans les deux sens, la correction des dérives, le dry-run et le cas non-admin.
- Noms, arguments, inputs et énumérations ont été **vérifiés sur l'introspection de gitlab.com** (2026-11-24). Le seeder n'a **pas encore tourné sur une vraie instance** : c'est une limite connue jusqu'au premier passage sur l'instance Ultimate auto-hébergée.
- Les mutations `workItem*` sont « Experiment » dans GitLab : une mise à jour de l'instance peut casser le seeder, pas Gleipnir.

## ADR-28 — E2E agnostiques : même suite sur le faux et le vrai GitLab

*2026-11-24 · Accepté · Amende ADR-17*

**Contexte.** Les e2e de démo désignaient les éléments par leurs refs de maquette (`&18`, `#110`), le groupe par `plateforme/atlas` et les itérations par leur titre. Sur un vrai GitLab rempli par le seeder (ADR-27), GitLab attribue lui-même les IID : ils repartent de 1 dans chaque groupe et chaque projet, et `&1` existe en quatre exemplaires. La racine et, sans droits admin, les assignés diffèrent aussi.

**Décision.**

- Un élément se désigne par sa **clé** dans le jeu de démo et se **trouve par son titre**, unique dans le jeu.
- Tout le reste est **lu dans le board servi** : refs, itérations, racine, chemins, cadence, assignés. `e2e/global-setup.ts` le charge une fois et le passe aux workers par l'environnement ; `e2e/demo.ts` le lit paresseusement, car les fichiers de test se chargent avant le setup.
- Les assertions de **comportement** ne changent pas : comptes, liens, conflits, chemin critique, fenêtre et couloirs sont ceux du jeu, identiques sur les deux.
- Une recherche par ref vérifie que tout ce qui reste affiché correspond : sur un vrai GitLab, `#1` trouve aussi `#10` et les `#1` des autres projets.
- Le setup refuse un board dont l'itération en cours n'est pas « Itération 15 », avec un message qui renvoie au seeder.
- Le faux GitLab sait **se numéroter comme un GitLab rempli par le seeder** (`GITLAB_MOCK_NUMBERING=gitlab`, `GITLAB_MOCK_ROOT`). `npm run test:e2e:gitlab-like` rejoue toute la suite ainsi : c'est la preuve, sans instance réelle, que la suite ne dépend pas des refs de la maquette.

**Conséquences.**

- `BASE_URL=http://localhost npm run test:e2e` lance toute la suite de démo sur une pile branchée sur un vrai GitLab rempli. Elle reste valide deux semaines après chaque passage du seeder.
- Les titres des tests gardent les clés de la maquette : un rapport se lit de la même façon sur les deux environnements.
- Ajouter un élément au jeu demande d'ajouter son titre dans `e2e/demo.ts`.

## ADR-29 — Colonnes à la largeur du board

*2026-11-24 · Accepté · Amende la spec §4.3*

**Contexte.** Les colonnes avaient une largeur fixe : 212 px, 180 px au-delà de 7 colonnes. Sur un grand écran, avec la fenêtre par défaut de 5 itérations, le board s'arrêtait vers 1 300 px et laissait un vide à droite.

**Décision.**

- `computeBoardView` reçoit la largeur intérieure du conteneur de défilement (`ViewInput.availableWidth`, barre de défilement exclue). Les colonnes, « Non planifié » comprise, s'en partagent la largeur à parts égales, arrondie au pixel inférieur pour ne jamais déborder.
- Les largeurs fixes deviennent des **minimums** : quand elles ne tiennent pas, le board défile comme avant. Pas de largeur maximale.
- `BoardCanvas` mesure son conteneur avec un `ResizeObserver` et la remonte à `App`. `App` la passe par `useDeferredValue` : redimensionner la fenêtre ne bloque pas sur un gros board.

**Conséquences.**

- Ouvrir l'inspecteur, replier le panneau latéral ou redimensionner la fenêtre recalcule la mise en page : les éléments se déplacent avec leurs colonnes.
- Le premier rendu se fait aux largeurs minimales, le suivant à la largeur mesurée.
- Pas d'oscillation de la barre verticale : la hauteur du canevas ne dépend pas de la largeur des colonnes.

## ADR-30 — La recherche montre la chaîne de dépendances des résultats

*2026-11-24 · Accepté · Amende la spec §4.7 et §5.1*

**Contexte.** La recherche ne gardait que les éléments dont la référence ou le titre contient le texte. Un résultat apparaissait seul, sans ce qui le bloque ni ce qu'il bloque : on perdait justement ce que le board sert à montrer.

**Décision.**

- La recherche garde les éléments trouvés et **toute leur chaîne de dépendances** (`src/board/search.ts`, `searchItems`).
- **Deux parcours séparés** depuis les éléments trouvés :
  - l'amont remonte les liens (bloqueurs, bloqueurs des bloqueurs…) ;
  - l'aval les descend (bloqués, bloqués des bloqués…).
  
  Ils ne se mélangent pas : un autre bloqueur d'un élément bloqué n'est pas ramené, sinon la chaîne s'étendrait à presque tout le board.
- Seuls les **types de lien cochés** sont suivis, comme pour le dessin. `relates`, sans direction, se suit dans les deux sens dans chacun des parcours. `parent` va de l'epic vers l'issue.
- Le parcours traverse aussi les éléments masqués (issues fermées avec « Masquer les issues fermées ») : la chaîne existe, ils ne sont juste pas dessinés.
- Couloirs, fenêtre et « Masquer les issues fermées » s'appliquent ensuite comme avant. Une dépendance hors fenêtre donne la pastille « › N », une dépendance qui ne correspond à aucun couloir actif la pastille « hors couloirs » (ADR-37).
- Les dépendances ajoutées portent `data-search-context` et sont **voilées** comme les éléments atténués de la sélection. La sélection et le chemin critique, quand ils sont actifs, reprennent la main sur l'atténuation.

**Conséquences.**

- Une recherche qui touche un élément très connecté peut ramener une grande partie du board.
- Les compteurs comptent aussi les dépendances affichées.
- E2E : une recherche par ref ne vérifie plus que les éléments affichés comme résultats. Une assertion sur la chaîne exacte cherche par titre, car sur un vrai GitLab `&1` existe dans chaque groupe.

## ADR-31 — La vue dans l'URL, partageable par un lien

*2026-11-24 · Remplacé par ADR-36 · Remplaçait l'ADR-5 pour la fenêtre · Amendait la spec §4.3, §7 et §9.7*

**Contexte.** On veut envoyer à quelqu'un un lien qui ouvre le board avec les mêmes filtres. La fenêtre était dans `localStorage`, commune à tous les onglets ; les options, la recherche et la sélection ne vivaient que dans la session. Des vues enregistrées et nommées (« portfolio ») viendront plus tard ; en attendant, aucune configuration de vue n'est sauvegardée.

**Décision.**

- **L'URL est la vue de l'onglet** (`src/board/share.ts`). Le front la lit une fois, au chargement, et la tient à jour avec `history.replaceState`, sans ajouter d'entrée d'historique. Deux onglets sur deux URL sont deux vues indépendantes ; un rechargement garde la vue.
- **Plus de `gleipnir.lanes` ni de `gleipnir.window`.** Restent dans `localStorage` les préférences qui ne disent pas ce qu'on voit : l'apparence et le panneau replié.
- **Paramètres**, valeurs par défaut omises (la vue par défaut a une URL nue). Groupes, itérations et éléments sont désignés par le **dernier segment de leur GID** (`gid://gitlab/Group/45` → `45`) : court, et stable si un groupe est renommé ou déplacé. Le backend envoie donc `groups[].id`.

  | Param | Contenu |
  |---|---|
  | `groups` | groupes cochés (les couloirs, ADR-32), dans l'ordre de l'arbre. Vide : aucun. Absent : les sous-groupes directs |
  | `fold` | groupes dont le couloir est replié |
  | `from`, `to` | fenêtre, par les itérations |
  | `types` | `epics` ou `issues` quand un seul type est affiché (vide : aucun) |
  | `label` (répété), `labelMode=all` | filtre de labels |
  | `links` | types de lien cochés (`blocks,parent`) |
  | `closed=hide`, `unplanned=hide`, `critical=1` | options d'affichage |
  | `q` | recherche |
  | `item` | élément sélectionné |

- **Fenêtre fixe dans un lien** : la barre d'adresse omet la fenêtre par défaut (elle suit l'itération en cours), mais le bouton **Copier le lien** l'écrit toujours : le destinataire voit les mêmes itérations, même ouvert plus tard.
- **Tolérance** : tout ce qui est inconnu ou invalide retombe sur sa valeur par défaut, champ par champ (groupe, itération ou élément inconnu, valeur mal formée).
- La vue est résolue au rendu des premières données, pour ne jamais afficher la vue par défaut d'abord. Tant que le board n'est pas chargé (erreur comprise), l'URL n'est pas touchée.
- **Bouton Copier le lien** : dans la barre d'outils, ou dans l'en-tête du panneau Filtres sur téléphone, où la barre n'a pas la place. `navigator.clipboard`, avec repli sur `execCommand('copy')` hors contexte sécurisé (`http://` hors localhost).
- Les filtres ne vont jamais au backend : ouvrir un lien fait le même `GET /api/board` que d'habitude, servi par le cache.

**Conséquences.**

- Les GID sont propres à une instance GitLab : un lien ne se transpose pas d'une instance à l'autre (il retombe alors sur les valeurs par défaut).
- La configuration ne survit pas à la fermeture de l'onglet sans son URL : c'est le rôle du futur portfolio.

## ADR-32 — Couloirs en lecture seule : les groupes cochés de l'arbre GitLab

*2026-11-24 · Remplacé par ADR-34 · Remplaçait l'ADR-5 pour les couloirs · Amendait la spec §4.4, §4.7 et §4.8*

**Contexte.** Les couloirs étaient des filtres éditables : nom, couleur, groupes, sous-groupes, types, labels, création et suppression. Or Gleipnir est en **lecture seule** : un couloir ne doit rien porter que GitLab ne dise. Un nouveau couloir, c'est un nouveau groupe dans GitLab.

**Décision.**

- **Un couloir = un groupe coché** dans l'arbre des groupes GitLab, affiché dans la barre latérale (une case par groupe, une branche se replie). Nom, chemin et hiérarchie viennent de GitLab ; rien ne s'édite, rien ne se crée.
- **Un élément va dans le couloir de son groupe coché le plus proche** (`laneOf`) : son groupe, sinon le premier ancêtre coché. Cocher un sous-groupe le sort donc du couloir de son parent. Un élément n'est plus que dans un couloir ; sans ancêtre coché, il n'est pas affiché.
- **Par défaut**, les sous-groupes directs de la racine sont cochés (la racine s'il n'y en a pas), comme avant.
- **Ordre** : celui de l'arbre (parent, puis ses sous-groupes, frères triés par chemin), pas le tri brut des chemins (`a/b-x` passerait avant `a/b/c`).
- **Couleur stable** : celle du sous-groupe de premier niveau dont descend le groupe, prise dans la palette en ordre d'arbre ; la racine a la dernière. Un sous-couloir garde la couleur de son parent, et cocher un groupe ne change la couleur d'aucun autre. Sur le board, un sous-couloir montre sa place : « API et intégrations › Partenaires ».
- **Types et labels** deviennent des **filtres globaux** de la barre latérale (interrupteurs Epics / Issues bloquantes, liste de labels avec « Au moins un / Tous »), appliqués à tout le board après la recherche, comme « Masquer les issues fermées ».
- La feuille de réglages des couloirs (`LaneSettingsSheet`) est supprimée.

**Conséquences.**

- Plus de couloir transverse (deux groupes, ou un label) : le filtre de labels global le remplace en partie.
- Le faux GitLab gagne un groupe imbriqué (`api/partenaires`, qui porte &22) pour exercer l'arbre ; le seeder crée un groupe imbriqué sous son parent.

## ADR-33 — `AGENTS.md` en anglais

*2026-11-24 · Accepté · Amende l'ADR-16*

**Contexte.** `AGENTS.md` est le guide de travail des agents et des développeurs : conventions, commandes, pièges GitLab, invariants. Il parle du code (identifiants, fonctions, fichiers), qui est en anglais, et il est chargé tel quel par les agents (`CLAUDE.md` l'importe). En français, il mêlait deux langues à chaque ligne.

**Décision.**

- `AGENTS.md` est en **anglais**, comme le code, les identifiants, les commentaires et les titres de commit.
- `README.md`, `docs/` (spec, ADR, charte) et l'interface restent en **français**.
- Les textes d'interface cités dans `AGENTS.md` (sélecteurs Playwright, exemples) restent en français, entre guillemets : ce sont eux que les tests reconnaissent.

**Conséquences.**

- Une règle de travail s'écrit en anglais dans `AGENTS.md`, une décision en français ici.
- `AGENTS.md` renvoie aux sections de la spec et aux ADR par leur numéro (`§4.4`, `ADR-32`), pas par leur titre.

## ADR-34 — Couloirs éditables

*2026-11-26 · Accepté · Remplace l'ADR-32 · Reprend les couloirs par défaut de l'ADR-5 · Amende l'ADR-15 · Spec v0.3 §3, §4.1, §4.4, §4.8, §5.3*

**Contexte.** L'ADR-32 avait fait des couloirs les groupes cochés de l'arbre GitLab, en lecture seule : un élément dans un seul couloir, types et labels en filtres globaux. À l'usage, c'est trop rigide : on veut un couloir « Mobile + Web », un couloir par label, ou un couloir qui ne montre que les epics. La spec v0.3 revient à des couloirs **définis par un filtre**. La lecture seule concerne les données GitLab, pas la mise en page du board.

**Décision.**

- **Un couloir est un filtre** édité par l'utilisateur (spec §4.4) :
  - nom libre ;
  - couleur choisie dans la palette (ADR-15) ;
  - un ou plusieurs groupes, avec ou sans leurs sous-groupes ;
  - « Afficher les epics » ;
  - mode d'affichage des issues (ADR-35) ;
  - labels, avec « Au moins un » ou « Tous » ;
  - actif ou masqué.
  
  L'ordre de la liste est l'ordre d'affichage.
- **Correspondance** (§5.1, §5.3) : le groupe de l'élément (invariant 3 d'`AGENTS.md`) est un groupe du couloir, ou un de ses descendants si les sous-groupes sont inclus. Un epic demande « Afficher les epics », une issue le mode du couloir. Une liste de labels vide ne filtre pas.
- **Recoupement** : un élément apparaît dans **chaque** couloir actif auquel il correspond. Les compteurs ne le comptent qu'une fois.
- **Groupes choisis dans GitLab** : le panneau propose l'arbre des groupes lu par le backend (`board.groups`), comme le voulait l'ADR-5. On ne saisit pas de chemin : un chemin hors du groupe racine ne pourrait pas être lu.
- Les couloirs désignent leurs groupes par leur **GID**, stable si un groupe est renommé ou déplacé.
- **Couloirs par défaut** (premier chargement et « Rétablir la configuration d'exemple ») : un couloir par sous-groupe direct du groupe racine (la racine s'il n'en a pas), nommé comme le groupe, sous-groupes inclus, epics affichés, issues bloquantes seulement, sans label, couleurs de la palette dans l'ordre.
- **Panneau « Configurer les couloirs »** (`LaneSettingsSheet`) :
  - créer, modifier, supprimer, monter, descendre, activer ;
  - « Annuler » et « Appliquer » : rien ne change sur le board avant « Appliquer » ; Échap annule ;
  - plein écran sur mobile.
  
  La barre latérale liste les couloirs (case « actif », couleur, bouton « Modifier ») et porte le bouton « Nouveau couloir ». L'en-tête de chaque couloir rappelle son filtre et a aussi un bouton « Modifier ».
- **Validation au chargement** : les groupes inconnus sont retirés, un couloir sans groupe connu est retiré, une couleur ou un mode invalide retombe sur sa valeur par défaut, les labels inconnus sont retirés. Une valeur illisible redonne les couloirs par défaut ; une liste vide enregistrée reste vide.
- Les filtres globaux de types et de labels de l'ADR-32 disparaissent : ils reviennent dans chaque couloir.

**Conséquences.**

- Avec le jeu de démo, les couloirs par défaut sont les mêmes qu'avant : `api/partenaires` (&22) tombe dans le couloir « API et intégrations », sous-groupes inclus.
- Un élément peut figurer plusieurs fois sur le board. Ses liens relient l'occurrence du même couloir que l'autre bout, sinon la première (ADR-37).
- La configuration est propre au navigateur (ADR-36) : elle ne suit pas l'utilisateur et ne se partage pas.
- Les couloirs restent sans effet sur GitLab : seule la mise en page change.

## ADR-35 — Mode d'affichage des issues par couloir

*2026-11-26 · Accepté · Amende l'ADR-4, l'ADR-10 et l'ADR-19 · Spec v0.3 §2, §3, §5.1*

**Contexte.** Le board ne montrait que les issues qui bloquent un epic : le backend écartait les autres et n'en donnait que le nombre (`ignoredIssues`). Une équipe veut parfois voir toutes ses issues, ou aucune, couloir par couloir.

**Décision.**

- Chaque couloir a un **mode d'affichage des issues** :
  - « Toutes » ;
  - « Uniquement celles qui bloquent un epic », le mode par défaut ;
  - « Aucune ».
- **Le backend envoie toutes les issues** du groupe. `Issue.blocksEpics` peut être vide : une issue est bloquante si la liste ne l'est pas. Il n'y a pas d'autre indicateur. `ignoredIssues` est supprimé : le frontend compte lui-même les issues bloquantes (« 9 sur 16 » dans la barre latérale).
- `labels` réunit les labels de tous les epics et de toutes les issues. `links` relie tous les éléments du board, et un lien `parent` relie un epic à chacune de ses issues.
- **Non planifié** : toute issue sans itération de la cadence, bloquante ou non, va dans la colonne « Non planifié » (amende l'ADR-10).
- **Conflits** : calculés sur **tous** les liens « bloque », issue → issue compris. Ils s'affichent quand les deux bouts sont à l'écran.
- **Chemin critique** : sa portée ne change pas. Il ne passe que par les epics et les issues qui bloquent un epic. Ainsi une chaîne d'issues masquées par le mode « Bloquantes » ne le détourne pas, et son résultat sur le jeu de démo reste le même.

**Conséquences.**

- La réponse de `GET /api/board` grossit : jusqu'à environ 2 000 issues (spec §8). Elle reste gzippée par nginx.
- La règle « issue affichée » de l'ADR-19 devient « issue bloquante » : elle sert au mode par défaut et au chemin critique.
- Le contrat `model.go` ↔ `types.ts` change : `ignoredIssues` disparaît, et `blocksEpics` peut être vide.

## ADR-36 — Vue mémorisée dans le navigateur

*2026-11-26 · Accepté · Remplace l'ADR-31 · Spec v0.3 §4.3, §7, §9.7*

**Contexte.** L'ADR-31 mettait toute la vue dans l'URL, avec un bouton « Copier le lien ». Avec des couloirs éditables (ADR-34), une URL devrait porter des filtres entiers. Et on veut retrouver ses couloirs et sa fenêtre en rouvrant l'application, sans garder un lien. La spec v0.3 revient à une mémorisation dans le navigateur.

**Décision.**

- **`localStorage`**, lu avec validation et `try/catch` :
  - `gleipnir.lanes` : les couloirs (ADR-34) ;
  - `gleipnir.window` : la fenêtre, `{from, to}`, par GID d'itération. Une itération inconnue redonne la fenêtre par défaut ;
  - `gleipnir.cadences` : les cadences actives demandées, par GID (ADR-38) ;
  - `gleipnir.sidebar` : le panneau latéral replié ;
  - `gleipnir.appearance` : l'apparence.
- **Session seulement**, dans l'état React : types de lien, « Masquer les issues fermées », colonne « Non planifié », chemin critique, couloirs repliés, recherche et sélection.
- **Plus de vue dans l'URL** : l'application ne lit ni n'écrit l'URL. Le bouton « Copier le lien » et `src/board/share.ts` sont supprimés.

**Conséquences.**

- Deux onglets du même navigateur partagent couloirs et fenêtre : le dernier qui écrit l'emporte.
- On ne peut plus envoyer une vue à quelqu'un. Les vues nommées et partageables (§9.7) restent à faire, côté serveur.
- `groups[].id` reste servi : il désigne les groupes des couloirs.

## ADR-37 — Dépendances hors couloirs

*2026-11-26 · Accepté · Spec v0.3 §3, §4.5, §4.6*

**Contexte.** Avec des couloirs choisis (ADR-34), un élément affiché peut dépendre d'un élément qu'aucun couloir ne montre. Sans signe, la dépendance disparaît du board en silence. La pastille « hors fenêtre » ne couvre que les éléments d'un couloir placés hors de la fenêtre.

**Décision.**

- **Hors fenêtre** : l'autre élément correspond à un couloir actif mais tombe hors de la fenêtre. La pastille « › N hors fenêtre » ne change pas.
- **Hors couloirs** : l'autre élément ne correspond à **aucun couloir actif**.
  - Le lien n'est pas dessiné et l'élément n'est pas ajouté au board.
  - L'élément visible porte une pastille distincte, en pointillés, avec une icône de sortie : « N hors couloirs ». Sur un epic, avec le libellé complet ; sur une carte d'issue, l'icône et le nombre, avec le libellé en infobulle et en libellé ARIA. Les deux pastilles figurent dans la légende.
- **Ce qui compte** :
  - seuls les liens « Bloque » et « Lié à », si leur type est affiché. Les liens `parent` ne comptent jamais, sinon chaque epic serait signalé pour ses issues masquées par choix ;
  - l'appartenance ignore la fenêtre, la recherche et « Masquer les issues fermées ». Un élément exclu par la règle de son couloir (issue d'un couloir réglé sur « Aucune ») est hors couloirs s'il ne correspond à aucun autre.
- **Panneau de détail** : une dépendance hors couloirs est en pointillés, avec « Hors couloirs · <groupe> ». Ce n'est pas un bouton : on l'ouvre dans GitLab, ou on ajuste un couloir. Une dépendance hors fenêtre garde son comportement (elle déplace la fenêtre).
- **Occurrences multiples** : un élément présent dans plusieurs couloirs est relié par l'occurrence du même couloir que l'autre bout, sinon par la première dans l'ordre des couloirs.

**Conséquences.**

- Une dépendance n'est jamais perdue de vue : elle est dessinée, ou comptée dans l'une des deux pastilles.
- Le calcul se fait dans le frontend (`src/board/view.ts`), à partir des couloirs actifs, et se teste en Vitest.

## ADR-38 — Toutes les cadences, cadences actives choisies par l'utilisateur

*2026-11-26 · Accepté · Remplace l'ADR-6 · Spec §2, §4.3, §5.1, §5.2, §6*

**Contexte.** L'ADR-6 n'affichait qu'une cadence. Dans un GitLab où chaque équipe, souvent chaque sous-groupe, a sa propre cadence, les issues des autres équipes passaient toutes en « Non planifié » : la planification disparaissait du board. Une cadence de sous-groupe n'était même pas lue : `iterationCadences` ne descend pas dans les sous-groupes.

**Décision.**

- **Lecture** : le backend lit **toutes** les itérations, de toutes les cadences.
  - Requête : `iterations(includeAncestors: true, includeDescendants: true)`, sans filtre de cadence, avec `iterationCadence { id title active }`.
  - Les cadences sont celles de `iterationCadences(includeAncestorGroups: true)` (groupe et ancêtres), plus celles que portent les itérations (sous-groupes).
  - `CurrentIterations` est supprimée : la cadence en cours se déduit des itérations, avec l'horloge du backend.
- **Cadences actives** : leurs itérations font les colonnes.
  - Le frontend les demande par `GET /api/board?cadences=gid1,gid2`, avec ou sans `refresh=1`. Les GID inconnus sont ignorés.
  - Sans cadence connue, le **défaut** s'applique, dans cet ordre : la cadence de `GITLAB_CADENCE` ; toutes celles qui ont une itération contenant aujourd'hui ; la première que GitLab marque active ; la première par titre.
  - Le board renvoie toutes les cadences (`cadences[]`, triées par titre), avec `active` : le frontend affiche la réponse, jamais sa demande.
- **Colonnes** : les itérations des cadences actives, par date de début, puis date de fin.
  - Celles qui ont **les mêmes dates** de début et de fin font **une** colonne. La colonne prend l'ID, le titre et le lien de la première, par titre de cadence, et liste ses itérations (`iterationIds`) et leurs cadences (`cadenceIds`).
  - Des cadences décalées donnent des colonnes distinctes, qui peuvent se chevaucher. Le début d'un epic est alors la première colonne, dans l'ordre, qui finit après sa date de début. La recherche linéaire remplace la dichotomie, dont les dates de fin ne sont plus triées.
- **Issue d'une cadence non active** : elle est placée comme un epic aux dates de son itération, puis réduite à sa colonne de début. C'est la colonne qui contient la date de début de l'itération, ou la suivante dans un trou.
  - Elle est non planifiée si l'itération finit avant la première colonne ou commence après la dernière.
  - Une issue n'est donc plus non planifiée parce que sa cadence n'est pas la bonne. Elle compte aussi pour les dates d'un epic sans date.
- **Interface** : une section « Cadences » en tête du sélecteur d'itérations, une case par cadence, s'il y en a au moins deux.
  - La dernière cochée ne peut pas être décochée.
  - Sans colonne, le sélecteur n'offre que les cadences (« Aucune itération »).
  - Le choix est mémorisé dans `gleipnir.cadences` (ADR-36). La fenêtre mémorisée retrouve ses itérations dans les colonnes fusionnées, sinon la fenêtre par défaut s'applique.
  - Le sous-titre de la barre d'outils liste les cadences actives.
- **Cache** : le board des cadences par défaut est encodé à chaque synchro.
  - Un autre choix de cadences est encodé à la demande, hors verrou, une fois par synchro (16 choix au plus, tous oubliés au-delà).
  - Le conflit, le chemin critique et le rattachement restent calculés par le backend, sur les colonnes du choix.

**Conséquences.**

- Une issue planifiée ne disparaît plus parce qu'elle vit dans la cadence d'une autre équipe.
- Avec des cadences décalées, les colonnes se chevauchent : un epic peut couvrir des colonnes qui se recouvrent, et « strictement plus tard » se compte en colonnes. Décocher une cadence redonne des colonnes simples.
- La lecture des itérations grossit : 1 513 itérations de 21 cadences, en 16 pages et une dizaine de secondes, sur `gitlab-org/security-products`, contre une seule cadence avant.
- `GITLAB_CADENCE` ne choisit plus « la » cadence : seulement la cadence active par défaut.
- Le jeu de démo a une deuxième cadence, « Squad data », dans le sous-groupe `data`, aux mêmes dates que l'Itération 13 à 18. Le faux GitLab et le seeder la servent et l'écrivent.
