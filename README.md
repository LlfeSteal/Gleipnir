# Gleipnir

Board des **dépendances** GitLab par **itération**.

Les boards natifs de GitLab ne montrent pas les dépendances entre epics et issues dans le temps. Gleipnir les affiche sur une frise d'itérations, une colonne par itération, avec des couloirs configurables. Le but est de repérer :

- les chaînes de blocage ;
- les risques de retard ;
- les dépendances entre équipes.

Gleipnir ne suit **pas l'avancement** : il n'affiche ni pourcentage, ni poids, ni compteur d'éléments fermés.

**Pour qui ?**

- Les product managers et responsables de programme qui coordonnent plusieurs équipes ou groupes.
- Les tech leads qui veulent savoir ce qui bloque leurs epics, et ce que leurs epics bloquent.

**Ce que l'application montre :**

- les epics en barres, de leur itération de début à leur itération de fin ;
- les issues qui bloquent au moins un epic, en cartes dans la colonne de leur itération ;
- les liens « bloque », « lié à » et « epic parent → issue » ;
- les **conflits de dates** : un élément bloqué qui commence avant la fin de son bloqueur ;
- le **chemin critique** : la plus longue chaîne de blocages ouverts ;
- une colonne **Non planifié**, pour ce qui n'a ni dates ni itération.

L'application est en **lecture seule** : elle ne modifie jamais GitLab.

- **Backend** : Go, bibliothèque standard uniquement. Il lit l'API GraphQL de GitLab avec un jeton serveur, applique les règles métier et garde le résultat en cache mémoire.
- **Frontend** : React et Vite, sans dépendance d'exécution, servi par nginx.

## Prérequis

- Une instance GitLab en édition **Premium ou Ultimate** : les epics, les itérations et les liens « bloque » en dépendent.
- Un jeton d'accès GitLab avec la portée **`read_api`**. Un jeton de groupe ou de compte de service convient.
- Docker avec Compose v2, inclus dans le devcontainer du projet.
- Pour développer hors Docker : Go 1.22+ et Node 22+.

## Démarrage rapide (Docker)

### Avec un vrai GitLab

```bash
cp .env.example .env        # puis renseigner GITLAB_URL, GITLAB_TOKEN et GITLAB_GROUP
docker compose up -d --build
```

Ouvrir http://localhost. Le port se change avec `GLEIPNIR_PORT`.

Après une modification de `.env` :

```bash
docker compose up -d --force-recreate backend && docker compose up -d
```

La première synchronisation d'un grand groupe peut prendre du temps. Ensuite, le backend relit tout le groupe en arrière-plan toutes les `CACHE_TTL`, et sert le board en cache en attendant.

Le bouton **Synchroniser** ne relit que les groupes des **couloirs actifs**, avec leurs sous-groupes : désactivez les couloirs inutiles pour une synchro plus rapide. Les autres groupes gardent leurs données jusqu'à la prochaine synchro complète. « Mis à jour il y a… » indique l'âge du plus ancien groupe affiché.

### En mode démo, sans GitLab

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

Aucun fichier `.env` n'est nécessaire. Un **faux GitLab** (`gitlab-mock/`) sert le jeu d'exemple de la maquette au backend, et « Itération 15 » est l'itération en cours.

- Le backend ne sait pas qu'il parle à un faux GitLab : il le lit comme le vrai, par `GITLAB_URL`.
- Le faux GitLab n'est jamais construit ni démarré sans `docker-compose.demo.yml`. Il ne publie aucun port sur l'hôte.
- Le faux GitLab vérifie le jeton comme un vrai : il répond 401 à tout autre jeton que celui de la démo. L'overlay donne la même valeur aux deux services, `DEMO-JETON-TEST` par défaut, ou `GLEIPNIR_DEMO_TOKEN` si elle est définie.
- Ce jeton de démo remplace celui du `.env` : même avec un `.env` réel, votre jeton n'est pas envoyé au faux GitLab.
- Le backend avertit que le jeton circule en clair (`http://gitlab-mock:8080`) : c'est attendu, il est factice.

Pour revenir au vrai GitLab : `docker compose up -d --build`, sans l'overlay. `docker compose down --remove-orphans` arrête aussi le faux GitLab.

### Sur un vrai GitLab rempli avec le jeu de démo

Le seeder `gitlab-mock/cmd/seed` écrit le jeu de démo dans une instance **Premium ou Ultimate**, sous un groupe **existant**. Il faut un jeton à portée `api` (écriture), distinct du jeton `read_api` de Gleipnir. Avec un jeton admin, il crée aussi les six utilisateurs `demo-*` ; sinon, les éléments restent sans assigné.

```bash
cd gitlab-mock
export SEED_URL=https://gitlab.interne SEED_GROUP=demo/gleipnir
read -rs SEED_TOKEN && export SEED_TOKEN     # le jeton ne passe ni par un argument ni par l'historique
go run ./cmd/seed            # dry-run : lit et affiche ce qu'il ferait
go run ./cmd/seed -apply     # écrit
```

- **Idempotent** : relancé, il ne crée que ce qui manque, et recale les itérations et les dates d'epic autour d'aujourd'hui. Il ne supprime jamais rien.
- `-cadence=auto` crée une cadence automatique, si l'instance refuse les cadences manuelles.
- Il refuse `http://` hors `localhost`, sauf avec `-insecure-http`.

Pointez ensuite Gleipnir sur ce groupe : `GITLAB_URL` et `GITLAB_GROUP=demo/gleipnir` dans `.env`, avec un jeton `read_api`.

**Pas encore validé sur une vraie instance** : ses requêtes ont été vérifiées contre le schéma de gitlab.com et un faux GitLab à état (ADR-27).

## Développement natif

Deux terminaux.

**Backend**, sur http://localhost:8080 :

```bash
cd backend && (set -a; . ../.env; set +a; go run ./cmd/server)    # avec le .env de la racine
```

En mode démo, lancez d'abord le faux GitLab dans un troisième terminal :

```bash
cd gitlab-mock && PORT=8082 GITLAB_MOCK_TOKEN=DEMO-JETON-TEST go run .
cd backend && GITLAB_URL=http://localhost:8082 GITLAB_GROUP=plateforme/atlas GITLAB_TOKEN=DEMO-JETON-TEST go run ./cmd/server
```

Le backend lit uniquement les variables d'environnement : il ne charge pas `.env` lui-même.

**Frontend**, sur http://localhost:5173 :

```bash
cd frontend && npm install && npm run dev
```

Le serveur Vite proxifie `/api` vers `GLEIPNIR_API_URL`, par défaut `http://localhost:8080`. Exemple : `GLEIPNIR_API_URL=http://localhost:8081 npm run dev`.

## Configuration

Toutes les variables sont lues par le backend. Avec Docker, elles viennent de `.env` ; le modèle commenté est `.env.example`.

| Variable | Défaut | Rôle |
|---|---|---|
| `GITLAB_URL` | `https://gitlab.com` | Instance GitLab. |
| `GITLAB_TOKEN` | — | Jeton `read_api`. Il reste côté serveur et n'est jamais journalisé. |
| `GITLAB_GROUP` | — | Chemin complet du groupe racine. **Obligatoire.** |
| `GITLAB_CADENCE` | la cadence de l'itération en cours | Cadence d'itérations affichée, par titre ou par id. |
| `CACHE_TTL` | `5m` | Durée Go entre la fin d'une synchro complète et le début de la suivante. Le board en cache reste servi pendant la synchro. |
| `TZ` | `Europe/Paris` (compose) | Fuseau horaire. Il décide de l'itération en cours. |
| `PORT` | `8080` | Port du backend. Ne pas le changer avec Docker : nginx proxifie vers `backend:8080`. |
| `GLEIPNIR_PORT` | `80` | Port de l'hôte où compose publie l'interface. |
| `GLEIPNIR_BACKEND_URL` | `http://backend:8080` | Image frontend : adresse du backend vers laquelle nginx proxifie `/api/`. |

Tous les utilisateurs voient ce que le jeton voit. Choisissez donc un compte dont les droits conviennent à tous.

## Tests

```bash
# Backend
cd backend && gofmt -l . && go vet ./... && go test -race ./...

# Couverture du backend (au moins 90 % des lignes et des fonctions)
cd backend && go test -coverprofile=cover.out ./... && go tool cover -func=cover.out | tail -1

# Frontend : build (tsc + vite) puis tests unitaires Vitest (logique en node, composants en jsdom)
cd frontend && npm run build && npm test
cd frontend && npm run test:coverage   # échoue sous 90 % des lignes ou des fonctions ; rapport HTML dans coverage/

# Faux GitLab de la démo
cd gitlab-mock && gofmt -l . && go vet ./... && go test -race ./...

# Bout en bout (Playwright) contre le faux GitLab
cd frontend && npx playwright install chromium     # une fois par conteneur
cd frontend && npm run test:e2e
```

`npm run test:e2e` démarre tout seul les serveurs dont il a besoin :

- le faux GitLab sur le port 8082 ;
- le backend, qui le lit, sur le port 8081 ;
- Vite sur le port 5174.

Les tests e2e passent donc par le vrai client GitLab du backend : requêtes, pagination et conversion.

Il ne demande ni GitLab ni Docker.

Les tests marqués **`@live`** tournent contre un vrai GitLab, à travers une pile déjà lancée :

```bash
docker compose up -d --build                       # avec un vrai .env
cd frontend && BASE_URL=http://localhost npm run test:e2e:live
```

Lancez-les dès qu'une requête GraphQL change.

## Arborescence

```
backend/                 API Go (module gleipnir, bibliothèque standard uniquement)
  cmd/server/            point d'entrée : configuration, routes, arrêt propre
  internal/config/       variables d'environnement
  internal/gitlab/       client GraphQL GitLab (lecture seule)
  internal/board/        modèle JSON, règles métier
  internal/cache/        board en mémoire : synchro complète périodique, rafraîchissement ciblé
  internal/api/          handlers HTTP
gitlab-mock/             faux GitLab de la démo et des tests e2e (module Go séparé, jamais déployé)
frontend/                application React + Vite + TypeScript
  src/api/               client HTTP et types de l'API
  src/board/             logique pure du board (couloirs, fenêtre, mise en page, liens), testée
  src/components/        interface : barre d'outils, panneau latéral, board, inspecteur, réglages
  src/strings/           tous les textes de l'interface, en français
  src/styles/            theme.css (jetons), board.css, app.css
  e2e/                   tests Playwright
  nginx.conf.template    configuration nginx de l'image
docs/                    spécifications, maquette, charte, décisions
docker-compose.yml       pile locale : backend + frontend
docker-compose.demo.yml  overlay de démo : ajoute le faux GitLab et y branche le backend
```

## Documentation

- [Spécifications](docs/specifications.md) : le besoin fonctionnel. L'application y est appelée « Trame », son nom de travail.
- [Maquette](docs/mockup.html) : maquette interactive, à ouvrir dans un navigateur.
- [Charte graphique](docs/style.md) : la charte, transposée des Human Interface Guidelines d'Apple.
- [Décisions](docs/decisions.md) : les choix d'architecture et les écarts assumés par rapport à la spec.
- [AGENTS.md](AGENTS.md) : le guide de travail pour les agents et les développeurs. Il couvre les conventions, les pièges GitLab et les invariants métier.
