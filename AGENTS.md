# AGENTS.md — Gleipnir

Ce document sert de référence à tout agent ou développeur qui travaille dans ce dépôt.

- Lisez-le en entier avant de modifier le code.
- **Tenez-le à jour** (voir « Règles de travail »).

## Le projet

**Gleipnir** affiche les **dépendances** entre les epics et les issues d'un groupe GitLab, sur une frise d'**itérations**. Il est en lecture seule.

- La spec fonctionnelle est `docs/specifications.md`. L'application y porte son nom de travail, « Trame ».
- La maquette de référence est `docs/mockup.html`.
- La charte graphique est `docs/style.md`, transposée des HIG Apple.
- Les choix d'architecture sont dans `docs/decisions.md`.

**Stack.**

- **Backend** : Go 1.22, **bibliothèque standard uniquement** (module `gleipnir`, `go.mod` sans dépendance).
  - Le backend lit l'API GraphQL de GitLab avec un jeton serveur `read_api`.
  - Il applique les règles métier dans `internal/board`.
  - Il garde le board encodé en mémoire : une synchro complète au démarrage puis toutes les `CACHE_TTL`, et des rafraîchissements ciblés sur les groupes des couloirs actifs (ADR-24).
- **Frontend** : React 19, TypeScript 6 et Vite 8, **sans autre dépendance d'exécution** que `react` et `react-dom`.
  - Le board est dessiné en HTML/CSS.
  - Les liens sont dans un seul SVG.
- **Déploiement** : `docker compose`, avec deux images.
  - Le backend tourne sur Alpine, en utilisateur non-root numérique.
  - Le frontend tourne sur nginx-unprivileged : il sert le SPA et proxifie `/api/`.
- **Projets voisins** de même stack et de même charte :
  - `../Nornir` : Go, GitLab GraphQL, React et `theme.css` ;
  - `../Odin` : React 19 sans dépendance.
  
  Avant de réécrire une brique, cherchez si elle existe déjà là-bas.

## Arborescence

```
backend/
  cmd/server/main.go          serve (signaux, slog, code de sortie) → run(ctx, getenv, logger) : config, serveur, arrêt propre
  internal/config/            lecture et validation des variables d'environnement
  internal/gitlab/client.go   doGraphQL + paginate (repris de Nornir), erreurs typées (401 / 404 / Premium / cadence)
  internal/gitlab/queries.go  descendantGroups, iterationCadences, iterations, workItems
  internal/gitlab/structs.go  structures de désérialisation GraphQL
  internal/board/model.go     modèle JSON servi par GET /api/board (contrat avec le frontend)
  internal/board/raw.go       entrée de board.Build : les données telles que GitLab les donne
  internal/board/build.go     raw → Board : groupes, rattachement aux itérations, liens, issues affichées, non planifiés
  internal/board/merge.go     fusion d'un sous-arbre relu dans les données (MergeScope), portée (NormalizeScope)
  internal/board/analysis.go  conflits et chemin critique
  internal/board/demo.go      jeu de démonstration de la maquette (mode démo, tests)
  internal/cache/cache.go     board en mémoire : synchro complète périodique (Run), rafraîchissement ciblé (Refresh)
  internal/api/               handlers GET /api/health et GET /api/board
frontend/
  index.html                  script de thème inline (avant le premier rendu) — son hash est dans la CSP
  src/main.tsx, App.tsx       point d'entrée, coquille de l'application (état, préférences)
  src/api/types.ts            miroir TypeScript de model.go
  src/api/client.ts           fetch + ApiError
  src/board/                  logique pure : types, couloirs, fenêtre, format, mise en page, liens, statistiques
  src/components/ui/          primitives : Icons, Popover / MenuItem, Sheet (<dialog>), SearchField, Switch,
                              Checkbox, SelectList, SegmentedControl, StateViews, AppearanceMenu
  src/components/board/       le canevas : BoardCanvas, ItemGlyph, LinkSwatch…
  src/components/             Toolbar, WindowControl, Sidebar, Inspector, LaneSettingsSheet, SummaryLine
  src/hooks/                  useAppearance, usePreferences (useStoredState), useBoard
  src/strings/                textes de l'interface (ui.ts, board.ts, app.ts, réexportés par index.ts)
  src/styles/                 theme.css (jetons + contrôles), board.css (canevas), app.css (coquille)
  src/test/                   setup Vitest (jsdom), media.ts (matchMedia)
  e2e/                        tests Playwright (*.spec.ts : démo ; *.live.spec.ts : @live)
  nginx.conf.template         nginx de l'image : SPA, gzip, proxy /api, cache, en-têtes de sécurité
docs/                         specifications.md, mockup.html, style.md, decisions.md
docker-compose.yml            projet compose « gleipnir » : backend + frontend
.env / .env.example           configuration (.env n'est jamais commité)
README.md                     documentation utilisateur
CLAUDE.md                     importe ce fichier
```

## Commandes

```bash
# Backend
cd backend && gofmt -l . && go vet ./... && go test -race ./...
cd backend && go test -coverprofile=cover.out ./... && go tool cover -func=cover.out | tail -1   # couverture (≥ 90 %)
cd backend && GLEIPNIR_DEMO=1 go run ./cmd/server                  # mode démo, http://localhost:8080
cd backend && (set -a; . ../.env; set +a; go run ./cmd/server)     # vrai GitLab : le backend ne lit pas .env lui-même

# Frontend
cd frontend && npm run build          # tsc -b + vite build
cd frontend && npm test               # Vitest : logique (node) et composants (jsdom)
cd frontend && npm run test:coverage  # idem, avec la couverture : échoue sous 90 % de lignes ou de fonctions
cd frontend && npx vitest run src/board/window.test.ts   # un fichier
cd frontend && npm run dev            # http://localhost:5173, proxy /api → GLEIPNIR_API_URL (défaut localhost:8080)

# Bout en bout (Playwright)
cd frontend && npx playwright install chromium   # une fois par conteneur
cd frontend && npm run test:e2e       # tout sauf @live : démarre le backend démo (8081) et Vite (5174)
cd frontend && E2E_API_PORT=8093 E2E_WEB_PORT=5193 npm run test:e2e   # sur d'autres ports, en parallèle d'une autre suite
cd frontend && BASE_URL=http://localhost npm run test:e2e:live   # @live, contre la pile docker sur un vrai GitLab

# Docker
docker compose up -d --build                     # vrai GitLab, .env requis — http://localhost
GLEIPNIR_DEMO=1 docker compose up -d --build     # mode démo, sans .env
docker compose config                            # valide le compose
docker compose down
```

## Configuration

Toutes les variables sont lues par le backend, via `internal/config`.

| Variable | Rôle |
|---|---|
| `GITLAB_URL` | Instance GitLab. Défaut : `https://gitlab.com`. |
| `GITLAB_TOKEN` | Jeton `read_api`. Il n'est jamais journalisé ni renvoyé par l'API. Le backend démarre sans jeton (avertissement), mais GitLab répondra 401 sur un groupe privé. |
| `GITLAB_GROUP` | Chemin complet du groupe racine. **Obligatoire hors mode démo** : sans lui, le backend refuse de démarrer. |
| `GITLAB_CADENCE` | Cadence d'itérations, par titre ou par id. Défaut : celle qui contient l'itération en cours. |
| `PORT` | Port du backend, 8080 par défaut. À ne pas changer sous compose : nginx proxifie vers `backend:8080` et le healthcheck vise 8080. |
| `CACHE_TTL` | Durée Go, `5m` par défaut : délai entre la fin d'une synchro complète et le début de la suivante. |
| `GLEIPNIR_DEMO` | `1` / `true` : sert `board.DemoRaw` au lieu de GitLab. Vide, `0` ou `false` : désactivé. |
| `TZ` | Fuseau horaire. Il décide de l'itération en cours. Compose le règle par défaut à `Europe/Paris` et l'image embarque `tzdata`. |
| `GLEIPNIR_PORT` | Compose uniquement : port de l'hôte qui publie le frontend, 80 par défaut. |
| `GLEIPNIR_BACKEND_URL` | Image frontend uniquement : cible du proxy `/api/`, `http://backend:8080` par défaut. |

**Compose.**

- `env_file` est **optionnel** (`required: false`).
- `GLEIPNIR_DEMO` et `TZ` passent par `environment`, interpolés depuis le shell puis depuis `.env` : le shell gagne.
- Après une modification de `.env` : `docker compose up -d --force-recreate backend`, puis `docker compose up -d`.

## API backend

- `GET /api/health` → `{"status":"ok","demo":bool,"gitlabUrl":"…","group":"…"}`. Jamais de jeton. Le healthcheck Docker s'en sert.
- `GET /api/board` → le `Board` de `internal/board/model.go`, déjà normalisé. Le frontend ne fait que la mise en page.
  - **Paramètres** : `?refresh=1&groups=a/b,a/c` relit les work items des sous-arbres de ces groupes, les fusionne dans le board, puis le sert (ADR-24).
    - Les groupes inconnus sont ignorés ; sans groupe connu, la réponse est 400 `invalid_scope`.
    - Si tous ces groupes ont été relus depuis moins de 10 s, le cache répond (ADR-20).
    - Aucune requête ne lance de synchro complète, sauf quand le backend n'a encore aucune donnée.
  - **Données par groupe** : `groups[].syncedAt` (RFC 3339) dit quand les éléments du groupe ont été lus. Le « Mis à jour il y a… » de la barre d'outils est la plus ancienne de ces dates parmi les groupes des couloirs actifs (`scopeSyncedAt`).
  - **En-têtes** :
    - `X-Fetched-At` (RFC 3339) : la lecture la plus ancienne parmi les groupes du board.
    - `X-Cache` : `HIT` (servi depuis le cache) ou `MISS` (lu pour cette requête).
- **Erreurs** : corps `{"error": "message", "code": "…"}`. Le frontend choisit son message à partir de `code`, jamais de `error`.

  | `code` | HTTP | Cause |
  |---|---|---|
  | `unauthorized` | 401 | Jeton refusé par GitLab, ou sans la portée `read_api` (403 `insufficient_scope`) |
  | `group_not_found` | 404 | Groupe absent ou invisible pour le jeton |
  | `premium_required` | 502 | Epics, itérations ou liens « bloque » indisponibles : édition Free |
  | `cadence_not_found` | 502 | `GITLAB_CADENCE` introuvable, ou aucune cadence |
  | `invalid_scope` | 400 | `?refresh=1` sans groupe connu dans `groups` |
  | `gitlab_unreachable` | 502 | GitLab ne répond pas, ou répond une erreur inattendue |
  | `internal` | 500 | Bug |

- **Cache** (`internal/cache`, ADR-24) :
  - il garde les données brutes (`board.Raw`), le board **encodé** et, par groupe, l'heure de début de la lecture dont viennent ses éléments ;
  - **synchro complète** (`Run`) : au démarrage, puis `CACHE_TTL` après la fin de la précédente. Le board en cache reste servi pendant ce temps. En cas d'échec, l'ancien board reste servi ;
  - **rafraîchissement ciblé** (`Refresh`) : il relit les sous-arbres demandés, jusqu'à 4 en parallèle (`gitlab.FetchItems`), les fusionne (`board.MergeScope`), puis reconstruit et réencode le board entier ;
  - une synchro complète et un rafraîchissement peuvent se croiser : pour chaque groupe, la lecture **commencée le plus tard** l'emporte. La fusion et l'encodage se font sous le verrou ;
  - une seule synchro complète à la fois ; les rafraîchissements de même portée partagent leur lecture ;
  - les lectures tournent sur leur propre contexte, avec un délai maximal, et non sur celui de la requête : un onglet fermé ne les gaspille pas ;
  - les erreurs ne sont pas mises en cache ;
  - **intervalle minimal de 10 s par groupe** (`MinRefresh`, ADR-20), compté depuis la fin de la lecture ;
  - plus de purge après 24 h : l'âge de chaque groupe est affiché.
- **Client GitLab** : une réponse est limitée à 64 Mo et un parcours à 1 000 pages ; au-delà, la synchro échoue (`gitlab_unreachable`).
- **En-têtes** : toutes les réponses de l'API portent `X-Content-Type-Options: nosniff` et `Cache-Control: no-store`.
- **nginx** :
  - il compresse le JSON en gzip ;
  - il attend le backend jusqu'à 300 s (`proxy_read_timeout`, pour une synchro à froid) ;
  - il échoue en 5 s si le backend est arrêté (`proxy_connect_timeout`).

## Pièges du GraphQL GitLab

La plupart viennent de Nornir, où ils ont été appris à la dure.

- **Widgets** : on les distingue par **`__typename`** (`WorkItemWidgetHierarchy`, `WorkItemWidgetIteration`, `WorkItemWidgetStartAndDueDate`, `WorkItemWidgetLinkedItems`…). Le champ `type` renvoie une valeur d'énumération (`HIERARCHY`…) : ne pas s'en servir pour discriminer.
- **`includeDescendants: true`** : `group.workItems` en a besoin pour inclure les issues des projets et des sous-groupes.
- **Pagination** : `after` doit valoir **`null`**, pas `""`, à la première page.
- **Erreurs GraphQL** : elles arrivent en **HTTP 200**, dans `errors[]`. Il faut les détecter dans le corps, puis les traduire en erreurs typées. Exemples : un champ Premium absent du schéma donne `ErrPremiumRequired` ; un groupe `null` donne `ErrGroupNotFound`.
- **Liens** : ils viennent de `WorkItemWidgetLinkedItems`, interrogé **trois fois avec des alias** et un filtre chacun : `blocks: linkedItems(filter: BLOCKS)`, `blockedBy: linkedItems(filter: BLOCKED_BY)` et `related: linkedItems(filter: RELATED)`.
  - Avec ces filtres, le champ `linkType` est inutile.
  - Les deux sens d'un même lien reviennent : `board.Build` les normalise.
  - Un élément lié peut se trouver **hors du groupe** : le lien est alors ignoré.
  - Au-delà de `first: 100` liens par élément et par sens, les liens sont coupés.
- **Éléments imbriqués** (`workItem` d'un lien, `parent` de la hiérarchie) : on garde **`onlyTypes`** sur leurs `widgets`, ou on n'y demande que `id`. Sans ce filtre, chaque élément lié ramène ses ~26 widgets.
- **Édition Premium** : les epics, les itérations, les cadences et les liens « bloque » sont des fonctions **Premium/Ultimate**. Sur une édition Free ou CE, le schéma n'a pas ces types ou ces champs : la requête entière échoue, au lieu de renvoyer une liste vide. Ce cas doit donner `premium_required`, pas une erreur générique.
- **Namespace** : la place d'un work item vient de `namespace { id fullPath }`.
  - Pour un **epic**, c'est le groupe (`gid://gitlab/Group/…`).
  - Pour une **issue**, c'est le **projet** (`gid://gitlab/Namespaces::ProjectNamespace/…`, `fullPath` = chemin du projet). Le groupe de l'issue est ce chemin moins son dernier segment.
  - Distinguez les deux cas par le GID, pas par la forme du chemin.
- **Sous-groupes** : `group.descendantGroups` les liste à tous les niveaux, avec pagination. Le groupe racine n'en fait pas partie : il faut l'ajouter.
- **Dates** : beaucoup d'éléments n'ont pas de dates (`startDate` / `dueDate` à `null`). C'est normal, voir les invariants. Une itération a toujours `startDate` et `dueDate`.
- **Itérations** : `iterationCadences(includeAncestorGroups: true)`, puis `iterations(iterationCadenceIds: […], includeAncestors: true, sort: CADENCE_AND_DUE_DATE_ASC)`. Une itération de cadence automatique peut ne pas avoir de titre : on affiche alors « Itération {sequence} ».
- **Groupes trop gros** : gitlab.com répond « Request timed out » sur `workItems` pour les groupes géants (`gitlab-org`). Validez sur un groupe public de taille moyenne.
- **Validation** : **tout changement de requête doit être validé sur un vrai GitLab**, avec le test `@live` ou un `curl` sur `https://gitlab.com/api/graphql`. Un mock local a déjà accepté un champ qui n'existait pas.
- **Schéma validé** sur gitlab.com le 2026-11-23, avec des `curl` anonymes et le test `live`, sur `gitlab-org/security-products` et `gitlab-org/ruby` :
  - **Énumérations** : le filtre des liens est de type `WorkItemRelatedLinkType` (`RELATED`, `BLOCKED_BY`, `BLOCKS`). `types: [EPIC, ISSUE]` est de type `IssueType`.
  - **Variable de cadence** : `$cadenceId` doit être typée **`IterationsCadenceID!`**.
  - **Itération en cours** : `iterations(timeframe: {start, end})` inclut ses bornes. On s'en sert pour trouver la cadence qui contient aujourd'hui. On n'utilise pas `state: current`, mis à jour par un job quotidien.
  - **`widgets(onlyTypes: [...])`** sur les work items : sans ce filtre, chaque élément ramène ~35 widgets.
  - **Complexité** : une page de 100 work items coûte environ 86, pour une limite anonyme de 200 ; comptez 3 à 8 s par page.
- **Introspection** : gitlab.com répond à **toute** introspection, même `__type(name:…)`, par le `__schema` complet (~8,8 Mo). Sauvegardez-le, puis cherchez dedans avec `jq`.
- **Dates d'itération** : elles sont typées `Time`, mais gitlab.com envoie « YYYY-MM-DD ». Le client ne garde que les 10 premiers caractères.
- **Titres** :
  - les itérations de cadence automatique ont `title: null` ;
  - les titres de cadence peuvent porter des espaces parasites (« AI Engineering ») : le client les supprime.
- **GID** :
  - cadence : `gid://gitlab/Iterations::Cadence/N` ;
  - itération : `gid://gitlab/Iteration/N`.
  - `GITLAB_CADENCE` accepte le titre (sans tenir compte de la casse), le GID complet ou son numéro.
- **`webUrl` des work items** : `…/-/work_items/N`, issues comprises. Pour les epics, c'est `/groups/…/-/work_items/N`.
- **Élément lié invisible** : son `workItem` peut être `null` quand le jeton ne le voit pas. Le lien est alors ignoré.
- **Erreurs Premium**, reconnues par `isPremiumError` :
  - sur un groupe Free de gitlab.com : « The resource that you are attempting to access does not exist or you don't have permission… », sur le chemin `["group","iterationCadences"]` ;
  - certains groupes renvoient simplement `nodes: []`, qui devient `ErrNoCadence` ;
  - sur CE ou sans licence : « Field 'X' doesn't exist on type 'Group' », « No such type WorkItemWidgetLinkedItems… », « Argument 'types' on Field 'workItems' has an invalid value », « IterationsCadenceID isn't a defined input type ».
  - Ces derniers messages ont été reconstitués à partir de vraies erreurs de gitlab.com : ils n'ont pas été observés sur une instance CE.
- **Limite de débit anonyme** de gitlab.com : quelques parcours complets suffisent à recevoir des HTTP 429 pendant environ 30 min. Pour des tests live répétés, utilisez un jeton. Une 429 devient `gitlab_unreachable` (message « rate limited », avec le `Retry-After`), sans nouvel essai.
- **Test live Go** : `GITLAB_URL=https://gitlab.com GITLAB_GROUP=gitlab-org/security-products go test -tags live -run Live -v ./internal/gitlab/`.

## Invariants métier

Ils sont dans `internal/board`. Tous sont couverts par des tests table par table : un changement de comportement s'accompagne d'un test.

1. **Identité** : un élément est identifié par le **GID de son work item** (`gid://gitlab/WorkItem/…`), partout : `Link.source/target`, `parentEpic`, `blocksEpics`, `criticalPath` et les clés côté frontend.
   - Les références `&18` / `#110` servent **à l'affichage seulement** : les IID d'issues se répètent d'un projet à l'autre.
2. **Issues affichées** (§5.1) : une issue est gardée si elle a au moins un lien `blocks` **vers un epic** du jeu de données.
   - Les autres sont seulement comptées (`ignoredIssues`).
   - Elles servent quand même au calcul des dates héritées des epics (invariant 4).
   - `blocksEpics` n'est jamais vide.
3. **Groupe d'un élément** (§5.3) :
   - epic : le groupe qui le porte ;
   - issue : le namespace de son projet moins le dernier segment.
4. **Rattachement d'un epic aux itérations** (§5.2). Les itérations sont triées par date de début ; `start` et `end` sont des index inclusifs.
   - **Début** : l'itération qui contient la date de début. Si la date tombe entre deux itérations, la **suivante**.
   - **Fin** : l'itération qui contient la date de fin. Si la date tombe entre deux itérations, la **précédente**.
   - **Sans dates** : le min et le max des itérations de ses issues enfants, toutes issues confondues (pas seulement celles affichées). L'epic porte alors `datesFromChildren`.
   - **Sinon** : `unplanned`, avec `start` et `end` à `null`.
   - Cas limites : voir l'ADR-19 dans `docs/decisions.md`.
5. **Itération en cours** : celle qui contient « aujourd'hui », selon une **horloge injectée** (`Build(raw, now)`) et `TZ`. `current` vaut -1 quand aucune itération ne contient la date. Les dates d'itération sont inclusives.
6. **Normalisation des liens** (§5.4) :
   - `blocks` et `is_blocked_by` donnent **un seul** lien orienté, bloquant → bloqué, sans doublon ;
   - `relates` est rangé par paire triée (`source < target`), sans doublon ;
   - `parent` va de l'epic parent vers l'issue ;
   - un lien dont une extrémité est hors du jeu de données, ou non affichée, est ignoré.
7. **Conflit** : un lien `blocks` dont le bloqueur est **ouvert** et finit dans une itération **strictement postérieure** à l'itération de début de l'élément bloqué.
   - Même itération : pas de conflit.
   - Bloqueur fermé : jamais de conflit.
   - Élément non planifié d'un côté ou de l'autre : pas de conflit.
   - La fin d'un epic est `end`, son début `start` ; pour une issue, c'est son itération.
8. **Chemin critique** : la plus longue chaîne de liens `blocks` entre éléments **ouverts**, dans le graphe orienté.
   - Les cycles sont détectés, cassés et signalés dans les logs.
   - À longueur égale, on garde la chaîne qui finit le plus tard, puis celle qui commence le plus tôt, puis la plus petite liste d'IDs.
   - `criticalPath` liste les IDs, du premier bloqueur au dernier bloqué ; il est vide sans lien « bloque ».
9. **Non planifié** : un epic sans dates ni enfant planifié, ou une issue affichée sans itération de la cadence. Le frontend les montre dans la colonne « Non planifié », en fin de board.
10. **Ordre déterministe** :
    - itérations par date de début ;
    - groupes par chemin, racine en tête ;
    - labels par titre ;
    - epics, issues et liens dans un ordre stable.
    
    **Ne jamais itérer sur une map pour produire une sortie** : la même donnée GitLab doit donner le même JSON.
11. **Une seule cadence** : les itérations d'autres cadences sont ignorées. Une issue dans une autre cadence est traitée comme sans itération.
12. **Fusion d'un rafraîchissement ciblé** (`MergeScope`, ADR-24) :
    - les éléments dont le groupe (invariant 3) est dans la portée sont remplacés par les éléments relus ; un élément relu remplace aussi sa copie hors portée (élément déplacé) ;
    - les liens des éléments hors portée qui pointent dans la portée sont retirés : le côté relu fait foi ;
    - un élément sorti de la portée disparaît jusqu'à la lecture de son nouveau groupe ;
    - `prev` n'est jamais modifié.

## Frontend

- **Dépendances** : aucune dépendance d'exécution autre que `react` et `react-dom`. Pas de routeur, pas de bibliothèque d'état ou de données : `fetch` et des hooks maison suffisent. N'ajoutez **aucune** dépendance, même de développement, sans décision consignée dans `docs/decisions.md`.
- **Couleurs** :
  - Les jetons (noms de `docs/style.md` §2) sont définis **uniquement** dans `src/styles/theme.css`, avec leurs valeurs claires et sombres (`:root[data-theme='dark']`). `board.css` et `app.css` ne font que les utiliser.
  - **Aucune couleur en dur** dans les composants ni dans le TypeScript. Un composant expose ses états en attributs `data-*` (`data-kind`, `data-closed`, `data-conflict`, `data-lane-color`…), que le CSS traduit en jetons.
  - Seule exception : la couleur d'un label GitLab, qui est une donnée. Elle passe par la propriété `--label-color` dans un `style` inline.
- **Couleurs des couloirs** : une palette fixe de jetons de couleurs système Apple (`--lane-indigo`, `--lane-blue`, `--lane-cyan`, `--lane-mint`, `--lane-yellow`, `--lane-orange`, `--lane-pink`, `--lane-brown`). Le CSS les expose par `[data-lane-color='x'] { --lane: … }`.
  - Pas de rouge : il est réservé aux conflits.
  - Pas de vert, de violet ni de teal : ils sont pris par d'autres sens (violet = epic, teal = issue).
- **Textes** : tous les textes de l'interface sont en français et vivent dans `src/strings/` :
  - `ui.ts` → `UI`, `board.ts` → `BOARD`, `app.ts` → `APP`, tous réexportés par `index.ts` ;
  - format `export const X = { … } as const` ;
  - des fonctions pour les pluriels et les textes paramétrés.
  
  Aucune chaîne visible en dur dans un composant.
- **Logique** :
  - La logique pure va dans `src/board/` (couloirs, fenêtre, format, mise en page, liens, statistiques), sans React ni DOM, avec ses tests `*.test.ts`.
  - Les composants ne calculent pas la mise en page : ils lisent la `BoardView` de `computeBoardView`, mémorisée.
- **CSS** : un fichier par zone.
  - `theme.css` : jetons et contrôles génériques (`.button`, `.menu`, `.pill`…) ;
  - `board.css` : le canevas ;
  - `app.css` : la coquille.
  
  `main.tsx` importe les trois. Pas de framework CSS ni de police externe : l'application marche hors ligne.
- **Préférences** (`localStorage`, lues avec validation et try/catch partout) :
  - `gleipnir.appearance`, `gleipnir.lanes` (validés contre les groupes), `gleipnir.window`, `gleipnir.sidebar` ;
  - le reste est de l'état de session : options d'affichage, couloirs repliés, recherche, sélection.
- **Thème** :
  - Le script inline de `index.html` applique l'apparence **avant le premier rendu**, pour éviter un flash. Gardez-le synchronisé avec `resolveScheme` (`src/hooks/useAppearance.ts`).
  - **Toute modification de ce script change son hash** : recalculez-le et mettez à jour la CSP de `frontend/nginx.conf.template` (voir Sécurité), sinon le script est bloqué en production.
- **TypeScript** : mode `strict`, `import type` pour les types (`verbatimModuleSyntax`).
- **Accessibilité** :
  - tout élément cliquable est un vrai `<button>`, avec `aria-pressed` pour la sélection ;
  - les boutons-icônes ont un `aria-label` ;
  - le contrôle segmenté utilise `role="radio"` ;
  - l'anneau de focus est visible ;
  - Échap ferme les feuilles, les menus et l'inspecteur ;
  - le contraste est d'au moins 4,5:1 ;
  - les types se distinguent par la forme, pas seulement par la couleur ;
  - `prefers-reduced-motion` est respecté.
  
  Les tests sélectionnent par rôle et par libellé.

## Tests

- **Couverture** (ADR-23) : au moins **90 % des lignes et 90 % des fonctions**, côté Go comme côté frontend.
  - Testez les **cas limites** : bornes, valeurs vides ou `null`, doublons, erreurs, ordre des égalités.
  - Côté frontend, les seuils sont dans `vitest.config.ts` : `npm run test:coverage` échoue en dessous.
  - Côté Go, `go tool cover -func` donne le total. Une fonction couverte est une fonction à plus de 0 %. Seul `main` reste à 0 %.
- **Go** : tests table par table.
  - Les règles métier sont dans `internal/board` : rattachement, liens, conflits, chemin critique avec cycle, non planifiés, ordre.
  - Le cache se teste avec `-race`.
  - Le client GitLab et les handlers se testent face à un **faux GitLab `httptest`**.
  - L'horloge est toujours injectée.
  - `cmd/server` se teste par `run` et `serve`, sur un port libre. Un test n'envoie SIGTERM au processus qu'**après** que `serve` écoute (`waitHealthy`) : sinon le signal tue le binaire de test.
- **Vitest** (`vitest.config.ts`, setup `src/test/setup.ts`) :
  - `src/**/*.test.ts` : la logique pure, en node ;
  - `src/**/*.test.tsx` : les composants avec Testing Library. Leur **première ligne** est `// @vitest-environment jsdom`.
  - **Pièges** :
    - avec `vi.useFakeTimers({ toFake: ['setInterval', …] })`, le `waitFor` de Testing Library ne sonde plus, et `vi.waitFor` avance l'horloge factice à chaque essai. Videz plutôt les promesses avec `await act(async () => {})` ;
    - React lit un `timeStamp` de 0 comme absent et le remplace par `Date.now()` : un événement simulé part de 1 ;
    - jsdom n'a pas de `PointerEvent` : un `MouseEvent` auquel on ajoute `pointerId` et `pointerType` le remplace ;
    - `getByTitle` et `getByText` normalisent les espaces : pour un texte qui commence ou finit par une espace, lisez l'attribut directement.
- **Playwright** (`frontend/e2e/`, `playwright.config.ts`) :
  - `*.spec.ts` tournent contre le **backend réel en mode démo** ; `webServer` démarre Go (8081) et Vite (5174), ou les ports donnés par `E2E_API_PORT` / `E2E_WEB_PORT` (voir ADR-22).
  - En développement, React `StrictMode` lance puis annule une première requête `/api/board` : un mock d'erreur ne doit pas compter les appels, mais rester actif jusqu'à ce que le test le retire.
  - Vite surveille les fichiers par polling (le montage WSL du devcontainer rate les événements inotify). Un état d'erreur se simule avec `page.route` (401, 502).
  - `*.live.spec.ts` sont marqués `@live` : ils tournent contre un vrai GitLab via `BASE_URL`, et ne supposent rien du contenu du groupe.
  - Locale `fr-FR`, fuseau `Europe/Paris`.
  - Les tests utilisent les rôles et les libellés, pas les classes CSS, sauf pour mesurer la géométrie.
- **Tout nouveau test Playwright est gardé dans le projet**, jamais jeté.

## Déploiement (Docker)

- **Image backend** :
  - build `golang:1.22-alpine` (`CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`), puis `alpine:3.20` avec `ca-certificates` et `tzdata` ;
  - `USER 10001:10001` est **numérique** exprès : Kubernetes peut ainsi vérifier `runAsNonRoot` ;
  - `HEALTHCHECK` avec `wget` sur `/api/health`.
  
  `go.mod` n'a pas de dépendance, donc pas de `go.sum` : ne pas en copier.
- **Image frontend** :
  - build `node:22-alpine` (`npm ci`, `npm run build`), puis `nginxinc/nginx-unprivileged:alpine` (uid 101), qui **écoute sur 8080** ;
  - `nginx.conf.template` est copié dans `/etc/nginx/templates/`, et l'entrypoint de l'image y applique `envsubst` au démarrage. Seules les variables définies sont substituées (`GLEIPNIR_BACKEND_URL`), donc `$uri` et `$host` restent intacts.
  
  **N'ajoutez pas de variable d'environnement qui porte le nom d'une variable nginx.**
- **nginx** :
  - repli SPA vers `index.html` ;
  - `/assets/` (noms hachés par Vite) en cache long, `index.html` en `no-cache` ;
  - gzip sur JSON, JS, CSS et SVG.
  - Les en-têtes de sécurité sont posés au niveau `server` : n'ajoutez **pas** d'`add_header` dans une `location`, sinon elle perdrait ces en-têtes. Pour le cache, utilisez `expires`.
- **Compose** : le frontend attend que le backend soit `healthy` (`depends_on: condition: service_healthy`).

## Sécurité

- **Jeton** : en lecture seule (`read_api`), **côté serveur uniquement**.
  - Il n'est jamais envoyé au navigateur, jamais renvoyé par l'API, **jamais journalisé** : la config se journalise avec `tokenSet: bool`.
  - Il n'est jamais commité : `.env` est dans `.gitignore`.
- **Visibilité** : un seul jeton pour tous. Chaque utilisateur voit ce que le jeton voit, ni plus ni moins.
- **Contenu GitLab** : il n'est **jamais interprété comme du HTML**.
  - Pas de `dangerouslySetInnerHTML`, pas d'`innerHTML`.
  - Titres, labels et noms passent par le texte React.
  - Les URL ouvertes viennent de `webUrl` et s'ouvrent avec `rel="noopener noreferrer"`.
  - La couleur d'un label n'est posée que dans `--label-color`.
- **CSP** (`frontend/nginx.conf.template`) :
  - `default-src 'self'` ;
  - `script-src 'self' 'sha256-…'` : le hash du **seul** script inline, celui du thème de `index.html` ;
  - `style-src 'self' 'unsafe-inline'` : React pose des attributs `style` ;
  - `img-src 'self' data:` : le favicon est en `data:` ;
  - `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
  
  Les autres en-têtes sont `X-Content-Type-Options: nosniff` et `Referrer-Policy: same-origin`.
- **Recalculer le hash** après toute modification du script inline (espaces compris) :

  ```bash
  cd frontend && python3 -c "import re,hashlib,base64;s=re.search(r'<script>(.*?)</script>',open('index.html').read(),re.S).group(1);print(base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())"
  ```

  Vérifiez ensuite dans `dist/index.html` que Vite a laissé le script intact. N'ajoutez pas d'autre script inline.

## Règles de travail

### Langue

- **Code, identifiants et commentaires** : en anglais. Les commentaires sont courts et expliquent le *pourquoi*.
- **Interface** : en français, dans `src/strings/`.
- **Documentation** : en français (`README.md`, `AGENTS.md`, `docs/`).
- **Titres de commit** : en anglais.
- Les sélecteurs Playwright reprennent les textes de l'interface : mettez à jour les tests quand un texte change.

### Commits

- Format **[Conventional Commits](https://www.conventionalcommits.org/)** : `type(scope): description`, à l'impératif.
  - **Le message est le titre seul** : pas de corps, pas de pied de page ni de trailer (`Co-Authored-By`, `Signed-off-by`…).
  - Le titre est compréhensible par quelqu'un qui ne connaît pas le projet.
  - Types : `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`.
  - Scopes : `backend`, `frontend`, `e2e`, `docker`, `docs`.
  - Exemples :
    - `feat(frontend): dim unrelated items when one is selected`
    - `fix(backend): pick the next iteration when an epic starts between two`
    - `test(e2e): check the window recenters on an off-window dependency`
    - `docs: document the GITLAB_CADENCE variable`
- Un commit = un changement cohérent.
- Ne jamais committer `.env`, `node_modules/`, `dist/`, ni les rapports Playwright.

### Avant de committer

1. `cd backend && gofmt -l . && go vet ./... && go test -race ./...`. `gofmt -l` ne doit rien lister. La couverture reste ≥ 90 %.
2. `cd frontend && npm run build && npm run test:coverage && npm run test:e2e`.
3. Si le client GitLab ou une requête GraphQL a changé : `npm run test:e2e:live` contre un vrai GitLab.
4. Si un Dockerfile, le compose ou `nginx.conf.template` a changé : `docker compose config`, puis `docker compose up -d --build` et un contrôle de `/api/health` et de la page (CSP : aucune erreur dans la console).

### Documentation

- **`README.md`** : à mettre à jour pour tout changement visible de l'utilisateur (configuration, commandes, comportement).
- **Ce fichier** : à mettre à jour à chaque nouvelle convention, nouveau piège, invariant, commande ou limite connue, ou quand quelque chose ici devient faux.
- **`docs/decisions.md`** : un nouvel ADR pour toute décision d'architecture ou tout écart à la spec.
- Ces mises à jour vont **dans le même commit** que le changement qu'elles décrivent.

## Limites connues

- **Une seule cadence** par board, choisie par `GITLAB_CADENCE` ou celle de l'itération en cours. Les éléments planifiés dans une autre cadence apparaissent sans itération.
- **Un seul jeton serveur**, sans OAuth : tout le monde voit ce que le jeton voit. Les permissions GitLab individuelles ne sont pas appliquées.
- **Pas de synchro incrémentale** (`updatedAfter`) : la synchro de fond relit tout. Le bouton Synchroniser ne relit que les sous-arbres des couloirs actifs, mais avec tous les couloirs actifs, il relit presque tout.
- **Données d'âges différents** : après un rafraîchissement ciblé, les autres groupes gardent leurs données jusqu'à la synchro complète suivante. Un élément déplacé hors du sous-arbre relu disparaît jusque-là.
- **Liens** : plus de 100 par élément et par sens sont coupés (`linkedItems(first: 100)`).
- **Pas de chart Helm** en v1 : uniquement Docker et compose. Le cache est en mémoire, donc une instance par backend.
- **Couloirs, fenêtre et panneau latéral** sont mémorisés **par navigateur** (`localStorage`) : pas de vues partagées ni de préférences côté serveur.
- **Lecture seule** : on ne peut ni créer ni supprimer un lien depuis le board.
