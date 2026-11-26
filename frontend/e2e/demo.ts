import type { BoardData } from '../src/api/types';

// The board the e2e run against, read once by global-setup.ts: the fake GitLab's, or a real
// GitLab filled with the same dataset by the seeder (gitlab-mock/cmd/seed). The tests name the
// items by their key in that dataset (gitlab-mock/dataset/dataset.go): the mockup's reference,
// "&18", "#110". On a real GitLab the references are GitLab's own and repeat from one group or
// project to the next, so items are found by their title, which is unique, and every text
// showing a reference, an iteration or a path is resolved from the served board.

/** The titles of the dataset's items, by key. */
const TITLES: Record<string, string> = {
  '&12': 'Authentification SSO',
  '&13': 'Gestion fine des droits',
  '&15': 'Refonte du tableau de bord',
  '&16': "Journal d'audit",
  '&17': 'Mode hors ligne mobile',
  '&18': "API d'export des données",
  '&19': 'Webhooks sortants',
  '&21': 'Pipeline analytique',
  '&22': 'Portail développeur',
  '&23': 'Modèles prédictifs',
  '&24': 'Notifications push',
  '&25': 'Accessibilité RGAA',
  '&26': "Socle d'observabilité",
  '#101': 'Configurer le fournisseur SAML',
  '#103': 'Gestion des sessions et refresh token',
  '#104': 'Corriger la déconnexion intempestive',
  '#106': 'Widgets configurables',
  '#107': "API d'agrégation des métriques",
  '#108': 'Persistance des préférences utilisateur',
  '#109': "Spécification OpenAPI de l'export",
  '#110': 'Endpoint d’export CSV / JSON',
  '#112': "Documentation développeur de l'export",
  '#113': 'Lenteur au chargement du tableau',
  '#114': 'Audit de sécurité du SSO',
  '#120': 'Ingestion des événements produit',
  '#125': 'Quota de stockage local',
  '#126': "Service d'envoi des notifications",
  '#127': 'Préférences de notification',
  '#130': "Schéma d'événements v2",
  '#131': 'Montée de version Kafka',
  '#132': 'Purge des données personnelles',
  '#140': 'Contrat d’interface des webhooks',
};

/** The number of the dataset's first iteration: "Itération 12" is index 0. */
const FIRST_ITERATION = 12;

/** The environment variable global-setup.ts passes the board in. */
export const BOARD_ENV = 'E2E_DEMO_BOARD';

let cached: BoardData | undefined;

/** The served board. Read lazily: test files are loaded before the global setup runs. */
export function board(): BoardData {
  if (!cached) {
    const raw = process.env[BOARD_ENV];
    if (!raw) throw new Error(`${BOARD_ENV} is not set: global-setup.ts reads the board before the tests`);
    cached = JSON.parse(raw) as BoardData;
  }
  return cached;
}

/** The title of an item of the dataset, by key. */
export function title(key: string): string {
  const t = TITLES[key];
  if (!t) throw new Error(`no item ${key} in the demo dataset`);
  return t;
}

/** The key of an item by its title, or the title itself when the dataset has no such item. */
export function keyOf(itemTitle: string): string {
  return Object.keys(TITLES).find((k) => TITLES[k] === itemTitle) ?? itemTitle;
}

/** The reference the board shows for an item of the dataset ("&18" on the fake GitLab). */
export function ref(key: string): string {
  const t = title(key);
  const found = [...board().epics, ...board().issues].find((it) => it.title === t);
  if (!found) throw new Error(`${key} (${t}) is not in the served board`);
  return found.ref;
}

/** The kind an item's accessible name starts with. */
export function kind(key: string): 'Epic' | 'Issue' {
  return key.startsWith('&') ? 'Epic' : 'Issue';
}

function iteration(n: number) {
  const it = board().iterations[n - FIRST_ITERATION];
  if (!it) throw new Error(`no iteration ${n}: the board has ${board().iterations.length}`);
  return it;
}

/** The full title of the dataset's iteration n ("Itération 15"). */
export function itTitle(n: number): string {
  return iteration(n).title;
}

/** The short label of the dataset's iteration n ("It. 15"), as src/board/format.ts makes it. */
export function it(n: number): string {
  const t = iteration(n).title;
  const m = /(\d+)\s*$/.exec(t);
  return m ? `It. ${m[1]}` : t;
}

/** The root group the board was read from. */
export function root(): { path: string; name: string } {
  return board().rootGroup;
}

/** The full path of a subgroup of the root, by its slug ("api"). */
export function group(slug: string): string {
  return `${root().path}/${slug}`;
}

/** A group of the board by its slug under the root ("api", "" for the root itself): its GitLab
 * global ID, which lanes store (ADR-34), and its name. */
export function groupOf(slug: string): { id: string; path: string; name: string } {
  const path = slug === '' ? root().path : group(slug);
  const found = board().groups.find((g) => g.path === path);
  if (!found) throw new Error(`no group ${path} in the board`);
  return found;
}

/** The names of the active cadences, joined as the toolbar shows them (ADR-38). */
export function cadence(): string {
  return board()
    .cadences.filter((c) => c.active)
    .map((c) => c.title)
    .join(', ');
}

/** The names of every cadence, in the board's order (by title). */
export function cadenceTitles(): string[] {
  return board().cadences.map((c) => c.title);
}

/** The assignee's name of an issue, null when it has none (a seeder without admin rights). */
export function assignee(key: string): string | null {
  const t = title(key);
  return board().issues.find((is) => is.title === t)?.assignee?.name ?? null;
}
