jest.mock(
  'lightning/graphql',
  () => ({
    gql: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
  }),
  { virtual: true }
);

import { buildExportableFieldOptions, buildExportQuery, extractExportRows } from 'c/inspectorNativeDataExportUtils';

describe('buildExportableFieldOptions', () => {
  it('builds label/value options sorted by label', () => {
    const objectInfo = {
      fields: {
        Name: { label: 'Account Name' },
        Phone: { label: 'Phone' }
      }
    };
    expect(buildExportableFieldOptions(objectInfo)).toEqual([
      { label: 'Account Name', value: 'Name' },
      { label: 'Phone', value: 'Phone' }
    ]);
  });

  it('excludes top-level compound fields', () => {
    const objectInfo = {
      fields: {
        Name: { label: 'Full Name', compound: true },
        FirstName: { label: 'First Name' },
        LastName: { label: 'Last Name' }
      }
    };
    const options = buildExportableFieldOptions(objectInfo);
    expect(options.map((option) => option.value)).toEqual(['FirstName', 'LastName']);
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(buildExportableFieldOptions({})).toEqual([]);
  });
});

describe('buildExportQuery', () => {
  it('always queries Id as a bare field, even when fieldApiNames includes it', () => {
    const query = buildExportQuery({ objectApiName: 'Account', fieldApiNames: ['Id', 'Name'], pageSize: 200 });
    expect(query).toContain('node {\n              Id\n              Name { value }');
  });

  it('omits the after param on the first page', () => {
    const query = buildExportQuery({ objectApiName: 'Account', fieldApiNames: ['Name'], pageSize: 200 });
    expect(query).toContain('Account(first: 200, orderBy: { Id: { order: ASC } })');
  });

  it('includes the after cursor on later pages', () => {
    const query = buildExportQuery({ objectApiName: 'Account', fieldApiNames: ['Name'], pageSize: 200, afterCursor: 'CURSOR123' });
    expect(query).toContain('Account(first: 200, after: "CURSOR123", orderBy: { Id: { order: ASC } })');
  });
});

describe('extractExportRows', () => {
  it('extracts Id plus every requested field\'s raw value', () => {
    const data = {
      uiapi: {
        query: {
          Account: {
            edges: [{ node: { Id: '001x1', Name: { value: 'Acme' }, Phone: { value: '555-1234' } } }],
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    };
    const { rows, totalCount, pageInfo } = extractExportRows(data, 'Account', ['Name', 'Phone']);
    expect(rows).toEqual([{ Id: '001x1', Name: 'Acme', Phone: '555-1234' }]);
    expect(totalCount).toBe(1);
    expect(pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });

  it('renders a missing field value as null rather than throwing', () => {
    const data = {
      uiapi: { query: { Account: { edges: [{ node: { Id: '001x1', Name: null } }], totalCount: 1, pageInfo: {} } } }
    };
    const { rows } = extractExportRows(data, 'Account', ['Name']);
    expect(rows[0].Name).toBeNull();
  });

  it('returns empty rows and zero totalCount when the object key is missing', () => {
    const { rows, totalCount } = extractExportRows({ uiapi: { query: {} } }, 'Account', ['Name']);
    expect(rows).toEqual([]);
    expect(totalCount).toBe(0);
  });
});
