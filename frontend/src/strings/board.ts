// Texts of the board canvas and of its formatting helpers (src/board, src/components/board).

export const BOARD = {
  lanesCorner: 'Couloirs',
  current: 'En cours',
  unplanned: 'Non planifié',
  emptyLane: 'Aucun élément de ce couloir dans la fenêtre.',

  // Lanes
  typeEpics: 'epics',
  typeIssues: 'issues',
  collapseLane: (name: string) => `Replier le couloir ${name}`,
  expandLane: (name: string) => `Déplier le couloir ${name}`,
  laneEpics: (n: number) => (n > 1 ? `${n} epics` : `${n} epic`),
  laneIssues: (n: number) => (n > 1 ? `${n} issues` : `${n} issue`),
  outside: (n: number) => `${n} hors fenêtre`,

  // Items
  kind: { epic: 'Epic', issue: 'Issue' },
  closedIssue: 'Fermée',
  closedEpic: 'Fermé',
  epicLabel: (ref: string, title: string, closed: boolean) => `Epic ${ref} ${title}${closed ? ', fermé' : ''}`,
  issueLabel: (ref: string, title: string, closed: boolean) => `Issue ${ref} ${title}${closed ? ', fermée' : ''}`,
  blocks: (refs: string[]) => `Bloque ${refs.join(', ')}`,
  startsIn: (iteration: string) => `Commence en ${iteration}`,
  endsIn: (iteration: string) => `Se termine en ${iteration}`,
  moreLabels: (n: number) => `+${n}`,
  offWindowPill: (n: number) => `› ${n}`,
  offWindowTitle: (refs: string[]) =>
    `${refs.length > 1 ? 'Dépendances hors fenêtre' : 'Dépendance hors fenêtre'} : ${refs.join(', ')}`,
  offWindowLabel: (n: number) => (n > 1 ? `${n} dépendances hors fenêtre` : `${n} dépendance hors fenêtre`),

  // Links
  linkTypes: { blocks: 'Bloque', relates: 'Lié à', parent: 'Epic parent → issue' },

  // Formatting
  iterationShort: (n: string) => `It. ${n}`,
  periodArrow: ' → ',
  dateRange: (from: string, to: string) => `${from} – ${to}`,
  justNow: "à l'instant",
  minutesAgo: (n: number) => `il y a ${n} min`,
  hoursAgo: (n: number) => `il y a ${n} h`,
  yesterday: 'hier',
  daysAgo: (n: number) => `il y a ${n} jours`,
  onDate: (date: string) => `le ${date}`,
} as const;
