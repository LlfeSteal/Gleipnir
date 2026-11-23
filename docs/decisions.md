# Décisions d'architecture

Ce fichier consigne les choix qui structurent Gleipnir, sous forme de courts ADR : contexte, décision, conséquences.

- Une décision qui change donne un **nouvel** ADR, qui remplace l'ancien. On ne réécrit pas l'histoire : l'ancien ADR est marqué « Remplacé par ADR-n ».
- Les références « § » renvoient à `docs/specifications.md`.

| # | Décision | Date |
|---|---|---|
| 1 | Backend Go sans dépendance externe | 2026-11-23 |
| 2 | GraphQL GitLab écrit à la main | 2026-11-23 |
| 3 | Cache mémoire « stale-while-revalidate » | 2026-11-23 |
| 4 | Le backend normalise, le frontend met en page | 2026-11-23 |
| 5 | Couloirs stockés dans le navigateur | 2026-11-23 |
| 6 | Une seule cadence par board | 2026-11-23 |
| 7 | Frontend sans dépendance d'exécution | 2026-11-23 |
| 8 | Déploiement en deux images | 2026-11-23 |
| 9 | Mode démo | 2026-11-23 |
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

---

## ADR-1 — Backend Go sans dépendance externe

*2026-11-23 · Accepté*

**Contexte.** Le backend fait peu de choses :

- lire GitLab ;
- appliquer des règles métier ;
- servir deux routes JSON.

Go 1.22 apporte le routage par méthode dans `net/http.ServeMux` (`"GET /api/board"`) et `log/slog`. Nornir utilise Gin et godotenv, qui n'apportent rien d'essentiel ici.

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

*2026-11-23 · Accepté*

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

*2026-11-23 · Accepté*

**Contexte.** Les règles métier (§5) doivent être identiques pour tous et testables sans navigateur. La mise en page, elle, dépend de choix d'interface faits dans le navigateur : couloirs, fenêtre, recherche.

**Décision.**

- Le backend (`internal/board`) calcule tout ce qui est **métier et stable** :
  - le rattachement des epics aux itérations (§5.2) ;
  - la normalisation des liens (§5.4) ;
  - les issues affichables (§5.1) ;
  - les éléments non planifiés ;
  - les conflits ;
  - le chemin critique.
- Le frontend calcule ce qui dépend de l'**interface** : appartenance aux couloirs, fenêtre, recherche, placement, tracé des liens, compteurs.

**Conséquences.**

- Le JSON de `GET /api/board` est un contrat (`model.go` ↔ `src/api/types.ts`) : ces deux fichiers évoluent ensemble.
- Les règles métier sont testées en Go, table par table. La logique de mise en page est testée en TypeScript pur (`src/board`).

## ADR-5 — Couloirs stockés dans le navigateur

*2026-11-23 · Accepté*

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

*2026-11-23 · Accepté*

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
  - build `golang:1.22-alpine`, binaire statique (`CGO_ENABLED=0`) ;
  - exécution sur `alpine:3.20` avec `ca-certificates` et `tzdata` ;
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

*2026-11-23 · Accepté*

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

*2026-11-23 · Accepté*

**Contexte.** La spec laisse ouvertes la zone « Non planifié » (§9.1, §9.2), le chemin critique (§9.5) et les conflits de dates (§9.6). La v1 les traite.

**Décision.**

- **Conflit** : un lien « bloque » dont l'itération de fin du bloqueur est **strictement postérieure** à l'itération de début de l'élément bloqué.
  - Même itération : pas de conflit.
  - Bloqueur fermé : jamais de conflit.
  - Le conflit est affiché en rouge, seul usage du rouge sur le board.
- **Chemin critique** : la plus longue chaîne de liens « bloque » entre éléments **ouverts**, dans le graphe orienté.
  - Les cycles sont détectés, cassés et signalés dans les logs.
  - À longueur égale, on garde la chaîne qui finit le plus tard.
- **Non planifié** :
  - un epic sans dates ni enfant planifié ;
  - une issue bloquante sans itération.
  
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

*2026-11-23 · Accepté*

**Contexte.** La spec prévoit une couleur libre par couloir. Un sélecteur libre permettrait du rouge (conflits), du violet (epics) ou du teal (issues), et donnerait des couleurs illisibles en mode sombre.

**Décision.**

- Un couloir choisit parmi **8 couleurs système Apple**, définies en jetons clair et sombre : indigo, bleu, cyan, menthe, jaune, orange, rose et brun (`--lane-*`).
- Rouge, vert, violet et teal sont exclus : ils portent déjà un sens.
- Les nouveaux couloirs prennent la couleur libre suivante.
- Le composant n'expose que `data-lane-color` ; le CSS en déduit `--lane`.

**Conséquences.**

- Couleurs harmonieuses et lisibles dans les deux apparences, sans conflit de sens.
- Au-delà de 8 couloirs, les couleurs se répètent.

## ADR-16 — Documentation en français, code en anglais

*2026-11-23 · Accepté*

**Contexte.** L'équipe écrit en français et les utilisateurs sont francophones. Le code, lui, suit les conventions de l'écosystème et des projets voisins.

**Décision.**

- En **français** :
  - la documentation (`README.md`, `AGENTS.md`, `docs/`) ;
  - l'interface, centralisée dans `src/strings/`.
- En **anglais** :
  - le code, les identifiants et les commentaires ;
  - les messages d'erreur techniques du backend ;
  - les titres de commit.

**Conséquences.**

- L'internationalisation reste possible, puisque les textes sont centralisés.
- Les tests Playwright sélectionnent par les libellés français : ils changent avec eux.

## ADR-17 — Stratégie de tests

*2026-11-23 · Accepté*

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

- **Ordre des itérations** : par date de début, puis `sequence`, puis ID. Un titre vide devient « Itération {sequence} ». Une itération en double (même ID, d'une page à l'autre) ou sans dates valides (manquantes, illisibles, fin avant le début) est ignorée : elle fausserait la recherche dichotomique du rattachement.
- **Itération en cours** : la première dont l'intervalle `[début, fin]`, bornes incluses, contient la date du jour (dans le fuseau `TZ`). Si aucune ne la contient, `current = -1`. Le frontend affiche alors par défaut les cinq premières itérations.
- **Début d'un epic** : la première itération qui finit au plus tôt le jour du début. C'est celle qui contient la date, ou la suivante quand la date tombe entre deux itérations ou avant la première.
- **Fin d'un epic** : la dernière itération qui commence au plus tard le jour de la fin. C'est celle qui contient la date, la précédente dans un intervalle, ou la dernière quand la date est après la dernière itération.
- **Dates inversées** (début après la fin) : elles sont d'abord échangées.
- **Epic entièrement dans un intervalle** entre deux itérations : il est rattaché à l'itération **suivante** (début = fin).
- **Epic entièrement hors de la cadence**, qui finit avant la première itération ou commence après la dernière : il est **non planifié**. On ne le borne pas aux extrémités, pour ne pas suggérer une date fausse.
- **Une seule date** : le côté manquant vient des issues enfants (min pour le début, max pour la fin), sans jamais dépasser le côté connu. Sans enfant, l'epic tient sur une itération. `datesFromChildren` reste faux.
- **Dates propres et enfants planifiés** : les dates de l'epic priment toujours. Les enfants ne servent que s'il n'a pas de date, ou n'en a qu'une.
- **Sans date** : le min et le max des itérations de **toutes** les issues enfants de la cadence, affichées ou ignorées, ouvertes ou fermées. Sans enfant planifié, l'epic est non planifié.
- **Issue affichée** : seulement si elle est la **source** d'un lien `blocks` vers un epic. Une issue bloquée par un epic n'est pas affichée pour cette raison.
- **Liens** :
  - deux liens `blocks` A→B et B→A sont gardés tous les deux, comme un cycle ;
  - les liens `parent` ne relient qu'un epic à une issue affichée : la hiérarchie entre epics n'est pas dessinée.
- **Labels** : en cas de doublon de titre, la première couleur rencontrée l'emporte.
- **Conflit** : seul l'état du bloqueur compte. Un côté non planifié ne donne jamais de conflit, car il n'y a rien à comparer.
- **Chemin critique** :
  - il faut au moins 2 éléments ;
  - à longueur égale, on prend la chaîne qui finit le plus tard, puis celle qui **commence le plus tôt** (elle couvre la plus grande partie du plan), puis la plus petite liste d'IDs ;
  - les cycles sont cassés par un parcours en profondeur dans l'ordre des IDs, et les liens ignorés sont journalisés.

**Conséquences.** Changer l'une de ces règles demande de modifier son test dans `internal/board/*_test.go` et cette section.

## ADR-20 — Synchros forcées limitées

*2026-11-23 · Accepté*

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

