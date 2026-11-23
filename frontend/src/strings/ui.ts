// Texts of the generic controls (src/components/ui): French, like the whole interface.
export const UI = {
  close: 'Fermer',
  search: 'Rechercher',
  clear: 'Effacer',
  loading: 'Chargement…',
  retry: 'Réessayer',
  noMatch: 'Aucun résultat',
  noOptions: 'Aucun élément',
  appearance: 'Apparence',
  appearanceOptions: {
    system: 'Automatique',
    light: 'Clair',
    dark: 'Sombre',
  },
  /** Help tag of the appearance button, e.g. "Apparence : Sombre". */
  appearanceTitle: (option: string) => `Apparence : ${option}`,
} as const;
