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
  buildAllFieldsColumnGroups,
  buildColumnGroups,
  buildMatchQuery,
  buildRecordTypeQuery,
  buildRequiredFieldsColumnGroups,
  buildUpsertMutation,
  extractMatchedIds,
  extractRecordTypes,
  extractSaveResults,
  filterVisibleColumnGroups,
  flattenColumnGroups,
  isValidObjectApiName,
  resolveRecordTypeSelection
} from 'c/graphqlMultiRecordEntryUtils';

// Minimal fake UI API objectInfo for a Lead-like object: a required compound Name field
// (Salutation/FirstName/LastName, with only LastName individually required), a required text
// field, an optional text field, and a non-createable system field.
function buildFakeObjectInfo() {
  return {
    fields: {
      Salutation: { label: 'Salutation', dataType: 'Picklist', required: false, createable: true, compoundFieldName: 'Name' },
      FirstName: { label: 'First Name', dataType: 'String', required: false, createable: true, compoundFieldName: 'Name' },
      LastName: { label: 'Last Name', dataType: 'String', required: true, createable: true, compoundFieldName: 'Name' },
      Company: { label: 'Company', dataType: 'String', required: true, createable: true },
      Email: { label: 'Email', dataType: 'Email', required: false, createable: true },
      Id: { label: 'Lead ID', dataType: 'Id', required: false, createable: false }
    }
  };
}

describe('resolveRecordTypeSelection', () => {
  const availableRecordTypes = [
    { id: '012A', developerName: 'Standard_Lead' },
    { id: '012B', developerName: 'Partner_Lead' }
  ];

  it('prefers a directly-given recordTypeId over everything else', () => {
    const selection = resolveRecordTypeSelection({
      recordTypeId: '012C',
      showAllFields: true,
      requiredFieldsOnly: true,
      layoutDeveloperName: 'Partner_Lead',
      availableRecordTypes
    });
    expect(selection).toEqual({ mode: 'direct', recordTypeId: '012C' });
  });

  it('picks All Fields mode when showAllFields is set and no recordTypeId is given', () => {
    const selection = resolveRecordTypeSelection({ showAllFields: true, availableRecordTypes });
    expect(selection).toEqual({ mode: 'allFields', recordTypeId: null });
  });

  it('picks Required Only mode when requiredFieldsOnly is set (and showAllFields is not)', () => {
    const selection = resolveRecordTypeSelection({ requiredFieldsOnly: true, availableRecordTypes });
    expect(selection).toEqual({ mode: 'requiredOnly', recordTypeId: null });
  });

  it('showAllFields takes priority over requiredFieldsOnly when both are set', () => {
    const selection = resolveRecordTypeSelection({ showAllFields: true, requiredFieldsOnly: true, availableRecordTypes });
    expect(selection.mode).toBe('allFields');
  });

  it('resolves a matching layoutDeveloperName to that Record Type\'s id', () => {
    const selection = resolveRecordTypeSelection({ layoutDeveloperName: 'Partner_Lead', availableRecordTypes });
    expect(selection).toEqual({ mode: 'direct', recordTypeId: '012B' });
  });

  it('falls back to the picker when layoutDeveloperName matches nothing', () => {
    const selection = resolveRecordTypeSelection({ layoutDeveloperName: 'Nonexistent', availableRecordTypes });
    expect(selection).toEqual({ mode: 'picker', recordTypeId: null });
  });

  it('falls back to the picker when nothing at all was specified', () => {
    const selection = resolveRecordTypeSelection({ availableRecordTypes });
    expect(selection).toEqual({ mode: 'picker', recordTypeId: null });
  });

  it('falls back to the picker even with zero/one available Record Types, per the always-show-the-picker behavior', () => {
    expect(resolveRecordTypeSelection({ availableRecordTypes: [] })).toEqual({ mode: 'picker', recordTypeId: null });
    expect(resolveRecordTypeSelection({ availableRecordTypes: [availableRecordTypes[0]] })).toEqual({
      mode: 'picker',
      recordTypeId: null
    });
  });
});

describe('buildRequiredFieldsColumnGroups', () => {
  it('includes only required fields, plus siblings of any required compound field', () => {
    const groups = buildRequiredFieldsColumnGroups(buildFakeObjectInfo(), {});
    const apiNames = flattenColumnGroups(groups).map((c) => c.apiName);
    // LastName is required and part of Name -> pulls in Salutation/FirstName too.
    expect(apiNames.sort()).toEqual(['Company', 'FirstName', 'LastName', 'Salutation']);
    expect(apiNames).not.toContain('Email');
    expect(apiNames).not.toContain('Id'); // not createable
  });

  it('keeps compound siblings adjacent rather than scattering them by their own label', () => {
    const groups = buildRequiredFieldsColumnGroups(buildFakeObjectInfo(), {});
    const apiNames = flattenColumnGroups(groups).map((c) => c.apiName);
    const salutationIndex = apiNames.indexOf('Salutation');
    const firstNameIndex = apiNames.indexOf('FirstName');
    const lastNameIndex = apiNames.indexOf('LastName');
    // All three compound members must be contiguous (no other apiName between the min and max
    // index) - if they were scattered, this gap would be greater than 2.
    const indices = [salutationIndex, firstNameIndex, lastNameIndex];
    expect(Math.max(...indices) - Math.min(...indices)).toBe(2);
  });

  it('returns an empty array when nothing is required', () => {
    const objectInfo = { fields: { Optional: { label: 'Optional', dataType: 'String', required: false, createable: true } } };
    expect(buildRequiredFieldsColumnGroups(objectInfo, {})).toEqual([]);
  });
});

describe('buildAllFieldsColumnGroups', () => {
  it('includes every createable field and excludes non-createable ones', () => {
    const groups = buildAllFieldsColumnGroups(buildFakeObjectInfo(), {});
    const apiNames = flattenColumnGroups(groups).map((c) => c.apiName);
    expect(apiNames.sort()).toEqual(['Company', 'Email', 'FirstName', 'LastName', 'Salutation']);
    expect(apiNames).not.toContain('Id');
  });

  it('puts everything under a single "All Fields" group', () => {
    const groups = buildAllFieldsColumnGroups(buildFakeObjectInfo(), {});
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe('All Fields');
  });
});

describe('buildColumnGroups (layout-based)', () => {
  it('builds one group per section, using each layout item\'s field(s)', () => {
    const objectInfo = buildFakeObjectInfo();
    const layout = {
      sections: [
        {
          heading: 'Lead Information',
          layoutRows: [
            {
              layoutItems: [
                {
                  label: 'Name',
                  required: true,
                  editableForNew: true,
                  layoutComponents: [
                    { componentType: 'Field', apiName: 'Salutation' },
                    { componentType: 'Field', apiName: 'FirstName' },
                    { componentType: 'Field', apiName: 'LastName' }
                  ]
                },
                {
                  label: 'Company',
                  required: true,
                  editableForNew: true,
                  layoutComponents: [{ componentType: 'Field', apiName: 'Company' }]
                }
              ]
            }
          ]
        }
      ]
    };
    const groups = buildColumnGroups(layout, objectInfo, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe('Lead Information');
    expect(groups[0].columnCount).toBe(4);
    expect(flattenColumnGroups(groups).map((c) => c.apiName)).toEqual(['Salutation', 'FirstName', 'LastName', 'Company']);
  });

  it('drops sections that end up with no columns', () => {
    const objectInfo = buildFakeObjectInfo();
    const layout = { sections: [{ heading: 'Empty', layoutRows: [] }] };
    expect(buildColumnGroups(layout, objectInfo, {})).toEqual([]);
  });
});

describe('filterVisibleColumnGroups', () => {
  const groups = [
    {
      id: 'g1',
      heading: 'Group 1',
      columnCount: 2,
      columns: [{ apiName: 'A' }, { apiName: 'B' }]
    },
    {
      id: 'g2',
      heading: 'Group 2',
      columnCount: 1,
      columns: [{ apiName: 'C' }]
    }
  ];

  it('returns the groups unchanged when nothing is hidden', () => {
    expect(filterVisibleColumnGroups(groups, new Set())).toBe(groups);
    expect(filterVisibleColumnGroups(groups, null)).toBe(groups);
  });

  it('filters out hidden columns and recalculates columnCount', () => {
    const filtered = filterVisibleColumnGroups(groups, new Set(['B']));
    expect(filtered[0].columns.map((c) => c.apiName)).toEqual(['A']);
    expect(filtered[0].columnCount).toBe(1);
    expect(filtered[1]).toEqual(groups[1]);
  });

  it('drops a group entirely once all of its columns are hidden', () => {
    const filtered = filterVisibleColumnGroups(groups, new Set(['A', 'B']));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('g2');
  });
});

describe('extractSaveResults', () => {
  const rows = [{ clientId: 1 }, { clientId: 2 }];

  it('reports success with the created/updated record Id', () => {
    const result = {
      data: { uiapi: { row_1: { Record: { Id: '00Q1' } } } },
      errors: []
    };
    const [row1] = extractSaveResults(result, [rows[0]], new Map());
    expect(row1).toEqual({ clientId: 1, success: true, recordId: '00Q1', operation: 'create' });
  });

  it('tags a row as "update" when it was in the matched-id map', () => {
    const result = { data: { uiapi: { row_1: { Record: { Id: '00Q1' } } } }, errors: [] };
    const [row1] = extractSaveResults(result, [rows[0]], new Map([[1, '00Q1']]));
    expect(row1.operation).toBe('update');
  });

  it('correlates a GraphQL error back to its row via the alias in errors[].path', () => {
    const result = {
      data: { uiapi: {} },
      errors: [{ message: 'REQUIRED_FIELD_MISSING: Company', path: ['uiapi', 'row_2'] }]
    };
    const [, row2] = extractSaveResults(result, rows, new Map());
    expect(row2).toEqual({
      clientId: 2,
      success: false,
      errorMessage: 'REQUIRED_FIELD_MISSING: Company',
      operation: 'create'
    });
  });

  it('falls back to a generic message when no matching error is found', () => {
    const result = { data: { uiapi: {} }, errors: [] };
    const [row1] = extractSaveResults(result, [rows[0]], new Map());
    expect(row1.success).toBe(false);
    expect(row1.errorMessage).toBe('Unknown error saving this row');
  });
});

describe('extractMatchedIds', () => {
  const matchFieldApiNames = ['Email'];
  const rows = [
    { clientId: 1, values: { Email: 'a@b.com' } },
    { clientId: 2, values: { Email: 'c@d.com' } },
    { clientId: 3, values: { Email: '' } }
  ];

  it('maps a row to an existing record Id when its match value is found', () => {
    const result = {
      data: {
        uiapi: {
          query: {
            Lead: { edges: [{ node: { Id: '00Q1', Email: { value: 'a@b.com' } } }] }
          }
        }
      }
    };
    const matched = extractMatchedIds(result, 'Lead', matchFieldApiNames, rows);
    expect(matched.get(1)).toBe('00Q1');
    expect(matched.has(2)).toBe(false);
  });

  it('skips rows missing a value for any match field entirely', () => {
    const result = { data: { uiapi: { query: { Lead: { edges: [] } } } } };
    const matched = extractMatchedIds(result, 'Lead', matchFieldApiNames, rows);
    expect(matched.has(3)).toBe(false);
  });

  it('when multiple existing records share a match key, the first one wins', () => {
    const result = {
      data: {
        uiapi: {
          query: {
            Lead: {
              edges: [{ node: { Id: 'FIRST', Email: { value: 'a@b.com' } } }, { node: { Id: 'SECOND', Email: { value: 'a@b.com' } } }]
            }
          }
        }
      }
    };
    const matched = extractMatchedIds(result, 'Lead', matchFieldApiNames, rows);
    expect(matched.get(1)).toBe('FIRST');
  });
});

describe('extractRecordTypes', () => {
  it('extracts id/label/developerName per Record Type', () => {
    const result = {
      data: {
        uiapi: {
          query: {
            RecordType: {
              edges: [{ node: { Id: '012A', Name: { value: 'Standard Lead' }, DeveloperName: { value: 'Standard_Lead' } } }]
            }
          }
        }
      }
    };
    expect(extractRecordTypes(result)).toEqual([{ id: '012A', label: 'Standard Lead', developerName: 'Standard_Lead' }]);
  });

  it('returns an empty array when there are no edges', () => {
    expect(extractRecordTypes({ data: { uiapi: { query: { RecordType: { edges: [] } } } } })).toEqual([]);
    expect(extractRecordTypes({})).toEqual([]);
  });
});

describe('buildUpsertMutation', () => {
  const columns = [{ apiName: 'Company', dataType: 'String', editable: true }];

  it('builds a Create alias for a row with no matched Id', () => {
    const mutation = buildUpsertMutation('Lead', columns, [{ clientId: 1, values: { Company: 'Acme' } }], new Map());
    expect(mutation).toContain('row_1: LeadCreate(input: { Lead: { Company: "Acme" } })');
  });

  it('builds an Update alias for a row with a matched Id', () => {
    const matched = new Map([[1, '00Q1']]);
    const mutation = buildUpsertMutation('Lead', columns, [{ clientId: 1, values: { Company: 'Acme' } }], matched);
    expect(mutation).toContain('row_1: LeadUpdate(input: { Id: "00Q1", Lead: { Company: "Acme" } })');
  });
});

describe('buildMatchQuery', () => {
  it('returns null when no row has a value for every match field', () => {
    const columns = [{ apiName: 'Email', dataType: 'Email' }];
    expect(buildMatchQuery('Lead', ['Email'], columns, [{ clientId: 1, values: {} }])).toBeNull();
  });

  it('builds an eq filter for a single match field', () => {
    const columns = [{ apiName: 'Email', dataType: 'Email' }];
    const query = buildMatchQuery('Lead', ['Email'], columns, [{ clientId: 1, values: { Email: 'a@b.com' } }]);
    expect(query).toContain('Email: { eq: "a@b.com" }');
  });
});

describe('buildRecordTypeQuery', () => {
  it('filters by the given SobjectType and IsActive: true', () => {
    const query = buildRecordTypeQuery('Lead');
    expect(query).toContain('SobjectType: { eq: "Lead" }');
    expect(query).toContain('IsActive: { eq: true }');
  });
});

describe('isValidObjectApiName', () => {
  it('accepts standard and custom/packaged object API names', () => {
    ['Lead', 'Account', 'My_Custom_Object__c', 'my_namespace__Object__c'].forEach((name) => {
      expect(isValidObjectApiName(name)).toBe(true);
    });
  });

  it('rejects values that could alter GraphQL query structure when interpolated unescaped', () => {
    ['Lead" } }, { IsActive: { eq: true', 'Lead}', 'Lead Account', '', null, undefined, 123].forEach((name) => {
      expect(isValidObjectApiName(name)).toBe(false);
    });
  });
});
