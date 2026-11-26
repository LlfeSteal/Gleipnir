// Texts of the board canvas and of its formatting helpers (src/board, src/components/board).

export const BOARD = {
  lanesCorner: 'Couloirs',
  current: 'En cours',
  unplanned: 'Non planifié',
  emptyLane: 'Aucun élément de ce couloir dans la fenêtre.',

  // Lanes
  newLaneName: 'Nouveau couloir',
  untitledLane: 'Couloir sans nom',
  noGroup: 'aucun groupe',
  subgroups: '+ sous-groupes',
  allLabels: 'tous les labels',
  labelModeAny: 'au moins un',
  labelModeAll: 'tous',
  /** A lane header's extra labels (§4.1), and the card that lists them all on hover. */
  moreLaneLabels: (n: number) => (n > 1 ? `et ${n} autres…` : `et ${n} autre…`),
  laneLabelsTitle: 'Labels du couloir',
  labelModeAnyLong: 'Au moins un de ces labels',
  labelModeAllLong: 'Tous ces labels',
  /** Lane summary, label part: "au moins un de : bug, UX" / "tous : bug, UX". */
  labelsAny: (labels: readonly string[]) => `au moins un de : ${labels.join(', ')}`,
  labelsAll: (labels: readonly string[]) => `tous : ${labels.join(', ')}`,
  /** A lane's issue mode, in its summary and header (spec §4.4). */
  issueModes: { all: 'toutes les issues', blocking: 'issues bloquantes', none: 'aucune issue' },
  noType: 'aucun type',
  editLane: (name: string) => `Modifier le couloir ${name}`,
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
  blocksNoEpic: 'Ne bloque aucun epic',
  startsIn: (iteration: string) => `Commence en ${iteration}`,
  endsIn: (iteration: string) => `Se termine en ${iteration}`,
  moreLabels: (n: number) => `+${n}`,
  offWindowPill: (n: number) => `› ${n}`,
  offWindowTitle: (refs: string[]) =>
    `${refs.length > 1 ? 'Dépendances hors fenêtre' : 'Dépendance hors fenêtre'} : ${refs.join(', ')}`,
  offWindowLabel: (n: number) => (n > 1 ? `${n} dépendances hors fenêtre` : `${n} dépendance hors fenêtre`),
  /** Dependencies in no active lane (spec §4.5): the full label on an epic, the number on a card. */
  offLanesPill: (n: number) => `${n} hors couloirs`,
  offLanesTitle: (refs: string[]) =>
    `${refs.length > 1 ? 'Dépendances hors couloirs' : 'Dépendance hors couloirs'} : ${refs.join(', ')}`,

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
