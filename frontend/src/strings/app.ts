// Texts of the app shell: toolbar, window control, sidebar, summary line, inspector, loading /
// error / empty states.

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const APP = {
  title: 'Dépendances',
  subtitle: (group: string, cadence: string) => (cadence ? `${group} · ${cadence}` : group),

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
    presetsHeader: 'Réglages rapides',
    presets: { around: 'En cours ± 2', next: '6 prochaines', all: 'Toutes' },
  },

  sidebar: {
    label: 'Filtres',
    close: 'Fermer les filtres',
    lanes: 'Couloirs · groupes GitLab',
    groups: 'Groupes GitLab',
    expandGroup: (name: string) => `Déplier ${name}`,
    collapseGroup: (name: string) => `Replier ${name}`,
    laneCount: (n: number) => `${n} ${plural(n, 'élément affiché', 'éléments affichés')}`,
    lanesHelp: 'Chaque groupe coché est un couloir. Pour en ajouter, créez le groupe dans GitLab puis synchronisez.',
    items: 'Éléments',
    epics: 'Epics',
    issues: 'Issues bloquantes',
    labels: 'Labels',
    labelsButton: (labels: readonly string[]) => (labels.length === 0 ? 'Tous les labels' : labels.join(', ')),
    labelsSearch: 'Filtrer les labels',
    noLabel: 'Aucun label.',
    labelMode: 'Correspondance',
    labelModes: { any: 'Au moins un', all: 'Tous' },
    clearLabels: 'Tous les labels',
    links: 'Liens · tous les couloirs',
    linkTypes: { blocks: 'Bloque', relates: 'Lié à', parent: 'Epic parent → issue' },
    display: 'Affichage',
    hideClosed: 'Masquer les issues fermées',
    showUnplanned: 'Afficher les non planifiés',
    criticalPath: 'Chemin critique',
    criticalPathHelp: 'Plus longue chaîne de blocages ouverts',
    ignored: (n: number) =>
      n === 1
        ? '1 issue synchronisée ne bloque aucun epic : elle n’est pas affichée.'
        : `${n} issues synchronisées ne bloquent aucun epic : elles ne sont pas affichées.`,
    touchHint:
      'Touchez un élément pour mettre en évidence ses dépendances. Dans le détail, un élément hors fenêtre déplace la fenêtre jusqu’à lui.',
  },

  summary: {
    lanes: (n: number) => plural(n, 'couloir', 'couloirs'),
    epics: (n: number) => plural(n, 'epic', 'epics'),
    issues: (n: number) => plural(n, 'issue bloquante', 'issues bloquantes'),
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
    lanes: 'Couloir',
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
    openInGitLab: 'Ouvrir dans GitLab',
  },

  states: {
    noIterationTitle: 'Aucune itération',
    noIterationMessage: (cadence: string) => `La cadence « ${cadence} » n’a aucune itération à afficher.`,
    noLaneTitle: 'Aucun couloir affiché',
    noLaneMessage: 'Cochez un groupe GitLab dans la barre latérale.',
    defaultLanes: 'Afficher les couloirs par défaut',
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
