package main

// GraphQL queries and mutations of the seeder. Every name, argument and input type was checked
// against gitlab.com's schema (introspection of 2026-11-24); the mutations still need a run on
// a real Premium/Ultimate instance (see docs/decisions.md, ADR-27).

const workItemTypesQuery = `query SeedWorkItemTypes($fullPath: ID!) {
  namespace(fullPath: $fullPath) {
    workItemTypes { nodes { id name } }
  }
}`

const labelsQuery = `query SeedLabels($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    labels(first: 100, after: $after, onlyGroupLabels: true, includeAncestorGroups: false) {
      pageInfo { hasNextPage endCursor }
      nodes { id title color }
    }
  }
}`

const labelCreateMutation = `mutation SeedLabelCreate($input: LabelCreateInput!) {
  labelCreate(input: $input) { label { id } errors }
}`

const cadencesQuery = `query SeedCadences($fullPath: ID!, $title: String) {
  group(fullPath: $fullPath) {
    iterationCadences(first: 100, title: $title, includeAncestorGroups: false) {
      nodes { id title automatic }
    }
  }
}`

const cadenceCreateMutation = `mutation SeedCadenceCreate($input: IterationCadenceCreateInput!) {
  iterationCadenceCreate(input: $input) { iterationCadence { id } errors }
}`

const iterationsQuery = `query SeedIterations($fullPath: ID!, $cadenceId: IterationsCadenceID!, $after: String) {
  group(fullPath: $fullPath) {
    iterations(first: 100, after: $after, includeAncestors: false, iterationCadenceIds: [$cadenceId], sort: CADENCE_AND_DUE_DATE_ASC) {
      pageInfo { hasNextPage endCursor }
      nodes { id title startDate dueDate }
    }
  }
}`

const iterationCreateMutation = `mutation SeedIterationCreate($input: iterationCreateInput!) {
  iterationCreate(input: $input) { iteration { id } errors }
}`

const iterationUpdateMutation = `mutation SeedIterationUpdate($input: UpdateIterationInput!) {
  updateIteration(input: $input) { iteration { id } errors }
}`

// The work items already under the root, as Gleipnir reads them plus the IDs the seeder
// compares. first: 50 keeps the query well under the complexity limit.
const workItemsQuery = `query SeedWorkItems($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    workItems(first: 50, after: $after, includeDescendants: true, types: [EPIC, ISSUE]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title state
        namespace { fullPath }
        workItemType { name }
        widgets(onlyTypes: [START_AND_DUE_DATE, ITERATION, HIERARCHY, LABELS, ASSIGNEES, LINKED_ITEMS]) {
          __typename
          ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
          ... on WorkItemWidgetIteration { iteration { id } }
          ... on WorkItemWidgetHierarchy { parent { id } }
          ... on WorkItemWidgetLabels { labels { nodes { id } } }
          ... on WorkItemWidgetAssignees { assignees { nodes { id } } }
          ... on WorkItemWidgetLinkedItems { linkedItems(first: 100) { nodes { workItem { id } } } }
        }
      }
    }
  }
}`

const workItemCreateMutation = `mutation SeedWorkItemCreate($input: WorkItemCreateInput!) {
  workItemCreate(input: $input) { workItem { id } errors }
}`

const workItemUpdateMutation = `mutation SeedWorkItemUpdate($input: WorkItemUpdateInput!) {
  workItemUpdate(input: $input) { workItem { id } errors }
}`

const linkAddMutation = `mutation SeedLinkAdd($input: WorkItemAddLinkedItemsInput!) {
  workItemAddLinkedItems(input: $input) { errors }
}`
