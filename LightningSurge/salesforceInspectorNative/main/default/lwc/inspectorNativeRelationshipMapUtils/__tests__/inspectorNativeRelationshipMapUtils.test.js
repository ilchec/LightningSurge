import { buildChildRelationships, buildParentRelationships, limitRows } from 'c/inspectorNativeRelationshipMapUtils';

function buildFakeObjectInfo() {
  return {
    fields: {
      AccountId: {
        label: 'Account',
        dataType: 'Reference',
        referenceToInfos: [{ apiName: 'Account' }]
      },
      OwnerId: {
        label: 'Owner',
        dataType: 'Reference',
        referenceToInfos: [{ apiName: 'User' }, { apiName: 'Group' }]
      },
      Name: {
        label: 'Contact Name',
        dataType: 'String'
      }
    },
    childRelationships: [
      { childObjectApiName: 'Case', fieldName: 'ContactId', relationshipName: 'Cases' },
      { childObjectApiName: 'Opportunity', fieldName: 'ContactId', relationshipName: null },
      { childObjectApiName: null, fieldName: 'SomeId', relationshipName: 'Ignored' }
    ]
  };
}

describe('buildParentRelationships', () => {
  it('builds one row per Reference field, sorted by field label', () => {
    const rows = buildParentRelationships(buildFakeObjectInfo());
    expect(rows.map((row) => row.fieldApiName)).toEqual(['AccountId', 'OwnerId', 'OwnerId']);
  });

  it('splits a polymorphic field into one row per target object', () => {
    const rows = buildParentRelationships(buildFakeObjectInfo());
    const ownerRows = rows.filter((row) => row.fieldApiName === 'OwnerId');
    expect(ownerRows.map((row) => row.targetApiName)).toEqual(['User', 'Group']);
  });

  it('ignores non-Reference fields', () => {
    const rows = buildParentRelationships(buildFakeObjectInfo());
    expect(rows.some((row) => row.fieldApiName === 'Name')).toBe(false);
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(buildParentRelationships({})).toEqual([]);
  });
});

describe('buildChildRelationships', () => {
  it('builds one row per child relationship with a childObjectApiName, sorted by child object', () => {
    const rows = buildChildRelationships(buildFakeObjectInfo());
    expect(rows.map((row) => row.childObjectApiName)).toEqual(['Case', 'Opportunity']);
  });

  it('drops a relationship with no childObjectApiName', () => {
    const rows = buildChildRelationships(buildFakeObjectInfo());
    expect(rows.some((row) => row.fieldApiName === 'SomeId')).toBe(false);
  });

  it('falls back to "(unnamed)" when relationshipName is blank', () => {
    const rows = buildChildRelationships(buildFakeObjectInfo());
    const opportunityRow = rows.find((row) => row.childObjectApiName === 'Opportunity');
    expect(opportunityRow.relationshipName).toBe('(unnamed)');
  });

  it('returns an empty array when objectInfo has no childRelationships', () => {
    expect(buildChildRelationships({})).toEqual([]);
  });
});

describe('limitRows', () => {
  it('returns every row and a zero hiddenCount when under the cap', () => {
    const result = limitRows([1, 2, 3], 5);
    expect(result).toEqual({ visible: [1, 2, 3], hiddenCount: 0 });
  });

  it('truncates to the cap and reports how many were hidden', () => {
    const result = limitRows([1, 2, 3, 4, 5], 2);
    expect(result).toEqual({ visible: [1, 2], hiddenCount: 3 });
  });
});
