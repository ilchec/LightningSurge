jest.mock(
  'lightning/graphql',
  () => ({
    gql: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
  }),
  { virtual: true }
);

import {
  buildDirectReportsQuery,
  buildUserNodeQuery,
  buildUserSearchQuery,
  extractDirectReports,
  extractSearchResults,
  extractUserNode
} from 'c/inspectorNativeOrgChartUtils';

describe('buildUserNodeQuery', () => {
  it('filters on the given userId and traverses the Manager relationship', () => {
    const query = buildUserNodeQuery('005xx0000001');
    expect(query).toContain('User(where: { Id: { eq: "005xx0000001" } }, first: 1)');
    expect(query).toContain('Manager {');
  });
});

describe('buildDirectReportsQuery', () => {
  it('filters on ManagerId and omits the after param on the first page', () => {
    const query = buildDirectReportsQuery('005xx0000001', 20);
    expect(query).toContain('User(where: { ManagerId: { eq: "005xx0000001" } }, first: 20, orderBy: { Name: { order: ASC } })');
  });

  it('includes the after cursor on later pages', () => {
    const query = buildDirectReportsQuery('005xx0000001', 20, 'CURSOR1');
    expect(query).toContain('first: 20, after: "CURSOR1", orderBy');
  });
});

describe('buildUserSearchQuery', () => {
  it('wraps the search term in LIKE wildcards and quotes it', () => {
    const query = buildUserSearchQuery('Jordan', 10);
    expect(query).toContain('Name: { like: "%Jordan%" }');
    expect(query).toContain('IsActive: { eq: true }');
  });

  it('escapes LIKE wildcard characters and quotes in the search term', () => {
    const query = buildUserSearchQuery('50%_"off"', 10);
    // escapeLikeValue backslash-escapes % and _ first, then quoteGqlString backslash-escapes
    // every backslash (doubling the ones just added) and every quote - so % and _ end up behind
    // a doubled backslash, and the literal quotes end up behind a single one.
    expect(query).toContain('like: "%50\\\\%\\\\_\\"off\\"%"');
  });
});

describe('extractUserNode', () => {
  it('extracts id/name/title plus the manager fields', () => {
    const data = {
      uiapi: {
        query: {
          User: {
            edges: [
              {
                node: {
                  Id: '005A',
                  Name: { value: 'Jordan Avery' },
                  Title: { value: 'CEO' },
                  Manager: { Id: '005B', Name: { value: 'Board' }, Title: { value: 'Chair' } }
                }
              }
            ]
          }
        }
      }
    };
    expect(extractUserNode(data)).toEqual({
      id: '005A',
      name: 'Jordan Avery',
      title: 'CEO',
      managerId: '005B',
      managerName: 'Board',
      managerTitle: 'Chair'
    });
  });

  it('leaves managerId/managerName/managerTitle null when there is no manager (top of chain)', () => {
    const data = {
      uiapi: { query: { User: { edges: [{ node: { Id: '005A', Name: { value: 'Jordan Avery' }, Title: null, Manager: null } }] } } }
    };
    const node = extractUserNode(data);
    expect(node.managerId).toBeNull();
    expect(node.managerName).toBeNull();
  });

  it('returns null when the user is missing/not visible', () => {
    expect(extractUserNode({ uiapi: { query: { User: { edges: [] } } } })).toBeNull();
    expect(extractUserNode({})).toBeNull();
  });
});

describe('extractDirectReports', () => {
  it('extracts rows, totalCount, and pageInfo', () => {
    const data = {
      uiapi: {
        query: {
          User: {
            edges: [{ node: { Id: '005C', Name: { value: 'Sam Patel' }, Title: { value: 'Engineer' } } }],
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    };
    const { rows, totalCount, pageInfo } = extractDirectReports(data);
    expect(rows).toEqual([{ id: '005C', name: 'Sam Patel', title: 'Engineer' }]);
    expect(totalCount).toBe(1);
    expect(pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });

  it('returns empty rows when there are no direct reports', () => {
    const { rows, totalCount } = extractDirectReports({ uiapi: { query: { User: { edges: [], totalCount: 0 } } } });
    expect(rows).toEqual([]);
    expect(totalCount).toBe(0);
  });
});

describe('extractSearchResults', () => {
  it('extracts id/name/title per matched user', () => {
    const data = {
      uiapi: { query: { User: { edges: [{ node: { Id: '005D', Name: { value: 'Riley Chen' }, Title: { value: 'VP Sales' } } }] } } }
    };
    expect(extractSearchResults(data)).toEqual([{ id: '005D', name: 'Riley Chen', title: 'VP Sales' }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(extractSearchResults({ uiapi: { query: { User: { edges: [] } } } })).toEqual([]);
  });
});
