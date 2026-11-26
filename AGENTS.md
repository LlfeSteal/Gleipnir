# AGENTS.md — Gleipnir

This document is the reference for any agent or developer working in this repository.

- Read it in full before changing the code.
- **Keep it up to date** (see "Working rules").
- It is written in English, like the code (ADR-33). The user documentation (`README.md`, `docs/`) and the UI are in French: UI texts quoted here stay in French, in quotes, since they are what the tests match.

## The project

**Gleipnir** shows the **dependencies** between the epics and issues of a GitLab group, on a timeline of **iterations**. It is read only.

- The functional spec is `docs/specifications.md`. The app goes by its working name there, « Trame ».
- The reference mockup is `docs/mockup.html`.
- The design guide is `docs/style.md`, adapted from the Apple HIG.
- Architecture decisions are in `docs/decisions.md`.

**Stack.**

- **Backend**: Go 1.27, **standard library only** (module `gleipnir`, `go.mod` without dependencies). The devcontainer (`mcr.microsoft.com/devcontainers/go:1.27-bookworm`) sets `GOTOOLCHAIN=local`: in an older container, `go` refuses the modules (`go.mod requires go >= 1.27`). Rebuild the container, or run with `GOTOOLCHAIN=go1.27.4`.
  - The backend reads GitLab's GraphQL API with a server-side `read_api` token.
  - It applies the business rules in `internal/board`.
  - It keeps the encoded board in memory: a full sync at startup then every `CACHE_TTL`, and targeted refreshes of the groups of the active lanes (ADR-24).
  - It has **no demo mode**: the demo and the e2e tests point it at a fake GitLab (ADR-25).
- **Fake GitLab** (`gitlab-mock/`): a separate Go module, standard library only. It answers only Gleipnir's GraphQL queries, with the demo dataset. It imports nothing from `backend/` and is never deployed.
- **Frontend**: React 19, TypeScript 6 and Vite 8, **with no runtime dependency** other than `react` and `react-dom`.
  - The board is drawn in HTML/CSS.
  - The links are in a single SVG.
- **Deployment**: `docker compose`, with two images.
  - The backend runs on Alpine, as a numeric non-root user.
  - The frontend runs on nginx-unprivileged: it serves the SPA and proxies `/api/`.
- **Sibling projects** with the same stack and design guide:
  - `../Nornir`: Go, GitLab GraphQL, React and `theme.css`;
  - `../Odin`: React 19 without dependencies.
  
  Before rewriting a building block, check whether it already exists there.

## Layout

```
backend/
  cmd/server/main.go          serve (signals, slog, exit code) → run(ctx, getenv, logger): config, server, graceful shutdown
  internal/config/            reads and validates the environment variables
  internal/gitlab/client.go   doGraphQL + paginate (from Nornir), typed errors (401 / 404 / Premium / cadence)
  internal/gitlab/queries.go  descendantGroups, iterationCadences, iterations, workItems
  internal/gitlab/structs.go  GraphQL deserialization structs
  internal/board/model.go     JSON model served by GET /api/board (the contract with the frontend)
  internal/board/raw.go       input of board.Build: the data as GitLab gives it
  internal/board/build.go     raw → Board: active cadences, columns, iteration placement, links, unplanned
  internal/board/merge.go     merges a re-read subtree into the data (MergeScope), scope (NormalizeScope)
  internal/board/analysis.go  conflicts and critical path
  internal/board/demo_fixture_test.go  the mockup dataset as a board.Raw: fixture of the Go tests only
  internal/cache/cache.go     board in memory: periodic full sync (Run), targeted refresh (Refresh),
                              a board per choice of cadences (view)
  internal/api/               handlers GET /api/health and GET /api/board
gitlab-mock/                  fake GitLab (module gitlab-mock): demo and e2e, never deployed
  main.go                     PORT, PAGE_SIZE (10 by default, to exercise pagination), graceful shutdown
  graphql.go                  POST /api/graphql: dispatch on the operation name, pagination, GET /-/health
  dataset/dataset.go          THE demo dataset, semantic and storable in a real GitLab (names without "&", demo-* usernames),
                              with a second cadence in the data subgroup (Team, ADR-38)
  render.go                   renders the dataset as GitLab GraphQL nodes (GIDs, widgets, one-sided links, out-of-group link)
  cmd/seed/                   seeder: writes the same dataset into a REAL Premium/Ultimate GitLab (ADR-27)
  Dockerfile                  demo image (alpine, uid 10001)
frontend/
  index.html                  inline theme script (before the first render) — its hash is in the CSP
  src/main.tsx, App.tsx       entry point, app shell (state, preferences)
  src/api/types.ts            TypeScript mirror of model.go
  src/api/client.ts           fetch + ApiError
  src/board/                  pure logic: types, lanes (lane filters, ADR-34), cadences (ADR-38), window,
                              format, layout, search, links, stats
  src/components/ui/          primitives: Icons, Popover / MenuItem, SearchField, Switch,
                              Checkbox, SelectList, SegmentedControl, StateViews, AppearanceMenu, Sheet
  src/components/board/       the canvas: BoardCanvas, ItemGlyph, LinkSwatch…
  src/components/             Toolbar, WindowControl, Sidebar (lanes, filters),
                              LaneSettingsSheet (« Configurer les couloirs »), Inspector, SummaryLine
  src/hooks/                  useAppearance, usePreferences (useStoredState), useBoard
  src/strings/                UI texts (ui.ts, board.ts, app.ts, re-exported by index.ts)
  src/styles/                 theme.css (tokens + controls), board.css (canvas), app.css (shell)
  src/test/                   Vitest setup (jsdom), media.ts (matchMedia)
  e2e/                        Playwright tests (*.spec.ts: fake GitLab; *.live.spec.ts: @live)
  nginx.conf.template         the image's nginx: SPA, gzip, /api proxy, caching, security headers
docs/                         specifications.md, mockup.html, style.md, decisions.md (in French)
docker-compose.yml            compose project "gleipnir": backend + frontend
docker-compose.demo.yml       demo overlay: gitlab-mock service, backend wired to it with the demo token
.env / .env.example           configuration (.env is never committed)
README.md                     user documentation (in French)
CLAUDE.md                     imports this file
```

## Commands

```bash
# Backend
cd backend && gofmt -l . && go vet ./... && go test -race ./...
cd backend && go test -coverprofile=cover.out ./... && go tool cover -func=cover.out | tail -1   # coverage (≥ 90 %)
cd gitlab-mock && PORT=8082 GITLAB_MOCK_TOKEN=DEMO-JETON-TEST go run .   # fake GitLab, then:
cd backend && GITLAB_URL=http://localhost:8082 GITLAB_GROUP=plateforme/atlas GITLAB_TOKEN=DEMO-JETON-TEST go run ./cmd/server   # demo, http://localhost:8080
cd backend && (set -a; . ../.env; set +a; go run ./cmd/server)     # real GitLab: the backend does not read .env itself

# Seeder: fill a real GitLab (Premium/Ultimate) with the demo dataset — dry run by default
cd gitlab-mock && SEED_URL=https://gitlab.interne SEED_TOKEN=… SEED_GROUP=demo/gleipnir go run ./cmd/seed          # reads and prints the plan
cd gitlab-mock && SEED_URL=https://gitlab.interne SEED_TOKEN=… SEED_GROUP=demo/gleipnir go run ./cmd/seed -apply   # writes (idempotent)

# Fake GitLab
cd gitlab-mock && gofmt -l . && go vet ./... && go test -race ./...
cd gitlab-mock && go test -coverprofile=cover.out ./... && go tool cover -func=cover.out | tail -1   # coverage (≥ 90 %)

# Frontend
cd frontend && npm run build          # tsc -b + vite build
cd frontend && npm test               # Vitest: logic (node) and components (jsdom)
cd frontend && npm run test:coverage  # same, with coverage: fails below 90 % of lines or functions
cd frontend && npx vitest run src/board/window.test.ts   # one file
cd frontend && npm run dev            # http://localhost:5173, proxy /api → GLEIPNIR_API_URL (default localhost:8080)

# End to end (Playwright)
cd frontend && npx playwright install chromium   # once per container
cd frontend && npm run test:e2e       # everything but @live: starts the fake GitLab (8082), the backend (8081) and Vite (5174)
cd frontend && E2E_MOCK_PORT=8094 E2E_API_PORT=8093 E2E_WEB_PORT=5193 npm run test:e2e   # on other ports, alongside another suite
cd frontend && npm run test:e2e:gitlab-like   # the same suite, fake GitLab numbered like a GitLab filled by the seeder (&1 everywhere), root demo/gleipnir
cd frontend && BASE_URL=http://localhost npm run test:e2e        # the demo suite on a docker stack wired to a GitLab filled by the seeder
cd frontend && BASE_URL=http://localhost npm run test:e2e:live   # @live, against the docker stack on a real GitLab

# Docker
docker compose up -d --build                     # real GitLab, .env required — http://localhost
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build   # demo (fake GitLab), no .env
docker compose -f docker-compose.yml -f docker-compose.demo.yml config          # validates the overlay
docker compose config                            # validates the compose file
docker compose down --remove-orphans            # --remove-orphans: also stops a demo's fake GitLab
```

## Configuration

Every variable is read by the backend, through `internal/config`.

| Variable | Role |
|---|---|
| `GITLAB_URL` | GitLab instance. Default: `https://gitlab.com`. |
| `GITLAB_TOKEN` | `read_api` token. Never logged nor returned by the API. The backend starts without a token (warning), but GitLab answers 401 on a private group. With a token, a `GITLAB_URL` in `http://` outside loopback gives a warning: the token travels in clear. |
| `GITLAB_GROUP` | Full path of the root group. **Required**: without it, the backend refuses to start. |
| `GITLAB_CADENCE` | Default active cadence (ADR-38), by title or by id. Unset: every cadence holding the current iteration. Users pick other ones in the window pop-up. |
| `PORT` | Backend port, 8080 by default. Do not change it under compose: nginx proxies to `backend:8080` and the healthcheck targets 8080. |
| `CACHE_TTL` | Go duration, `5m` by default: the delay between the end of a full sync and the start of the next. |
| `GLEIPNIR_DEMO` | **Removed** (ADR-25). If still set: a warning, and without `GITLAB_GROUP`, the startup error points to `docker-compose.demo.yml`. |
| `TZ` | Time zone. It decides the current iteration. Compose sets it to `Europe/Paris` by default and the image ships `tzdata`. |
| `GLEIPNIR_PORT` | Compose only: the host port publishing the frontend, 80 by default. |
| `GLEIPNIR_DEMO_TOKEN` | Demo overlay only: the token sent by the backend and required by the fake GitLab, `DEMO-JETON-TEST` by default. |
| `GITLAB_MOCK_TOKEN` | Fake GitLab only, **required**: the token it expects (`Authorization: Bearer` or `PRIVATE-TOKEN`). Any other token gets a 401, as on GitLab. |
| `GLEIPNIR_BACKEND_URL` | Frontend image only: target of the `/api/` proxy, `http://backend:8080` by default. |

**Compose.**

- `env_file` is **optional** (`required: false`).
- `TZ` goes through `environment`, interpolated from the shell then from `.env`: the shell wins.
- **Demo overlay** (`docker-compose.demo.yml`): it adds `gitlab-mock` (no published port) and forces on the backend `GITLAB_URL=http://gitlab-mock:8080`, `GITLAB_GROUP=plateforme/atlas`, `GITLAB_CADENCE=""` and **`GITLAB_TOKEN=${GLEIPNIR_DEMO_TOKEN:-DEMO-JETON-TEST}`**, the same value as the fake GitLab's `GITLAB_MOCK_TOKEN`. `environment` wins over `env_file`: the `.env` token never reaches the fake GitLab. The backend warns that the token travels over `http://`: expected, it is a dummy.
- After changing `.env`: `docker compose up -d --force-recreate backend`, then `docker compose up -d`.

## Backend API

- `GET /api/health` → `{"status":"ok","gitlabUrl":"…","group":"…"}`. Never a token. The Docker healthcheck uses it.
- `GET /api/board` → the `Board` of `internal/board/model.go`, already normalized. The frontend only does the layout.
  - **Parameters**:
    - `?cadences=gid1,gid2` picks the **active cadences**, whose iterations make the columns (ADR-38). Unknown GIDs are ignored, not an error (a stale `localStorage`); with no known one, the default applies (`GITLAB_CADENCE`, else every cadence holding today, else the first one GitLab flags active, else the first). It combines with `refresh=1`. `cadences[]` lists every cadence with `active`: the frontend shows the answer, never its request.
    - `?refresh=1&groups=a/b,a/c` re-reads the work items of these groups' subtrees, merges them into the board, then serves it (ADR-24).
      - Unknown groups are ignored; without a known group, the answer is 400 `invalid_scope`.
      - If all these groups were read less than 10 s ago, the cache answers (ADR-20).
      - No request starts a full sync, except when the backend has no data yet.
  - **Per-group data**: `groups[].id` is the group's GID (`gid://gitlab/Group/N`): lanes name their groups by it (ADR-34), stable when a group is renamed or moved. `groups[].syncedAt` (RFC 3339) says when the group's items were read. The toolbar's « Mis à jour il y a… » is the oldest of these dates among the groups of the active lanes (`scopeSyncedAt`).
  - **Headers**:
    - `X-Fetched-At` (RFC 3339): the oldest read among the board's groups.
    - `X-Cache`: `HIT` (served from the cache) or `MISS` (read for this request).
- **Errors**: body `{"error": "message", "code": "…"}`. The frontend picks its message from `code`, never from `error`.

  | `code` | HTTP | Cause |
  |---|---|---|
  | `unauthorized` | 401 | Token refused by GitLab, or without the `read_api` scope (403 `insufficient_scope`) |
  | `group_not_found` | 404 | Group missing or invisible to the token |
  | `premium_required` | 502 | Epics, iterations or "blocks" links unavailable: Free edition |
  | `cadence_not_found` | 502 | `GITLAB_CADENCE` not found, or no cadence |
  | `invalid_scope` | 400 | `?refresh=1` without a known group in `groups` |
  | `gitlab_unreachable` | 502 | GitLab does not answer, or answers an unexpected error |
  | `internal` | 500 | Bug |

- **Cache** (`internal/cache`, ADR-24):
  - it keeps the raw data (`board.Raw`), the **encoded** board with the default cadences and, per group, the start time of the read its items come from;
  - **other cadences** (`view`, ADR-38): a board per choice of cadences (known GIDs, sorted), encoded on demand **outside the lock** from the committed `raw` and `synced` (never modified in place, only replaced), kept until the next commit, 16 choices at most (all dropped past that). A view encoded from data replaced meanwhile is served but not kept;
  - **full sync** (`Run`): at startup, then `CACHE_TTL` after the end of the previous one. The cached board keeps being served meanwhile. On failure, the old board keeps being served;
  - **targeted refresh** (`Refresh`): it re-reads the requested subtrees, up to 4 in parallel (`gitlab.FetchItems`), merges them (`board.MergeScope`), then rebuilds and re-encodes the whole board;
  - a full sync and a refresh may overlap: for each group, the read **started last** wins. Merging and encoding happen under the lock;
  - one full sync at a time; refreshes of the same scope share their read;
  - reads run on their own context, with a deadline, not on the request's: a closed tab does not waste them;
  - errors are not cached;
  - **minimum interval of 10 s per group** (`MinRefresh`, ADR-20), counted from the end of the read;
  - no more purge after 24 h: each group's age is shown.
- **GitLab client**: a response is capped at 64 MB and a walk at 1,000 pages; beyond that, the sync fails (`gitlab_unreachable`).
- **Headers**: every API response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
- **nginx**:
  - it gzips JSON;
  - it waits for the backend up to 300 s (`proxy_read_timeout`, for a cold sync);
  - it fails within 5 s if the backend is down (`proxy_connect_timeout`).

## GitLab GraphQL pitfalls

Most come from Nornir, where they were learned the hard way.

- **Widgets**: tell them apart by **`__typename`** (`WorkItemWidgetHierarchy`, `WorkItemWidgetIteration`, `WorkItemWidgetStartAndDueDate`, `WorkItemWidgetLinkedItems`…). The `type` field returns an enum value (`HIERARCHY`…): do not use it to discriminate.
- **`includeDescendants: true`**: `group.workItems` needs it to include the issues of projects and subgroups.
- **Pagination**: `after` must be **`null`**, not `""`, on the first page.
- **GraphQL errors**: they come with **HTTP 200**, in `errors[]`. Detect them in the body, then turn them into typed errors. Examples: a Premium field missing from the schema gives `ErrPremiumRequired`; a `null` group gives `ErrGroupNotFound`.
- **Links**: they come from `WorkItemWidgetLinkedItems`, queried **three times with aliases**, one filter each: `blocks: linkedItems(filter: BLOCKS)`, `blockedBy: linkedItems(filter: BLOCKED_BY)` and `related: linkedItems(filter: RELATED)`.
  - With these filters, the `linkType` field is useless.
  - Both directions of a link come back: `board.Build` normalizes them.
  - A linked item may be **outside the group**: the link is then ignored.
  - Beyond `first: 100` links per item and per direction, links are cut.
- **Nested items** (a link's `workItem`, the hierarchy's `parent`): keep **`onlyTypes`** on their `widgets`, or ask for `id` only. Without that filter, each linked item brings its ~26 widgets.
- **Premium edition**: epics, iterations, cadences and "blocks" links are **Premium/Ultimate** features. On a Free or CE edition, the schema lacks these types or fields: the whole query fails instead of returning an empty list. That case must give `premium_required`, not a generic error.
- **Namespace**: a work item's place comes from `namespace { id fullPath }`.
  - For an **epic**, it is the group (`gid://gitlab/Group/…`).
  - For an **issue**, it is the **project** (`gid://gitlab/Namespaces::ProjectNamespace/…`, `fullPath` = the project's path). The issue's group is that path minus its last segment.
  - Tell the two cases apart by the GID, not by the shape of the path.
- **Subgroups**: `group.descendantGroups` lists them at every level, with pagination. The root group is not among them: add it.
- **Dates**: many items have no dates (`startDate` / `dueDate` `null`). That is normal, see the invariants. An iteration always has `startDate` and `dueDate`.
- **Iterations** (ADR-38): `iterationCadences(includeAncestorGroups: true)` and, in parallel, `iterations(includeAncestors: true, includeDescendants: true, sort: CADENCE_AND_DUE_DATE_ASC)` with `iterationCadence { id title active }`, **without a cadence filter**. An iteration of an automatic cadence may have no title: « Itération {sequence} » is shown instead.
  - `iterationCadences` has **no `includeDescendants`**: a subgroup's cadence (often a team's) is only known through its iterations. The client adds the cadences the iterations carry to those `iterationCadences` lists.
  - `ErrNoCadence` means no cadence at all, neither listed nor carried by an iteration.
  - The walk is bigger than with one cadence: 1,513 iterations of 21 cadences, 16 pages, about 10 s on `gitlab-org/security-products` (2026-11-26).
- **Groups too large**: gitlab.com answers "Request timed out" on `workItems` for huge groups (`gitlab-org`). Validate on a medium-sized public group.
- **Validation**: **every query change must be validated on a real GitLab**, with the `@live` test or a `curl` on `https://gitlab.com/api/graphql`. A local mock once accepted a field that did not exist. The fake GitLab (`gitlab-mock/`) does not validate the schema either: it dispatches on the operation name and ignores the field selection. A new query (operation name) must be added to it, otherwise it answers `unsupported query`.
- **Schema validated** on gitlab.com on 2026-11-23, with anonymous `curl`s and the `live` test, on `gitlab-org/security-products` and `gitlab-org/ruby`:
  - **Enums**: the link filter has type `WorkItemRelatedLinkType` (`RELATED`, `BLOCKED_BY`, `BLOCKS`). `types: [EPIC, ISSUE]` has type `IssueType`.
  - **Cadence variable**: `$cadenceId` must be typed **`IterationsCadenceID!`** (the seeder's `SeedIterations` only: Gleipnir no longer filters by cadence).
  - **Current iteration**: `iterations(timeframe: {start, end})` includes its bounds. Gleipnir no longer uses it (ADR-38): the backend finds the cadences holding today from the iterations, with its clock. `state: current` is not used: a daily job updates it.
  - **`includeDescendants`** (2026-11-26) exists on `Group.iterations`, not on `Group.iterationCadences` (introspection of gitlab.com).
  - **`widgets(onlyTypes: [...])`** on work items: without that filter, each item brings ~35 widgets.
  - **Complexity**: a page of 100 work items costs about 86, against an anonymous limit of 200; count 3 to 8 s per page.
  - **Group ids** (2026-11-24): `group { id }` and `descendantGroups { nodes { id } }` give `gid://gitlab/Group/N`.
- **Introspection**: gitlab.com answers **any** introspection, even `__type(name:…)`, with the full `__schema` (~8.8 MB). Save it, then search it with `jq`.
- **Iteration dates**: typed `Time`, but gitlab.com sends "YYYY-MM-DD". The client keeps the first 10 characters only.
- **Titles**:
  - iterations of an automatic cadence have `title: null`;
  - cadence titles may carry stray spaces ("AI Engineering"): the client trims them.
- **GIDs**:
  - cadence: `gid://gitlab/Iterations::Cadence/N`;
  - iteration: `gid://gitlab/Iteration/N`.
  - `GITLAB_CADENCE` accepts the title (case-insensitive), the full GID or its number.
- **Work items' `webUrl`**: `…/-/work_items/N`, issues included. For epics, it is `/groups/…/-/work_items/N`.
- **Invisible linked item**: its `workItem` may be `null` when the token cannot see it. The link is then ignored.
- **Premium errors**, recognized by `isPremiumError`:
  - on a Free group of gitlab.com: "The resource that you are attempting to access does not exist or you don't have permission…", on the path `["group","iterationCadences"]`;
  - some groups simply return `nodes: []`, which becomes `ErrNoCadence`;
  - on CE or without a license: "Field 'X' doesn't exist on type 'Group'", "No such type WorkItemWidgetLinkedItems…", "Argument 'types' on Field 'workItems' has an invalid value", "IterationsCadenceID isn't a defined input type".
  - These last messages were rebuilt from real gitlab.com errors: they were not observed on a CE instance.
- **Anonymous rate limit** of gitlab.com: a few full walks are enough to get HTTP 429s for about 30 min. For repeated live tests, use a token. A 429 becomes `gitlab_unreachable` (message "rate limited", with the `Retry-After`), without retry.
- **Writing (seeder, `gitlab-mock/cmd/seed`)**:
  - **Names**: groups and projects accept only letters, digits, emoji, `_`, `.`, `(`, `)`, `-` and spaces. No "&": the demo dataset says « API et intégrations ».
  - **Work items**: `workItemCreate(namespacePath, workItemTypeId, …Widget)` creates epics (in a group) and issues (in a project). Type GIDs come from `namespace.workItemTypes`. The state changes with `workItemUpdate(stateEvent: CLOSE | REOPEN)`, epic dates with `startAndDueDateWidget { isFixed: true … }`.
  - **Links**: `workItemAddLinkedItems(linkType: BLOCKS | RELATED)`. A link exists once and reads from both sides.
  - **Titled iterations with a gap**: only a **manual** cadence (`automatic: false`) allows it; `iterationCreate` takes `String` dates. GitLab refuses two overlapping iterations: to shift them, move the last one first when moving forward, the first one first when moving back.
  - **Labels**: `labelCreate` does not set a color afterwards (`labelUpdate` only has `archived`): recoloring goes through REST `PUT /groups/:id/labels/:label_id`.
  - **Nested groups**: `Group.Slug` may hold a `/` (`api/partenaires`); the seeder creates the group under its parent (`parent_id`), which comes before it in `Dataset.Groups`.
  - **Users**: only an admin can create them (`POST /users`). An assignee must be a member: the seeder adds the `demo-*` users as Reporters of the target group.
  - The `workItem*` mutations are marked "Experiment" in the schema: they may change from one version to the next.
  - **Not validated live** (2026-11-24): names, arguments and types checked against gitlab.com's introspection only, for lack of a writable Premium instance. First run on a real instance: `-apply` then run again, the second run must print `0 to create`.
- **Go live test**: `GITLAB_URL=https://gitlab.com GITLAB_GROUP=gitlab-org/security-products go test -tags live -run Live -v ./internal/gitlab/`.

## Business invariants

They live in `internal/board`. All are covered by table-driven tests: a behavior change comes with a test.

1. **Identity**: an item is identified by the **GID of its work item** (`gid://gitlab/WorkItem/…`), everywhere: `Link.source/target`, `parentEpic`, `blocksEpics`, `criticalPath` and the keys on the frontend side.
   - The `&18` / `#110` references are **for display only**: issue IIDs repeat from one project to the next.
2. **Issues** (§5.1, ADR-35): **every** issue of the dataset is sent. A lane's issue mode picks which ones it shows, on the frontend.
   - `blocksEpics` lists the epics an issue blocks (it is the **source** of a `blocks` link to an epic of the dataset). It may be **empty**: "blocking issue" means a non-empty `blocksEpics`, there is no other flag.
   - There is no `ignoredIssues` any more: the frontend counts blocking issues itself (« N sur M »).
3. **Group of an item** (§5.3):
   - epic: the group that holds it;
   - issue: its project's namespace minus the last segment.
4. **Placing an epic on the iterations** (§5.2). The iterations are the **columns** of the active cadences (invariant 11), sorted by start date; `start` and `end` are inclusive indexes.
   - **Start**: the iteration that holds the start date. If the date falls between two iterations, the **next** one. Columns of shifted cadences overlap and their due dates are not sorted: the start is searched linearly, the first column in start order that ends on or after the date.
   - **End**: the iteration that holds the end date. If the date falls between two iterations, the **previous** one.
   - **No dates**: the min and max of the columns of its child issues, all issues counted (blocking or not, of any cadence). The epic then carries `datesFromChildren`.
   - **Otherwise**: `unplanned`, with `start` and `end` set to `null`.
   - Edge cases: see ADR-19 in `docs/decisions.md`.
5. **Current iteration**: the first column holding "today", according to an **injected clock** (`Build(raw, now, cadences...)`) and `TZ`. `current` is -1 when no column holds the date. Iteration dates are inclusive.
6. **Link normalization** (§5.4):
   - `blocks` and `is_blocked_by` give **one** directed link, blocker → blocked, without duplicates;
   - `relates` is stored as a sorted pair (`source < target`), without duplicates;
   - `parent` goes from the parent epic to the issue;
   - a link with an end outside the dataset is ignored. Links join every item, issue → issue included; `parent` joins an epic to each of its issues.
7. **Conflict**: on **every** `blocks` link (issue → issue included, ADR-35), a link whose blocker is **open** and ends in an iteration **strictly later** than the start iteration of the blocked item.
   - Same iteration: no conflict.
   - Closed blocker: never a conflict.
   - Unplanned item on either side: no conflict.
   - An epic's end is `end`, its start `start`; for an issue, it is its iteration.
8. **Critical path**: the longest chain of `blocks` links between **open** items, in the directed graph.
   - Scope: epics and **blocking issues** only (non-empty `blocksEpics`, ADR-35). A chain of non-blocking issues never makes it.
   - Cycles are detected, broken and reported in the logs.
   - On equal length, keep the chain that ends last, then the one that starts first, then the smallest list of IDs.
   - `criticalPath` lists the IDs, from the first blocker to the last blocked; it is empty without a "blocks" link.
9. **Unplanned**: an epic with neither dates nor a planned child, or any issue without an iteration, or whose iteration lies entirely before or after the columns (ADR-35, ADR-38). The frontend shows them in the « Non planifié » column, at the end of the board.
10. **Deterministic order**:
    - cadences by title, then ID;
    - columns by start date, then due date, then cadence title, then sequence, then ID;
    - groups by path, root first;
    - labels by title;
    - epics, issues and links in a stable order.
    
    **Never iterate over a map to produce output**: the same GitLab data must give the same JSON.
11. **Active cadences and columns** (ADR-38, replaces "one cadence", ADR-6):
    - every cadence is read; the active ones are the known IDs asked for, deduplicated, else the default (`ConfiguredCadence`, else every cadence with an iteration holding today, else the first one GitLab flags active, else the first by title);
    - the columns are the iterations of the active cadences; those with the **same start and due dates** make **one** column, with the ID, title and URL of the first one (by cadence title), listing `iterationIds` and `cadenceIds`;
    - an issue of an **inactive** cadence is placed like an epic with its iteration's dates, then takes the start column: the column holding its iteration's start date, the next one in a gap; unplanned when the iteration ends before the first column or starts after the last one;
    - a duplicated cadence keeps its first copy, like a label.
12. **Merging a targeted refresh** (`MergeScope`, ADR-24):
    - items whose group (invariant 3) is in the scope are replaced by the items read again; an item read again also replaces its copy outside the scope (a moved item);
    - the links of items outside the scope that point into the scope are removed: the side read again is authoritative;
    - an item that left the scope disappears until its new group is read;
    - `prev` is never modified.

## Frontend

- **Dependencies**: no runtime dependency other than `react` and `react-dom`. No router, no state or data library: `fetch` and home-made hooks are enough. Add **no** dependency, not even a dev one, without a decision recorded in `docs/decisions.md`.
- **Colors**:
  - Tokens (names from `docs/style.md` §2) are defined **only** in `src/styles/theme.css`, with their light and dark values (`:root[data-theme='dark']`). `board.css` and `app.css` only use them.
  - **No hard-coded color** in components nor in TypeScript. A component exposes its states as `data-*` attributes (`data-kind`, `data-closed`, `data-conflict`, `data-lane-color`…), which CSS maps to tokens.
  - Only exception: a GitLab label's color, which is data. It goes through the `--label-color` property in an inline `style`.
- **Lanes** (ADR-34): user-edited filters (`src/board/lanes.ts`), edited in `LaneSettingsSheet` with « Annuler » / « Appliquer ».
  - A lane holds a name, a color, groups (by **GID**), `includeSubgroups`, `showEpics`, `issueMode` (`all` / `blocking` / `none`, ADR-35), labels with `labelMode` (`any` / `all`) and `active`. The array order is the display order.
  - Matching (§5.1, §5.3): the item's group is a lane group, or a descendant when `includeSubgroups`; epics need `showEpics`; issues follow `issueMode`; an empty label list does not filter.
  - Lanes may **overlap**: an item shows in every matching active lane, and counters count it once. A link joins the occurrence in the same lane as its other end, otherwise the first one.
  - Default lanes (first visit, « Rétablir la configuration d'exemple »): one per direct subgroup of the root (the root if none), subgroups included, issues `blocking`.
  - Groups are picked from the GitLab group tree (`board.groups`), never typed.
  - Stored lanes are validated against the board: unknown groups and labels are dropped, a lane with no known group is dropped, a bad color or mode falls back to its default, an unreadable value gives the default lanes.
- **Off-window and out-of-lane dependencies** (ADR-37): « › N hors fenêtre » for a linked item that matches an active lane outside the window; « N hors couloirs » (dotted, exit icon) for one that matches **no** active lane. Only `blocks` and `relates` links count, when their type is shown; membership ignores window, search and « Masquer les issues fermées ». In the inspector, an out-of-lane dependency is dotted, not a button.
- **Lane colors**: picked per lane from a fixed palette (ADR-15); a new lane takes the first unused color. The palette of Apple system color tokens (`--lane-indigo`, `--lane-blue`, `--lane-cyan`, `--lane-mint`, `--lane-yellow`, `--lane-orange`, `--lane-pink`, `--lane-brown`). CSS exposes them through `[data-lane-color='x'] { --lane: … }`.
  - No red: it is reserved for conflicts.
  - No green, purple or teal: they already carry a meaning (purple = epic, teal = issue).
- **Texts**: every UI text is in French and lives in `src/strings/`:
  - `ui.ts` → `UI`, `board.ts` → `BOARD`, `app.ts` → `APP`, all re-exported by `index.ts`;
  - format `export const X = { … } as const`;
  - functions for plurals and parameterized texts.
  
  No visible string hard-coded in a component.
- **Logic**:
  - Pure logic goes in `src/board/` (lanes, window, format, layout, links, stats), without React or DOM, with its `*.test.ts` tests.
  - Components do not compute the layout: they read the `BoardView` from `computeBoardView`, memoized.
  - The search (`src/board/search.ts`) keeps the matches and their whole dependency chain (upstream and downstream walked separately, checked link types); the dependencies are flagged `searchContext` and veiled (ADR-30).
  - Column widths depend on the board's: `BoardCanvas` measures its scroll container (`ResizeObserver`) and `App` passes it to `computeBoardView` (`availableWidth`). `LAYOUT` widths are minimums (ADR-29).
- **CSS**: one file per area.
  - `theme.css`: tokens and generic controls (`.button`, `.menu`, `.pill`…);
  - `board.css`: the canvas;
  - `app.css`: the shell.
  
  `main.tsx` imports all three. No CSS framework and no external font: the app works offline.
- **Persistence** (ADR-36, replaces the view in the URL of ADR-31): the app neither reads nor writes the URL, and there is no share link.
  - `localStorage`, read with validation and try/catch everywhere: `gleipnir.lanes` (ADR-34), `gleipnir.window` (`{from, to}` iteration GIDs, found in the columns' `iterationIds`; an unknown iteration gives the default window), `gleipnir.cadences` (the active cadences asked for, GIDs, ADR-38; `null` = the backend's default), `gleipnir.sidebar`, `gleipnir.appearance`.
  - The active cadences go to `useBoard(cadences)`, which loads again when they change, silent reloads and Synchroniser included. What the board shows as active comes from the answer (`cadences[].active`), never from the stored list.
  - Session only (React state): link types, « Masquer les issues fermées », the « Non planifié » column, the critical path, collapsed lanes, search, selection.
  - Two tabs of the same browser share lanes and window: the last write wins.
- **Theme**:
  - The inline script of `index.html` applies the appearance **before the first render**, to avoid a flash. Keep it in sync with `resolveScheme` (`src/hooks/useAppearance.ts`).
  - **Any change to that script changes its hash**: recompute it and update the CSP in `frontend/nginx.conf.template` (see Security), or the script is blocked in production.
- **TypeScript**: `strict` mode, `import type` for types (`verbatimModuleSyntax`).
- **Accessibility**:
  - every clickable element is a real `<button>`, with `aria-pressed` for selection;
  - icon buttons have an `aria-label`;
  - the segmented control uses `role="radio"`;
  - the focus ring is visible;
  - Escape closes menus, pop-ups and the inspector;
  - contrast is at least 4.5:1;
  - types are told apart by shape, not by color alone;
  - `prefers-reduced-motion` is honored.
  
  Tests select by role and by label.

## Tests

- **Coverage** (ADR-23): at least **90 % of lines and 90 % of functions**, on the Go side as on the frontend.
  - Test the **edge cases**: bounds, empty or `null` values, duplicates, errors, tie ordering.
  - On the frontend, the thresholds are in `vitest.config.ts`: `npm run test:coverage` fails below them.
  - On the Go side, `go tool cover -func` gives the total. A covered function is one above 0 %. Only `main` stays at 0 %.
- **Go**: table-driven tests.
  - Business rules live in `internal/board`: placement, links, conflicts, critical path with a cycle, unplanned, order.
  - The cache is tested with `-race`.
  - The GitLab client and the handlers are tested against a **fake `httptest` GitLab**.
  - The clock is always injected.
  - `cmd/server` is tested through `run` and `serve`, on a free port. A test sends SIGTERM to the process only **after** `serve` listens (`waitHealthy`): otherwise the signal kills the test binary.
- **Vitest** (`vitest.config.ts`, setup `src/test/setup.ts`):
  - `src/**/*.test.ts`: pure logic, in node;
  - `src/**/*.test.tsx`: components with Testing Library. Their **first line** is `// @vitest-environment jsdom`.
  - **Pitfalls**:
    - with `vi.useFakeTimers({ toFake: ['setInterval', …] })`, Testing Library's `waitFor` no longer polls, and `vi.waitFor` advances the fake clock on each try. Flush promises with `await act(async () => {})` instead;
    - React reads a `timeStamp` of 0 as missing and replaces it with `Date.now()`: a simulated event starts at 1;
    - jsdom has no `PointerEvent`: a `MouseEvent` with `pointerId` and `pointerType` added stands in for it;
    - `getByTitle` and `getByText` normalize whitespace: for a text that starts or ends with a space, read the attribute directly;
    - the app saves cadences, lanes, window and sidebar in `localStorage`: `setup.ts` clears it after each test. To open the app on given lanes or a window, write `gleipnir.lanes` / `gleipnir.window` before rendering.
- **Playwright** (`frontend/e2e/`, `playwright.config.ts`):
  - `*.spec.ts` run against the **real backend, wired to the fake GitLab**: `webServer` starts `gitlab-mock` (8082), the backend (8081) and Vite (5174), or the ports given by `E2E_MOCK_PORT` / `E2E_API_PORT` / `E2E_WEB_PORT` (see ADR-22). The GitLab client, pagination and targeted refresh are thus covered end to end.
  - The demo dataset lives in `gitlab-mock/dataset/dataset.go`. The e2e assertions (lanes, « Itération 15 » current, links, counts) depend on it: change them together.
    - It has two cadences (ADR-38): « Sprints produit » in the root group, and « Squad data » in `data`, with the dates of Itération 13 … 18 and its own titles. Both hold today, so both are active by default and merge into the root's ten columns. #120, #130 and #131 are planned in « Squad data ». Its title sorts after the root's: merged columns keep « Itération N ».
    - It has a nested group, `api/partenaires` (« Partenaires », &22). The default lanes include subgroups, so &22 shows in the « API et intégrations » lane.
  - **Agnostic** (ADR-28): the same suite runs on the fake GitLab and on a real GitLab filled by the seeder.
    - An item is named by its dataset **key** (`'&18'`): `item(page, key)` and `boardItem(page, key)` find it by its **title**, never by its ref (on a real GitLab, `&1` exists in every group).
    - Any text showing a ref, an iteration, a path, the root or an assignee goes through `e2e/demo.ts`: `ref('&21')`, `title('#101')`, `it(14)` (« It. 14 »), `itTitle(15)`, `group('api')`, `groupKey('api')`, `root()`, `cadence()` (the active cadences' titles, joined as in the toolbar), `cadenceTitles()`, `assignee('#110')`. They read the board that `e2e/global-setup.ts` loads once (variable `E2E_DEMO_BOARD`); test titles keep the keys.
    - Stored lanes and windows name groups and iterations by their GID: read them from `board()`, never hard-code them.
    - Every issue is in the board now (ADR-35): `ref()` works for non-blocking issues too.
    - Each test starts with an empty `localStorage` (a fresh browser context): default lanes and window.
    - A search by ref checks that every item shown as a **match** fits (`shownKeys(page, true)`, without `data-search-context`), not a count: on a real GitLab, `#1` also finds `#10`.
    - The search brings back the dependency chain of the matches (ADR-30): for an assertion on the exact chain, search by **title**. By ref, each group has its `&1` and the chain grows.
    - The `globalSetup` requires `current === 3` (« Itération 15 »): on a filled GitLab, running the seeder again realigns the dates.
    - `npm run test:e2e:gitlab-like` (`E2E_GITLAB_LIKE=1`) checks this without an instance: `GITLAB_MOCK_NUMBERING=gitlab` and `GITLAB_MOCK_ROOT=demo/gleipnir`.
  - `webServer` gives `DEMO-JETON-TEST` to the fake GitLab (`GITLAB_MOCK_TOKEN`) and to the backend (`GITLAB_TOKEN`): loading the board proves the token goes through, and a token exported in the shell is not sent to the fake GitLab.
  - In development, React `StrictMode` starts then aborts a first `/api/board` request: an error mock must not count calls, but stay active until the test removes it.
  - Vite watches files by polling (the devcontainer's WSL mount misses inotify events). An error state is simulated with `page.route` (401, 502).
  - `*.live.spec.ts` are tagged `@live`: they run against a real GitLab through `BASE_URL`, and assume nothing about the group's content.
  - Locale `fr-FR`, time zone `Europe/Paris`.
  - Tests use roles and labels, not CSS classes, except to measure geometry.
  - Running both suites side by side (12 Chromium workers on 12 cores) makes every test about ten times slower: a 2 s test takes about 20 s. A heavy test (a second page or browser context, dozens of pop-up clicks: `persistence.spec.ts`, `window.spec.ts`) is marked `test.slow()`, or it times out. Measure with `--reporter=json` before raising anything else.
- **Every new Playwright test is kept in the project**, never thrown away.

## Deployment (Docker)

- **Backend image**:
  - build `golang:1.27-alpine` (`CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`), then `alpine:3.24` (the Alpine release `golang:1.27-alpine` is built on) with `ca-certificates` and `tzdata`;
  - the Go version is set in three places that move together: `go.mod` (`go 1.27`, backend and fake GitLab), the `golang:` image of both Dockerfiles, and `.devcontainer/Dockerfile`;
  - `USER 10001:10001` is **numeric** on purpose: Kubernetes can then check `runAsNonRoot`;
  - `HEALTHCHECK` with `wget` on `/api/health`.
  
  `go.mod` has no dependency, hence no `go.sum`: do not copy one.
- **Fake GitLab image** (`gitlab-mock/Dockerfile`, demo only): the same scheme, without `ca-certificates`, `HEALTHCHECK` on `/-/health`. Only `docker-compose.demo.yml` builds it; it runs `read_only`, `cap_drop: [ALL]`, with no published port.
- **Frontend image**:
  - build `node:22-alpine` (`npm ci`, `npm run build`), then `nginxinc/nginx-unprivileged:alpine` (uid 101), which **listens on 8080**;
  - `nginx.conf.template` is copied to `/etc/nginx/templates/`, and the image's entrypoint runs `envsubst` on it at startup. Only defined variables are substituted (`GLEIPNIR_BACKEND_URL`), so `$uri` and `$host` stay intact.
  
  **Do not add an environment variable named like an nginx variable.**
- **nginx**:
  - SPA fallback to `index.html`;
  - `/assets/` (names hashed by Vite) cached long, `index.html` `no-cache`;
  - gzip on JSON, JS, CSS and SVG.
  - Security headers are set at `server` level: do **not** add an `add_header` in a `location`, or it would lose them. For caching, use `expires`.
- **Compose**: the frontend waits for the backend to be `healthy` (`depends_on: condition: service_healthy`).

## Security

- **Token**: read only (`read_api`), **server side only**.
  - It is never sent to the browser, never returned by the API, **never logged**: the config is logged with `tokenSet: bool`.
  - It is never committed: `.env` is in `.gitignore`.
- **Visibility**: one token for everyone. Every user sees what the token sees, no more, no less.
- **GitLab content**: it is **never interpreted as HTML**.
  - No `dangerouslySetInnerHTML`, no `innerHTML`.
  - Titles, labels and names go through React text.
  - Opened URLs come from `webUrl` and open with `rel="noopener noreferrer"`.
  - A label's color is only set in `--label-color`.
- **CSP** (`frontend/nginx.conf.template`):
  - `default-src 'self'`;
  - `script-src 'self' 'sha256-…'`: the hash of the **only** inline script, the theme script of `index.html`;
  - `style-src 'self' 'unsafe-inline'`: React sets `style` attributes;
  - `img-src 'self' data:`: the favicon is a `data:` URL;
  - `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
  
  The other headers are `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- **Recompute the hash** after any change to the inline script (whitespace included):

  ```bash
  cd frontend && python3 -c "import re,hashlib,base64;s=re.search(r'<script>(.*?)</script>',open('index.html').read(),re.S).group(1);print(base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())"
  ```

  Then check in `dist/index.html` that Vite left the script intact. Do not add another inline script.

## Working rules

### Language

- **Code, identifiers, comments and this file**: in English. Comments are short and explain the *why*.
- **UI**: in French, in `src/strings/`.
- **User documentation**: in French (`README.md`, `docs/`).
- **Commit titles**: in English.
- Playwright selectors repeat the UI texts: update the tests when a text changes.

### Commits

- **[Conventional Commits](https://www.conventionalcommits.org/)** format: `type(scope): description`, in the imperative.
  - **The message is the title only**: no body, no footer nor trailer (`Co-Authored-By`, `Signed-off-by`…).
  - The title is understandable by someone who does not know the project.
  - Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`.
  - Scopes: `backend`, `frontend`, `mock`, `e2e`, `docker`, `docs`.
  - Examples:
    - `feat(frontend): dim unrelated items when one is selected`
    - `fix(backend): pick the next iteration when an epic starts between two`
    - `test(e2e): check the window recenters on an off-window dependency`
    - `docs: document the GITLAB_CADENCE variable`
- One commit = one coherent change.
- Never commit `.env`, `node_modules/`, `dist/`, nor the Playwright reports.

### Before committing

1. `cd backend && gofmt -l . && go vet ./... && go test -race ./...`. `gofmt -l` must list nothing. Coverage stays ≥ 90 %. Same in `gitlab-mock/` if it changed.
2. `cd frontend && npm run build && npm run test:coverage && npm run test:e2e && npm run test:e2e:gitlab-like`.
3. If the GitLab client or a GraphQL query changed: `npm run test:e2e:live` against a real GitLab.
4. If a Dockerfile, the compose files or `nginx.conf.template` changed: `docker compose config` (and with `-f docker-compose.demo.yml`), then `docker compose up -d --build` and a check of `/api/health` and of the page (CSP: no error in the console).

### Documentation

- **`README.md`**: update it for any change the user can see (configuration, commands, behavior).
- **This file**: update it with every new convention, pitfall, invariant, command or known limit, or when something here becomes false.
- **`docs/decisions.md`**: a new ADR for any architecture decision or any departure from the spec.
- These updates go **in the same commit** as the change they describe.

### Always up to date: spec, documentation and tests

**Every change leaves the spec, the documentation and the tests up to date and aligned.** This is not optional, and not for later.

- **The spec is the reference; the tests check it.**
  - The spec (`docs/specifications.md`) and the ADRs (`docs/decisions.md`) describe the behavior. Tests check that the code does what they say.
  - Every rule of the spec or of an ADR has at least one test, at the lowest level that holds it: Go for business rules, Vitest for frontend logic and components, Playwright for user flows.
  - The test's name or a comment cites the section (`§4.4`, `ADR-34`) when the link is not obvious.
  - **Changing a behavior starts with the spec** (or an ADR), then the tests that check it, then the code, all in the same commit.
- **Spec unchanged, a test turns red**:
  - a **behavior test** (a rule of the spec or of an ADR, a result the user sees, an e2e flow) does **not** change. Red means a regression: fix the code, not the test;
  - an **implementation test** (a signature, an internal structure, a function or module name, how the code is split) may be adapted to the new implementation, **without weakening what it checks**: the same cases, the same expected results;
  - when in doubt, it is a behavior test.
- **Spec changed**: the tests of the old rule are rewritten for the new one, with its edge cases (bounds, empty, duplicates, order), like every other rule. A test that no longer has a purpose is rewritten or removed, not left behind.
- **Documentation**:
  - reread **everything that describes the behavior touched**, not only the obvious section: `docs/specifications.md` (vocabulary, business rules, data model included), the existing ADRs of `docs/decisions.md`, this file and `README.md`;
  - fix every sentence that became false. A replaced ADR is marked as such, and points to the new one;
  - a `grep` for the old terms (function names, UI labels, removed options) must find nothing stale.
- **Tests**:
  - every feature added or changed has its tests, at every level concerned: Go, Vitest, Playwright, and `@live` if a GraphQL query changes;
  - the dead code a change leaves behind (component, CSS, text, helper) is removed along with its tests.
- **A test that turns red after a change is never fixed blindly.** Before touching the test, find the cause:
  - **intended change**, meaning a change written in the spec or an ADR: update the test, and say in the summary of the work what changed and why;
  - **regression**: fix the code, not the test;
  - **flakiness** (timers, load, order): run the test alone, then under load, find what slows it down or makes it unstable, and fix it in a targeted way (`test.slow()` for a heavy test, waiting on a state rather than a delay). Never settle for a rerun that passes.
  
  Loosening an assertion, raising a threshold or deleting a test to get back to green needs the same justification.

## Known limits

- **Shifted cadences** (ADR-38): every cadence is read and the user picks the active ones, but only iterations with the very same dates share a column. Active cadences with other rhythms give overlapping columns, and "strictly later" (conflicts) counts in columns.
- **One server token**, without OAuth: everyone sees what the token sees. Individual GitLab permissions are not applied.
- **No incremental sync** (`updatedAfter`): the background sync reads everything again. The Synchroniser button only re-reads the subtrees of the active lanes, but with every lane active, it re-reads almost everything.
- **Data of different ages**: after a targeted refresh, the other groups keep their data until the next full sync. An item moved out of the re-read subtree disappears until then.
- **Links**: more than 100 per item and per direction are cut (`linkedItems(first: 100)`).
- **No Helm chart** in v1: Docker and compose only. The cache is in memory, hence one instance per backend.
- **Settings per browser** (ADR-36): lanes and window live in the browser's `localStorage`. No share link, no named views, no server-side preferences: a configuration follows neither the user nor another browser. Stored lanes name groups by GID, so they belong to one GitLab instance.
- **Overlapping lanes** (ADR-34): an item that matches several active lanes shows in each; counters count it once.
- **Read only**: a link can be neither created nor deleted from the board.
- **Seeder not validated live**: its mutations were only checked against gitlab.com's schema and a stateful fake GitLab (ADR-27).
