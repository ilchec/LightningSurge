import { gql } from 'lightning/graphql';

/**
 * Pure functions behind the Org Chart tab: building the GraphQL queries (one user's own record +
 * their manager, one page of their direct reports, a name search) and extracting rows from their
 * responses. Manager traversal (`Manager { Name { value } }`) is confirmed real UI API GraphQL
 * behavior - each parent relationship on an object has a corresponding field on the GraphQL type
 * named after the relationship, per the official GraphQL API reference - verified directly rather
 * than assumed, given how costly an unverified API-shape assumption turned out to be for Field
 * Creator elsewhere in this app.
 */

const LIKE_WILDCARD_PATTERN = /[%_\\]/g;

function escapeLikeValue(value) {
  return String(value).replaceAll(LIKE_WILDCARD_PATTERN, String.raw`\$&`);
}

function quoteGqlString(value) {
  const escaped = String(value).replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

/**
 * One user's own Name/Title plus their manager's Id/Name/Title (via the Manager relationship) -
 * everything the center node and "Reports To" node need in a single request.
 */
export function buildUserNodeQuery(userId) {
  return gql`
    query {
      uiapi {
        query {
          User(where: { Id: { eq: "${userId}" } }, first: 1) {
            edges {
              node {
                Id
                Name {
                  value
                }
                Title {
                  value
                }
                Manager {
                  Id
                  Name {
                    value
                  }
                  Title {
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * One page of a user's direct reports (User records whose ManagerId equals theirs) - a flat,
 * where-filtered query rather than traversing a child relationship, so this doesn't need to know
 * (or guess at) User's own child-relationship name for ManagerId. Real cursor pagination, not a
 * client-side cap - a manager can plausibly have far more direct reports than are worth fetching
 * in one request, unlike Relationship Map's schema-only lists (already fully in memory either way).
 */
export function buildDirectReportsQuery(userId, pageSize, afterCursor) {
  const afterParam = afterCursor ? `, after: "${afterCursor}"` : '';
  return gql`
    query {
      uiapi {
        query {
          User(where: { ManagerId: { eq: "${userId}" } }, first: ${pageSize}${afterParam}, orderBy: { Name: { order: ASC } }) {
            edges {
              node {
                Id
                Name {
                  value
                }
                Title {
                  value
                }
              }
            }
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;
}

/** Active users whose Name matches the given search text, for the "jump to a user" search box. */
export function buildUserSearchQuery(searchTerm, maxResults) {
  const likeLiteral = quoteGqlString(`%${escapeLikeValue(searchTerm)}%`);
  return gql`
    query {
      uiapi {
        query {
          User(where: { and: [{ Name: { like: ${likeLiteral} } }, { IsActive: { eq: true } }] }, first: ${maxResults}, orderBy: { Name: { order: ASC } }) {
            edges {
              node {
                Id
                Name {
                  value
                }
                Title {
                  value
                }
              }
            }
          }
        }
      }
    }
  `;
}

/** { id, name, title, managerId, managerName, managerTitle } from a buildUserNodeQuery response, or null if the user wasn't found/visible. */
export function extractUserNode(data) {
  const edge = data?.uiapi?.query?.User?.edges?.[0];
  if (!edge) {
    return null;
  }
  const node = edge.node;
  const manager = node.Manager;
  return {
    id: node.Id,
    name: node.Name?.value ?? node.Id,
    title: node.Title?.value ?? '',
    managerId: manager?.Id ?? null,
    managerName: manager?.Name?.value ?? null,
    managerTitle: manager?.Title?.value ?? ''
  };
}

/** { rows, totalCount, pageInfo } from a buildDirectReportsQuery response. */
export function extractDirectReports(data) {
  const result = data?.uiapi?.query?.User;
  const edges = result?.edges ?? [];
  return {
    rows: edges.map(({ node }) => ({ id: node.Id, name: node.Name?.value ?? node.Id, title: node.Title?.value ?? '' })),
    totalCount: result?.totalCount ?? 0,
    pageInfo: result?.pageInfo ?? { hasNextPage: false, endCursor: null }
  };
}

/** [{ id, name, title }] from a buildUserSearchQuery response. */
export function extractSearchResults(data) {
  const edges = data?.uiapi?.query?.User?.edges ?? [];
  return edges.map(({ node }) => ({ id: node.Id, name: node.Name?.value ?? node.Id, title: node.Title?.value ?? '' }));
}
