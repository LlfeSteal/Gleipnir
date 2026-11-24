// Test fixtures: the mockup's dataset (docs/mockup.html) as a BoardData, and a generator of
// large boards for the performance test. Not imported by the app.

import type { BoardData, Epic, Issue, Iteration, Link, LinkType } from '../api/types';

const ROOT = 'plateforme/atlas';
export const G = {
  identite: `${ROOT}/identite`,
  xp: `${ROOT}/experience`,
  api: `${ROOT}/api`,
  data: `${ROOT}/data`,
  /** Nested under api: unchecked by default, its items show in the API lane. */
  partenaires: `${ROOT}/api/partenaires`,
} as const;

/** Group ids: gid://gitlab/Group/40 for the root, then 41… */
export const groupId = (n: number) => `gid://gitlab/Group/${40 + n}`;

const GITLAB = 'https://gitlab.exemple.fr';

/** Work item ids: epics 1000 + iid, issues 2000 + iid, so refs map to ids predictably. */
export const epicId = (iid: number) => `gid://gitlab/WorkItem/${1000 + iid}`;
export const issueId = (iid: number) => `gid://gitlab/WorkItem/${2000 + iid}`;
/** "&18" → epic id, "#110" → issue id. */
export const idOf = (ref: string) => (ref.startsWith('&') ? epicId(+ref.slice(1)) : issueId(+ref.slice(1)));

const ITERATIONS: [string, string, string][] = [
  ['Itération 12', '2026-10-07', '2026-10-20'],
  ['Itération 13', '2026-10-21', '2026-11-03'],
  ['Itération 14', '2026-11-04', '2026-11-17'],
  ['Itération 15', '2026-11-18', '2026-12-01'],
  ['Itération 16', '2026-12-02', '2026-12-15'],
  ['Itération 17', '2026-12-16', '2026-12-29'],
  ['Itération 18', '2027-01-06', '2027-01-19'],
  ['Itération 19', '2027-01-20', '2027-02-02'],
  ['Itération 20', '2027-02-03', '2027-02-16'],
  ['Itération 21', '2027-02-17', '2027-03-02'],
];
const CURRENT = 3;

const LABELS: [string, string][] = [
  ['frontend', '#2f6fdb'],
  ['backend', '#6d5bd0'],
  ['API', '#14a08a'],
  ['bug', '#e0532f'],
  ['sécurité', '#e08a1e'],
  ['UX', '#c4479f'],
  ['data', '#65a30d'],
  ['mobile', '#0284c7'],
  ['priorité::haute', '#9c2f19'],
];

const PEOPLE: Record<string, [string, string]> = {
  AL: ['Amélie Laurent', 'alaurent'],
  MB: ['Malik Benali', 'mbenali'],
  CD: ['Chloé Dubois', 'cdubois'],
  TR: ['Thomas Roux', 'troux'],
  SN: ['Sofia Nguyen', 'snguyen'],
  JP: ['Julien Petit', 'jpetit'],
};

type E = [iid: number, group: string, title: string, start: number, end: number, labels: string[]];
const EPICS: E[] = [
  [12, G.identite, 'Authentification SSO', 2, 4, ['sécurité', 'backend']],
  [13, G.identite, 'Gestion fine des droits', 5, 7, ['sécurité', 'backend']],
  [16, G.identite, "Journal d'audit", 7, 9, ['sécurité']],
  [15, G.xp, 'Refonte du tableau de bord', 3, 5, ['frontend', 'UX']],
  [17, G.xp, 'Mode hors ligne mobile', 6, 8, ['mobile', 'frontend']],
  [19, G.api, 'Webhooks sortants', 0, 3, ['API', 'backend']],
  [18, G.api, "API d'export des données", 4, 6, ['API', 'backend']],
  [22, G.partenaires, 'Portail développeur', 7, 9, ['API', 'UX']],
  [21, G.data, 'Pipeline analytique', 5, 7, ['data', 'backend']],
  [23, G.data, 'Modèles prédictifs', 8, 9, ['data']],
];

type I = [iid: number, group: string, title: string, it: number, epic: number, labels: string[], state: 'open' | 'closed', who: string];
const ISSUES: I[] = [
  [104, G.identite, 'Corriger la déconnexion intempestive', 3, 12, ['bug', 'priorité::haute', 'backend'], 'open', 'TR'],
  [114, G.identite, 'Audit de sécurité du SSO', 4, 12, ['sécurité'], 'open', 'TR'],
  [140, G.api, 'Contrat d’interface des webhooks', 1, 19, ['API'], 'closed', 'SN'],
  [107, G.api, "API d'agrégation des métriques", 4, 18, ['backend', 'API'], 'open', 'SN'],
  [110, G.api, 'Endpoint d’export CSV / JSON', 5, 18, ['backend', 'API'], 'open', 'SN'],
  [113, G.xp, 'Lenteur au chargement du tableau', 5, 15, ['bug', 'priorité::haute', 'frontend'], 'open', 'MB'],
  [125, G.xp, 'Quota de stockage local', 6, 17, ['mobile', 'backend'], 'open', 'CD'],
  [131, G.data, 'Montée de version Kafka', 2, 21, ['data', 'backend'], 'closed', 'JP'],
  [130, G.data, "Schéma d'événements v2", 6, 21, ['data'], 'open', 'JP'],
];

const LINKS: [string, LinkType, string][] = [
  ['&12', 'blocks', '&13'],
  ['&12', 'blocks', '&18'],
  ['&19', 'blocks', '&18'],
  ['&18', 'blocks', '&22'],
  ['&13', 'blocks', '&16'],
  ['&13', 'blocks', '&17'],
  ['&15', 'relates', '&17'],
  ['&18', 'blocks', '&21'],
  ['&21', 'blocks', '&23'],
  ['&16', 'relates', '&22'],
  ['#104', 'blocks', '&13'],
  ['#114', 'blocks', '&18'],
  ['#140', 'blocks', '&18'],
  ['#107', 'blocks', '&15'],
  ['#110', 'blocks', '&21'],
  ['#113', 'blocks', '&17'],
  ['#125', 'blocks', '&17'],
  ['#131', 'blocks', '&21'],
  ['#130', 'blocks', '&23'],
  ['#107', 'relates', '#110'],
];

function iterations(): Iteration[] {
  return ITERATIONS.map(([title, startDate, dueDate], i) => ({
    id: `gid://gitlab/Iteration/${500 + i}`,
    title,
    startDate,
    dueDate,
    webUrl: `${GITLAB}/groups/${ROOT}/-/iterations/${500 + i}`,
    current: i === CURRENT,
  }));
}

/** The mockup's board: 10 iterations (It. 12 → It. 21, It. 15 current), 4 groups, 10 epics,
 * 9 blocking issues, blocks / relates / parent links with conflicts computed by the backend rule
 * (open blocker ending after its target starts). A fresh object on each call. */
export function mockupBoard(): BoardData {
  const its = iterations();
  const epics: Epic[] = EPICS.map(([iid, groupPath, title, start, end, labels]) => ({
    id: epicId(iid),
    iid: String(iid),
    ref: `&${iid}`,
    groupPath,
    title,
    labels,
    state: 'open',
    start,
    end,
    startDate: its[start].startDate,
    dueDate: its[end].dueDate,
    datesFromChildren: false,
    unplanned: false,
    webUrl: `${GITLAB}/groups/${groupPath}/-/epics/${iid}`,
  }));
  const blocked = (ref: string) => LINKS.filter(([a, t, b]) => a === ref && t === 'blocks' && b.startsWith('&')).map(([, , b]) => idOf(b));
  const issues: Issue[] = ISSUES.map(([iid, groupPath, title, iteration, epic, labels, state, who]) => ({
    id: issueId(iid),
    iid: String(iid),
    ref: `#${iid}`,
    groupPath,
    projectPath: `${groupPath}/app`,
    title,
    labels,
    state,
    iteration,
    parentEpic: epicId(epic),
    assignee: { name: PEOPLE[who][0], username: PEOPLE[who][1] },
    blocksEpics: blocked(`#${iid}`),
    unplanned: false,
    webUrl: `${GITLAB}/${groupPath}/app/-/issues/${iid}`,
  }));
  const span = (id: string) => {
    const e = epics.find((x) => x.id === id);
    if (e) return { start: e.start as number, end: e.end as number, open: e.state === 'open' };
    const i = issues.find((x) => x.id === id)!;
    return { start: i.iteration as number, end: i.iteration as number, open: i.state === 'open' };
  };
  const links: Link[] = LINKS.map(([a, type, b]) => {
    const source = idOf(a);
    const target = idOf(b);
    const conflict = type === 'blocks' && span(source).open && span(source).end > span(target).start;
    return { source, target, type, conflict };
  });
  for (const i of ISSUES) links.push({ source: epicId(i[4]), target: issueId(i[0]), type: 'parent', conflict: false });

  return {
    syncedAt: '2026-11-23T09:00:00Z',
    gitlabUrl: GITLAB,
    rootGroup: { id: groupId(0), path: ROOT, name: 'Atlas' },
    cadence: { id: 'gid://gitlab/Iterations::Cadence/1', title: 'Sprints produit' },
    iterations: its,
    current: CURRENT,
    groups: [
      { id: groupId(0), path: ROOT, name: 'Atlas' },
      { id: groupId(1), path: G.api, name: 'API & intégrations' },
      { id: groupId(5), path: G.partenaires, name: 'Partenaires' },
      { id: groupId(2), path: G.data, name: 'Data' },
      { id: groupId(3), path: G.xp, name: 'Expérience produit' },
      { id: groupId(4), path: G.identite, name: 'Identité & sécurité' },
    ],
    labels: LABELS.map(([title, color]) => ({ title, color })),
    epics,
    issues,
    links,
    criticalPath: ['&12', '&18', '&21', '&23'].map(idOf),
    ignoredIssues: 7,
  };
}

/** A large board for the performance test: `groups` sibling groups under the root, epics spread
 * over `iterations` iterations, every issue blocking one or two epics, then random links. */
export function generateBoard(opts: { epics: number; issues: number; links: number; groups: number; iterations: number }): BoardData {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (n: number) => Math.floor(rand() * n);
  const groups = Array.from({ length: opts.groups }, (_, i) => ({ id: groupId(i + 1), path: `${ROOT}/g${i}`, name: `Groupe ${i}` }));
  const its: Iteration[] = Array.from({ length: opts.iterations }, (_, i) => ({
    id: `gid://gitlab/Iteration/${i}`,
    title: `Itération ${i + 1}`,
    startDate: '2026-01-01',
    dueDate: '2026-01-14',
    webUrl: '',
    current: i === Math.floor(opts.iterations / 2),
  }));
  const labels = ['a', 'b', 'c', 'd', 'e'];
  const epics: Epic[] = Array.from({ length: opts.epics }, (_, k) => {
    const start = pick(opts.iterations);
    const end = Math.min(opts.iterations - 1, start + pick(4));
    return {
      id: epicId(k),
      iid: String(k),
      ref: `&${k}`,
      groupPath: groups[k % opts.groups].path,
      title: `Epic ${k}`,
      labels: [labels[pick(5)]],
      state: 'open',
      start,
      end,
      startDate: '',
      dueDate: '',
      datesFromChildren: false,
      unplanned: false,
      webUrl: '',
    };
  });
  const links: Link[] = [];
  const issues: Issue[] = Array.from({ length: opts.issues }, (_, k) => {
    const target = epicId(pick(opts.epics));
    links.push({ source: issueId(k), target, type: 'blocks', conflict: rand() < 0.1 });
    return {
      id: issueId(k),
      iid: String(k),
      ref: `#${k}`,
      groupPath: groups[k % opts.groups].path,
      projectPath: `${groups[k % opts.groups].path}/app`,
      title: `Issue ${k}`,
      labels: [labels[pick(5)], labels[pick(5)]],
      state: rand() < 0.2 ? 'closed' : 'open',
      iteration: pick(opts.iterations),
      parentEpic: '',
      assignee: null,
      blocksEpics: [target],
      unplanned: false,
      webUrl: '',
    };
  });
  const types: LinkType[] = ['blocks', 'relates', 'parent'];
  while (links.length < opts.links) {
    const a = rand() < 0.5 ? epicId(pick(opts.epics)) : issueId(pick(opts.issues));
    const b = epicId(pick(opts.epics));
    if (a !== b) links.push({ source: a, target: b, type: types[pick(3)], conflict: rand() < 0.1 });
  }
  return {
    syncedAt: '2026-11-23T09:00:00Z',
    gitlabUrl: GITLAB,
    rootGroup: { id: groupId(0), path: ROOT, name: 'Atlas' },
    cadence: { id: 'c', title: 'Cadence' },
    iterations: its,
    current: Math.floor(opts.iterations / 2),
    groups: [{ id: groupId(0), path: ROOT, name: 'Atlas' }, ...groups],
    labels: labels.map((title) => ({ title, color: '#888888' })),
    epics,
    issues,
    links,
    criticalPath: [],
    ignoredIssues: 0,
  };
}
