import { buildFieldRows, buildFieldSetupUrl, filterFieldRows } from 'c/inspectorNativeSchemaExplorerUtils';

function buildFakeObjectInfo() {
  return {
    fields: {
      Name: { label: 'Account Name', dataType: 'String', required: true, unique: false, externalId: false, createable: true, updateable: true, custom: false },
      AccountNumber__c: {
        label: 'Account Number',
        dataType: 'String',
        required: false,
        unique: true,
        externalId: true,
        createable: true,
        updateable: true,
        custom: true
      },
      OwnerId: {
        label: 'Owner ID',
        dataType: 'Reference',
        required: true,
        unique: false,
        externalId: false,
        createable: true,
        updateable: true,
        custom: false,
        referenceToInfos: [{ apiName: 'User' }, { apiName: 'Group' }]
      }
    }
  };
}

describe('buildFieldRows', () => {
  it('builds one row per field, sorted by label', () => {
    const rows = buildFieldRows(buildFakeObjectInfo());
    // "Account Name" sorts before "Account Number" before "Owner ID".
    expect(rows.map((row) => row.apiName)).toEqual(['Name', 'AccountNumber__c', 'OwnerId']);
  });

  it('carries through required/unique/externalId/createable/updateable/custom as booleans', () => {
    const rows = buildFieldRows(buildFakeObjectInfo());
    const accountNumber = rows.find((row) => row.apiName === 'AccountNumber__c');
    expect(accountNumber).toMatchObject({ required: false, unique: true, externalId: true, createable: true, updateable: true, custom: true });
  });

  it('joins referenceToInfos into a comma-separated referenceTo string', () => {
    const rows = buildFieldRows(buildFakeObjectInfo());
    const owner = rows.find((row) => row.apiName === 'OwnerId');
    expect(owner.referenceTo).toBe('User, Group');
  });

  it('leaves referenceTo blank for a non-reference field', () => {
    const rows = buildFieldRows(buildFakeObjectInfo());
    const name = rows.find((row) => row.apiName === 'Name');
    expect(name.referenceTo).toBe('');
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(buildFieldRows({})).toEqual([]);
    expect(buildFieldRows(undefined)).toEqual([]);
  });
});

describe('filterFieldRows', () => {
  const rows = buildFieldRows(buildFakeObjectInfo());

  it('returns every row when the search term is blank', () => {
    expect(filterFieldRows(rows, '')).toHaveLength(3);
    expect(filterFieldRows(rows, '   ')).toHaveLength(3);
  });

  it('matches case-insensitively against the label', () => {
    const matched = filterFieldRows(rows, 'account name');
    expect(matched.map((row) => row.apiName)).toEqual(['Name']);
  });

  it('matches against the API name too', () => {
    const matched = filterFieldRows(rows, 'ownerid');
    expect(matched.map((row) => row.apiName)).toEqual(['OwnerId']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterFieldRows(rows, 'nope')).toEqual([]);
  });
});

describe('buildFieldSetupUrl', () => {
  it('builds the Object Manager field detail URL from plain object/field API names', () => {
    expect(buildFieldSetupUrl('Account', 'AccountNumber__c')).toBe('/lightning/setup/ObjectManager/Account/FieldsAndRelationships/AccountNumber__c/view');
  });
});
