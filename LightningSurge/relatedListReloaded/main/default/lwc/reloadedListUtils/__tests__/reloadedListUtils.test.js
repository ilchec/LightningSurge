// lightning/graphql isn't a real resolvable module outside the platform, and sfdx-lwc-jest's
// default stubs aren't guaranteed to cover it, so it's mocked explicitly and deterministically
// here: gql is treated as an identity template tag (just interpolates back to a plain string),
// which is enough to assert on the query/mutation text this file builds.
jest.mock(
  'lightning/graphql',
  () => ({
    gql: (strings, ...values) => strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '')
  }),
  { virtual: true }
);

import {
  buildDeleteMutation,
  buildFieldFilterCondition,
  buildListQuery,
  buildOrderByClause,
  buildWhereClause,
  escapeLikeValue,
  extractRecordFromNode,
  isFilterableFieldType,
  isSortableFieldType
} from 'c/reloadedListUtils';

describe('isFilterableFieldType / isSortableFieldType', () => {
  it('excludes only Reference', () => {
    expect(isFilterableFieldType('Reference')).toBe(false);
    expect(isSortableFieldType('Reference')).toBe(false);
    ['String', 'Int', 'Double', 'Boolean', 'Date', 'DateTime', 'Picklist', 'Currency'].forEach((type) => {
      expect(isFilterableFieldType(type)).toBe(true);
      expect(isSortableFieldType(type)).toBe(true);
    });
  });
});

describe('escapeLikeValue', () => {
  it('escapes %, _, and backslash so they match literally', () => {
    expect(escapeLikeValue('50%_done\\')).toBe('50\\%\\_done\\\\');
  });
});

describe('buildFieldFilterCondition', () => {
  it('returns null for Reference fields regardless of value', () => {
    expect(buildFieldFilterCondition('AccountId', 'Reference', 'Acme')).toBeNull();
  });

  it('returns null for blank/whitespace-only values', () => {
    expect(buildFieldFilterCondition('Name', 'String', '')).toBeNull();
    expect(buildFieldFilterCondition('Name', 'String', '   ')).toBeNull();
    expect(buildFieldFilterCondition('Name', 'String', null)).toBeNull();
  });

  it('builds a like condition for text-ish types, wrapped and escaped', () => {
    // The LIKE-pattern escape ("%" -> "\%") itself then goes through GraphQL string-literal
    // escaping, which doubles that backslash - "\\%" in the GraphQL source decodes to the single
    // "\%" the LIKE operator actually needs to see.
    expect(buildFieldFilterCondition('Email', 'String', 'ac%me')).toBe('{ Email: { like: "%ac\\\\%me%" } }');
  });

  it('builds an eq condition with a raw numeric literal for numeric types', () => {
    expect(buildFieldFilterCondition('Amount', 'Currency', '500')).toBe('{ Amount: { eq: 500 } }');
  });

  it('returns null for an unparseable numeric value instead of emitting NaN', () => {
    expect(buildFieldFilterCondition('Amount', 'Currency', 'not a number')).toBeNull();
  });

  it('builds an eq condition with a quoted literal for Date/DateTime', () => {
    expect(buildFieldFilterCondition('CloseDate', 'Date', '2024-01-15')).toBe('{ CloseDate: { eq: "2024-01-15" } }');
  });

  it('builds an eq condition with a bare true/false literal for Boolean', () => {
    expect(buildFieldFilterCondition('IsActive', 'Boolean', 'true')).toBe('{ IsActive: { eq: true } }');
    expect(buildFieldFilterCondition('IsActive', 'Boolean', 'false')).toBe('{ IsActive: { eq: false } }');
  });
});

describe('buildWhereClause', () => {
  it('returns just the parent condition when there are no active column filters', () => {
    expect(buildWhereClause('AccountId', '001000000000001AAA', [])).toBe('{ AccountId: { eq: "001000000000001AAA" } }');
  });

  it('ANDs the parent condition with one active column filter', () => {
    const clause = buildWhereClause('AccountId', '001000000000001AAA', [{ fieldApiName: 'Email', dataType: 'String', value: 'acme' }]);
    expect(clause).toBe('{ and: [{ AccountId: { eq: "001000000000001AAA" } }, { Email: { like: "%acme%" } }] }');
  });

  it('skips filters with blank values or Reference types, keeping only the parent condition if nothing else qualifies', () => {
    const clause = buildWhereClause('AccountId', '001000000000001AAA', [
      { fieldApiName: 'Email', dataType: 'String', value: '' },
      { fieldApiName: 'Owner', dataType: 'Reference', value: 'Jane' }
    ]);
    expect(clause).toBe('{ AccountId: { eq: "001000000000001AAA" } }');
  });

  it('ANDs the parent condition with multiple active column filters', () => {
    const clause = buildWhereClause('AccountId', '001000000000001AAA', [
      { fieldApiName: 'Email', dataType: 'String', value: 'acme' },
      { fieldApiName: 'Amount', dataType: 'Currency', value: '100' }
    ]);
    expect(clause).toBe(
      '{ and: [{ AccountId: { eq: "001000000000001AAA" } }, { Email: { like: "%acme%" } }, { Amount: { eq: 100 } }] }'
    );
  });
});

describe('buildOrderByClause', () => {
  it('returns an empty string when there is no sort field', () => {
    expect(buildOrderByClause(undefined, 'asc')).toBe('');
    expect(buildOrderByClause('', 'asc')).toBe('');
  });

  it('builds an orderBy fragment with the direction upper-cased', () => {
    expect(buildOrderByClause('LastName', 'desc')).toBe(', orderBy: { LastName: { order: DESC } }');
  });
});

describe('buildListQuery', () => {
  it('embeds the object name, fields, where clause, orderBy, and pagination params in the query text', () => {
    const query = buildListQuery({
      childObjectApiName: 'Contact',
      parentFieldApiName: 'AccountId',
      parentRecordId: '001000000000001AAA',
      fieldApiNames: ['Name', 'Email'],
      columnFilters: [{ fieldApiName: 'Email', dataType: 'String', value: 'acme' }],
      sortField: 'Name',
      sortDirection: 'asc',
      pageSize: 15,
      afterCursor: 'CURSOR123'
    });
    expect(query).toContain('Contact(first: 15, after: "CURSOR123", where:');
    expect(query).toContain('AccountId: { eq: "001000000000001AAA" }');
    expect(query).toContain('Email: { like: "%acme%" }');
    expect(query).toContain('orderBy: { Name: { order: ASC } }');
    expect(query).toContain('Name { value displayValue }');
    expect(query).toContain('Email { value displayValue }');
    expect(query).toContain('totalCount');
    expect(query).toContain('hasNextPage');
    expect(query).toContain('endCursor');
  });

  it('omits the after param when there is no cursor', () => {
    const query = buildListQuery({
      childObjectApiName: 'Contact',
      parentFieldApiName: 'AccountId',
      parentRecordId: '001000000000001AAA',
      fieldApiNames: ['Name'],
      columnFilters: [],
      pageSize: 4
    });
    expect(query).toContain('Contact(first: 4, where:');
    expect(query).not.toContain('after:');
  });
});

describe('buildDeleteMutation', () => {
  it('builds a delete mutation for the given object and record', () => {
    const mutation = buildDeleteMutation('Contact', '003000000000001AAA');
    expect(mutation).toContain('ContactDelete(input: { Id: "003000000000001AAA" })');
  });
});

describe('extractRecordFromNode', () => {
  it('prefers the formatted displayValue over the raw value for non-Boolean fields, so dates/currency/etc. render formatted', () => {
    const node = {
      Id: '003000000000001AAA',
      Name: { value: 'Jane Doe', displayValue: 'Jane Doe' },
      Amount: { value: 100.5, displayValue: '$100.50' },
      CloseDate: { value: '2024-01-15', displayValue: '1/15/2024' }
    };
    const record = extractRecordFromNode(node, ['Name', 'Amount', 'CloseDate'], {
      Name: 'String',
      Amount: 'Currency',
      CloseDate: 'Date'
    });
    expect(record).toEqual({ Id: '003000000000001AAA', Name: 'Jane Doe', Amount: '$100.50', CloseDate: '1/15/2024' });
  });

  it('falls back to the raw value when a field has no displayValue', () => {
    const node = { Id: '003000000000001AAA', Name: { value: 'Jane Doe' } };
    const record = extractRecordFromNode(node, ['Name'], { Name: 'String' });
    expect(record.Name).toBe('Jane Doe');
  });

  it('keeps the raw true/false for Boolean fields instead of using displayValue, so the caller can render a checkbox/cross icon', () => {
    const node = {
      Id: '003000000000001AAA',
      IsActive: { value: true, displayValue: null },
      IsArchived: { value: false, displayValue: null }
    };
    const record = extractRecordFromNode(node, ['IsActive', 'IsArchived'], { IsActive: 'Boolean', IsArchived: 'Boolean' });
    expect(record.IsActive).toBe(true);
    expect(record.IsArchived).toBe(false);
  });

  it('defaults a missing Boolean value to false rather than undefined', () => {
    const node = { Id: '003000000000001AAA', IsActive: undefined };
    const record = extractRecordFromNode(node, ['IsActive'], { IsActive: 'Boolean' });
    expect(record.IsActive).toBe(false);
  });
});
