package gitlab

// All queries were validated against gitlab.com (see AGENTS.md, GitLab GraphQL pitfalls).
// Every one pages with $after (null on the first page) and reads pageInfo.

// Descendant groups at every level (the root itself is not listed).
const groupsQuery = `query Groups($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    fullPath
    name
    descendantGroups(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { fullPath name }
    }
  }
}`

// Cadences of the group and of its ancestors (a subgroup usually uses its parent's).
const cadencesQuery = `query Cadences($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    iterationCadences(first: 100, after: $after, includeAncestorGroups: true) {
      pageInfo { hasNextPage endCursor }
      nodes { id title active }
    }
  }
}`

// Iterations of every cadence containing $today (both bounds of timeframe are inclusive).
// Used to pick the default cadence; the date comes from our clock, not GitLab's `state:
// current`, which a daily worker updates.
const currentIterationsQuery = `query CurrentIterations($fullPath: ID!, $today: Date!, $after: String) {
  group(fullPath: $fullPath) {
    iterations(first: 100, after: $after, includeAncestors: true, timeframe: {start: $today, end: $today}) {
      pageInfo { hasNextPage endCursor }
      nodes { id iterationCadence { id } }
    }
  }
}`

// Iterations of one cadence. title is null on automatic cadences.
const iterationsQuery = `query Iterations($fullPath: ID!, $cadenceId: IterationsCadenceID!, $after: String) {
  group(fullPath: $fullPath) {
    iterations(first: 100, after: $after, includeAncestors: true, iterationCadenceIds: [$cadenceId], sort: CADENCE_AND_DUE_DATE_ASC) {
      pageInfo { hasNextPage endCursor }
      nodes { id title sequence startDate dueDate webUrl iterationCadence { id title } }
    }
  }
}`

// Epics and issues of the group and its descendants. onlyTypes keeps the ~35 other widgets
// out of the response. first: 100 scores 86 of the 200 complexity points gitlab.com allows
// anonymous queries (250 with a token).
const workItemsQuery = `query WorkItems($fullPath: ID!, $after: String) {
  group(fullPath: $fullPath) {
    workItems(first: 100, after: $after, includeDescendants: true, types: [EPIC, ISSUE]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id iid title state webUrl
        namespace { id fullPath }
        workItemType { name }
        widgets(onlyTypes: [START_AND_DUE_DATE, ITERATION, HIERARCHY, LABELS, ASSIGNEES, LINKED_ITEMS]) {
          __typename
          ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
          ... on WorkItemWidgetIteration { iteration { id } }
          ... on WorkItemWidgetHierarchy { parent { id } }
          ... on WorkItemWidgetLabels { labels { nodes { title color } } }
          ... on WorkItemWidgetAssignees { assignees { nodes { name username } } }
          ... on WorkItemWidgetLinkedItems {
            blocks: linkedItems(filter: BLOCKS, first: 100) { nodes { workItem { id } } }
            blockedBy: linkedItems(filter: BLOCKED_BY, first: 100) { nodes { workItem { id } } }
            related: linkedItems(filter: RELATED, first: 100) { nodes { workItem { id } } }
          }
        }
      }
    }
  }
}`
