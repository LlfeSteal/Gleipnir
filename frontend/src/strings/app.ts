// Texts of the app shell: toolbar, window control, sidebar, summary line, inspector, lane
// settings sheet, loading / error / empty states.

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const APP = {
  title: 'Dépendances',
  /** The root group and the active cadences (ADR-38). */
  subtitle: (group: string, cadences: readonly string[]) =>
    cadences.length > 0 ? `${group} · ${cadences.join(', ')}` : group,

  toolbar: {
    showSidebar: 'Afficher la barre latérale',
    hideSidebar: 'Masquer la barre latérale',
    filters: 'Filtres',
    searchLabel: 'Rechercher un epic ou une issue',
    searchPlaceholder: 'Rechercher (#110, &18…)',
    openSearch: 'Rechercher',
    cancelSearch: 'Annuler',
    updated: (relative: string) => `Mis à jour ${relative}`,
    syncing: 'Synchronisation…',
    sync: 'Synchroniser',
    syncHelp: 'Recharger depuis GitLab les groupes des couloirs actifs',
    syncNothing: 'Aucun couloir actif à synchroniser',
  },

  window: {
    group: 'Fenêtre d’itérations',
    previous: 'Itération précédente',
    next: 'Itération suivante',
    button: (label: string) => `Fenêtre : ${label}`,
    range: (from: string, to: string) => (from === to ? from : `${from} – ${to}`),
    menu: 'Fenêtre d’itérations',
    start: 'Début',
    end: 'Fin',
    current: 'en cours',
    /** ADR-38: the active cadences give the columns. */
    cadences: 'Cadences',
    noIteration: 'Aucune itération',
    presetsHeader: 'Réglages rapides',
    presets: { around: 'En cours ± 2', next: '6 prochaines', all: 'Toutes' },
  },

  sidebar: {
    label: 'Filtres',
    close: 'Fermer les filtres',
    lanes: 'Couloirs',
    /** The lane's checkbox (active or hidden) is named after the lane. */
    showLane: (name: string) => name,
    editLane: (name: string) => `Modifier ${name}`,
    laneCount: (n: number) => `${n} ${plural(n, 'élément affiché', 'éléments affichés')}`,
    newLane: 'Nouveau couloir',
    configure: 'Configurer…',
    noLane: 'Aucun couloir.',
    links: 'Liens · tous les couloirs',
    linkTypes: { blocks: 'Bloque', relates: 'Lié à', parent: 'Epic parent → issue' },
    display: 'Affichage',
    hideClosed: 'Masquer les issues fermées',
    showUnplanned: 'Afficher les non planifiés',
    criticalPath: 'Chemin critique',
    criticalPathHelp: 'Plus longue chaîne de blocages ouverts',
    /** Spec §5.1: how many synced issues block an epic, e.g. "9 sur 16". */
    blockingIssues: (n: number, total: number) =>
      `${n} sur ${total} ${plural(total, 'issue synchronisée', 'issues synchronisées')} ${plural(n, 'bloque', 'bloquent')} un epic.`,
    legend: 'Repères',
    legendOffWindow: 'Dépendances dans un couloir, hors de la fenêtre',
    legendOffLanes: 'Dépendances dans aucun couloir actif',
    touchHint:
      'Touchez un élément pour mettre en évidence ses dépendances. Dans le détail, un élément hors fenêtre déplace la fenêtre jusqu’à lui.',
  },

  summary: {
    lanes: (n: number) => plural(n, 'couloir', 'couloirs'),
    epics: (n: number) => plural(n, 'epic', 'epics'),
    issues: (n: number) => plural(n, 'issue', 'issues'),
    blocks: (n: number) => plural(n, 'blocage', 'blocages'),
    conflicts: (n: number) => plural(n, 'conflit', 'conflits'),
  },

  inspector: {
    label: 'Détail de l’élément',
    close: 'Fermer le détail',
    epic: 'Epic',
    issue: 'Issue',
    state: {
      epic: { open: 'Ouvert', closed: 'Fermé' },
      issue: { open: 'Ouverte', closed: 'Fermée' },
    },
    group: 'Groupe',
    lanes: 'Couloirs',
    iteration: 'Itération',
    period: 'Période',
    parent: 'Epic parent',
    assignee: 'Assigné·e',
    labels: 'Labels',
    none: '—',
    unplanned: 'Non planifié',
    inherited: 'dates héritées des issues',
    dependencies: 'Dépendances',
    blocks: 'Bloque',
    blockedByEpics: 'Bloqué par (epics)',
    blockedByIssues: 'Bloqué par (issues)',
    blockedBy: 'Bloqué par',
    relates: 'Lié à',
    noDependency: 'Aucune dépendance.',
    conflict: 'Conflit',
    conflictHelp: 'Le bloqueur finit après le début de l’élément bloqué',
    outside: 'hors fenêtre',
    /** A dependency in no active lane: not on the board, so not a button (spec §4.6). */
    outsideLanes: (group: string) => `Hors couloirs · ${group}`,
    outsideLanesHelp: 'Dans aucun couloir actif : ouvrez-le dans GitLab, ou ajustez un couloir pour l’inclure.',
    openInGitLab: 'Ouvrir dans GitLab',
  },

  settings: {
    title: 'Configurer les couloirs',
    subtitle:
      'Chaque couloir est un filtre : groupes GitLab, epics et issues, labels. L’ordre de la liste est l’ordre du board.',
    list: 'Liste des couloirs',
    showLane: (name: string) => `Afficher ${name}`,
    moveUp: (name: string) => `Monter ${name}`,
    moveDown: (name: string) => `Descendre ${name}`,
    remove: (name: string) => `Supprimer ${name}`,
    newLane: 'Nouveau couloir',
    untitled: 'Couloir sans nom',
    noLane: 'Aucun couloir. Créez-en un pour afficher des éléments.',
    pick: 'Choisissez un couloir à modifier.',
    name: 'Nom',
    color: 'Couleur',
    colors: {
      indigo: 'Indigo',
      blue: 'Bleu',
      cyan: 'Cyan',
      mint: 'Menthe',
      yellow: 'Jaune',
      orange: 'Orange',
      pink: 'Rose',
      brown: 'Marron',
    },
    groups: 'Groupes GitLab',
    groupsSearch: 'Filtrer les groupes',
    noGroup: 'Aucun groupe disponible.',
    noGroupPicked: 'Choisissez au moins un groupe.',
    includeSubgroups: 'Inclure les sous-groupes',
    includeSubgroupsHelp: 'Un élément de a/b/c correspond au groupe a/b.',
    show: 'Afficher',
    epics: 'Epics',
    issues: 'Issues',
    issueModes: { all: 'Toutes', blocking: 'Bloquantes', none: 'Aucune' },
    issueModesHelp: {
      all: 'Toutes les issues des groupes du couloir.',
      blocking: 'Uniquement les issues qui bloquent un epic.',
      none: 'Aucune issue dans ce couloir.',
    },
    labels: 'Labels',
    labelsSearch: 'Filtrer les labels',
    noLabelAvailable: 'Aucun label.',
    labelMode: 'Correspondance des labels',
    any: 'Au moins un',
    all: 'Tous',
    noLabel: 'Aucun label choisi : tous les éléments sont gardés.',
    labelsApply: 'S’applique aux epics et aux issues.',
    missingGroups: 'Chaque couloir doit avoir au moins un groupe.',
    reset: 'Rétablir la configuration d’exemple',
    cancel: 'Annuler',
    apply: 'Appliquer',
  },

  states: {
    noIterationTitle: 'Aucune itération',
    noIterationMessage: (cadences: readonly string[]) =>
      cadences.length === 1
        ? `La cadence « ${cadences[0]} » n’a aucune itération à afficher.`
        : `Les cadences ${cadences.map((c) => `« ${c} »`).join(', ')} n’ont aucune itération à afficher.`,
    noLaneTitle: 'Aucun couloir affiché',
    noLaneMessage: 'Activez un couloir dans la barre latérale, ou créez-en un.',
    configure: 'Configurer les couloirs',
    emptyWindowTitle: 'Rien dans cette fenêtre',
    emptyWindowMessage: (range: string) => `Les couloirs affichés n’ont aucun élément en ${range}.`,
    showAll: 'Afficher toutes les itérations',
    noMatchTitle: 'Aucun résultat',
    noMatchMessage: (query: string) => `Aucun élément affiché ne correspond à « ${query} ».`,
    clearSearch: 'Effacer la recherche',
  },

  errors: {
    unauthorized: {
      title: 'Jeton GitLab refusé',
      message: 'GitLab a refusé le jeton du serveur. Vérifiez GITLAB_TOKEN et son scope read_api.',
    },
    group_not_found: {
      title: 'Groupe introuvable',
      message: 'Le groupe GITLAB_GROUP n’existe pas, ou le jeton ne permet pas de le voir.',
    },
    premium_required: {
      title: 'GitLab Premium requis',
      message: 'Les epics, les itérations et les liens bloquants demandent GitLab Premium ou Ultimate.',
    },
    cadence_not_found: {
      title: 'Cadence introuvable',
      message: 'Aucune cadence d’itérations ne correspond à GITLAB_CADENCE, ou le groupe n’en a aucune.',
    },
    invalid_scope: {
      title: 'Rien à synchroniser',
      message: 'Les couloirs actifs ne contiennent aucun groupe connu du serveur. Vérifiez leurs groupes.',
    },
    gitlab_unreachable: {
      title: 'GitLab injoignable',
      message: 'Le serveur n’arrive pas à joindre GitLab. Réessayez dans un instant.',
    },
    network: {
      title: 'Serveur injoignable',
      message: 'Le serveur Gleipnir ne répond pas. Vérifiez qu’il est démarré, puis réessayez.',
    },
    internal: {
      title: 'Erreur du serveur',
      message: 'Le serveur a rencontré une erreur inattendue. Réessayez, ou consultez ses journaux.',
    },
    unknown: {
      title: 'Chargement impossible',
      message: 'Le board n’a pas pu être chargé.',
    },
  },
} as const;
