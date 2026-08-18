import {
  BASIC_SETTINGS_FIELDS,
  buildFieldRows,
  buildSetDiffRows,
  extractComparisonUserNode,
  filterDifferentOnly,
  PROFILE_ROLE_FIELDS
} from 'c/inspectorNativeUserComparisonUtils';

describe('extractComparisonUserNode', () => {
  function buildFakeResponse(overrides) {
    return {
      uiapi: {
        query: {
          User: {
            edges: [
              {
                node: {
                  Id: '005000000000001',
                  Name: { value: 'Jane Doe' },
                  Username: { value: 'jane@example.com' },
                  Email: { value: 'jane@example.com' },
                  Alias: { value: 'jdoe' },
                  Title: { value: 'Sales Rep' },
                  Department: { value: 'Sales' },
                  Division: { value: 'West' },
                  IsActive: { value: true },
                  UserType: { value: 'Standard' },
                  TimeZoneSidKey: { value: 'America/Los_Angeles' },
                  LocaleSidKey: { value: 'en_US' },
                  LanguageLocaleKey: { value: 'en_US' },
                  Profile: { Name: { value: 'Standard User' } },
                  UserRole: { Name: { value: 'Sales Manager' } },
                  Manager: { Name: { value: 'Big Boss' } },
                  ...overrides
                }
              }
            ]
          }
        }
      }
    };
  }

  it('flattens every field into a plain, comparable object', () => {
    const user = extractComparisonUserNode(buildFakeResponse());
    expect(user).toMatchObject({
      id: '005000000000001',
      name: 'Jane Doe',
      username: 'jane@example.com',
      alias: 'jdoe',
      department: 'Sales',
      active: 'Active',
      profile: 'Standard User',
      role: 'Sales Manager',
      manager: 'Big Boss'
    });
  });

  it('formats IsActive as "Active"/"Inactive" text', () => {
    const active = extractComparisonUserNode(buildFakeResponse({ IsActive: { value: true } }));
    const inactive = extractComparisonUserNode(buildFakeResponse({ IsActive: { value: false } }));
    expect(active.active).toBe('Active');
    expect(inactive.active).toBe('Inactive');
  });

  it('defaults Role/Manager to a descriptive placeholder rather than blank when absent', () => {
    const user = extractComparisonUserNode(buildFakeResponse({ UserRole: null, Manager: null }));
    expect(user.role).toBe('(No Role)');
    expect(user.manager).toBe('(No Manager)');
  });

  it('returns null when no user is found/visible', () => {
    expect(extractComparisonUserNode({ uiapi: { query: { User: { edges: [] } } } })).toBeNull();
    expect(extractComparisonUserNode(undefined)).toBeNull();
  });
});

describe('buildFieldRows', () => {
  it('builds one row per field def, flagging mismatches, both columns always populated', () => {
    const userA = { username: 'a@example.com', title: 'Rep' };
    const userB = { username: 'a@example.com', title: 'Manager' };
    const rows = buildFieldRows(userA, userB, [
      { key: 'username', label: 'Username' },
      { key: 'title', label: 'Title' }
    ]);
    expect(rows).toEqual([
      { label: 'Username', valueA: 'a@example.com', valueB: 'a@example.com', isDifferent: false },
      { label: 'Title', valueA: 'Rep', valueB: 'Manager', isDifferent: true }
    ]);
  });

  it('falls back to an empty string when a user or field is missing, never a gap', () => {
    const rows = buildFieldRows(null, { title: 'Manager' }, [{ key: 'title', label: 'Title' }]);
    expect(rows).toEqual([{ label: 'Title', valueA: '', valueB: 'Manager', isDifferent: true }]);
  });

  it('exports the expected Basic Settings and Profile & Role field lists', () => {
    expect(BASIC_SETTINGS_FIELDS.map((f) => f.key)).toEqual([
      'username',
      'email',
      'alias',
      'title',
      'department',
      'division',
      'active',
      'userType',
      'timeZone',
      'locale',
      'language'
    ]);
    expect(PROFILE_ROLE_FIELDS.map((f) => f.key)).toEqual(['profile', 'role', 'manager']);
  });
});

describe('buildSetDiffRows', () => {
  it('shows an item present in both lists as identical, both checkboxes true', () => {
    const rows = buildSetDiffRows(['Sales User'], ['Sales User']);
    expect(rows).toEqual([{ label: 'Sales User', hasA: true, hasB: true, isDifferent: false }]);
  });

  it('shows an item present only in the first list with hasB false', () => {
    const rows = buildSetDiffRows(['Sales User'], []);
    expect(rows).toEqual([{ label: 'Sales User', hasA: true, hasB: false, isDifferent: true }]);
  });

  it('shows an item present only in the second list with hasA false', () => {
    const rows = buildSetDiffRows([], ['Marketing User']);
    expect(rows).toEqual([{ label: 'Marketing User', hasA: false, hasB: true, isDifferent: true }]);
  });

  it('sorts the union of both lists alphabetically, not matches-first-then-differences', () => {
    const rows = buildSetDiffRows(['Zeta', 'Alpha'], ['Beta']);
    expect(rows.map((row) => row.label)).toEqual(['Alpha', 'Beta', 'Zeta']);
  });

  it('returns an empty array when both lists are empty', () => {
    expect(buildSetDiffRows([], [])).toEqual([]);
    expect(buildSetDiffRows(undefined, undefined)).toEqual([]);
  });
});

describe('filterDifferentOnly', () => {
  const rows = [
    { label: 'A', isDifferent: false },
    { label: 'B', isDifferent: true }
  ];

  it('returns every row unchanged when showAll is true', () => {
    expect(filterDifferentOnly(rows, true)).toEqual(rows);
  });

  it('returns only the differing rows when showAll is false', () => {
    expect(filterDifferentOnly(rows, false)).toEqual([{ label: 'B', isDifferent: true }]);
  });
});
