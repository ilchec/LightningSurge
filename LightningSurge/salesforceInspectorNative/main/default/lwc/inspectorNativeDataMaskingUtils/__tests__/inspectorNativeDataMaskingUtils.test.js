import {
  buildFilterCondition,
  buildMaskingColumns,
  buildMaskingRows,
  buildMaskingSoql,
  buildMatchedIdMap,
  buildPreviewRows,
  escapeSoqlLikeValue,
  escapeSoqlValue,
  filterableFieldOptions,
  filterMaskableFields,
  generateMaskedValue,
  isContainsEligible
} from 'c/inspectorNativeDataMaskingUtils';

describe('filterMaskableFields', () => {
  it('keeps only updateable String/TextArea/Email/Phone fields, sorted by label', () => {
    const objectInfo = {
      fields: {
        Email: { label: 'Email', dataType: 'Email', updateable: true },
        Name: { label: 'Name', dataType: 'String', updateable: false },
        Description: { label: 'Description', dataType: 'TextArea', updateable: true },
        AnnualRevenue: { label: 'Annual Revenue', dataType: 'Currency', updateable: true },
        Phone: { label: 'Phone', dataType: 'Phone', updateable: true }
      }
    };
    const fields = filterMaskableFields(objectInfo);
    expect(fields.map((field) => field.apiName)).toEqual(['Description', 'Email', 'Phone']);
  });

  it('excludes non-updateable fields even if the type is otherwise eligible', () => {
    const objectInfo = { fields: { Name: { label: 'Name', dataType: 'String', updateable: false } } };
    expect(filterMaskableFields(objectInfo)).toEqual([]);
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(filterMaskableFields({})).toEqual([]);
    expect(filterMaskableFields(undefined)).toEqual([]);
  });
});

describe('filterableFieldOptions', () => {
  it('offers most field types, sorted by label', () => {
    const objectInfo = {
      fields: {
        Status__c: { label: 'Status', dataType: 'Picklist' },
        AnnualRevenue: { label: 'Annual Revenue', dataType: 'Currency' },
        IsActive: { label: 'Is Active', dataType: 'Boolean' }
      }
    };
    const options = filterableFieldOptions(objectInfo);
    expect(options.map((field) => field.apiName)).toEqual(['AnnualRevenue', 'IsActive', 'Status__c']);
  });

  it('excludes types with no safe/correct SOQL literal form here (DateTime, compound, encrypted, multi-select)', () => {
    const objectInfo = {
      fields: {
        CreatedDate: { label: 'Created Date', dataType: 'DateTime' },
        ShippingAddress: { label: 'Shipping Address', dataType: 'Address' },
        Location__c: { label: 'Location', dataType: 'Location' },
        Attachment__c: { label: 'Attachment', dataType: 'Base64' },
        SSN__c: { label: 'SSN', dataType: 'EncryptedString' },
        Interests__c: { label: 'Interests', dataType: 'MultiPicklist' }
      }
    };
    expect(filterableFieldOptions(objectInfo)).toEqual([]);
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(filterableFieldOptions({})).toEqual([]);
    expect(filterableFieldOptions(undefined)).toEqual([]);
  });
});

describe('isContainsEligible', () => {
  it('is eligible for text-ish types', () => {
    expect(isContainsEligible('String')).toBe(true);
    expect(isContainsEligible('Picklist')).toBe(true);
    expect(isContainsEligible('Reference')).toBe(true);
  });

  it('is not eligible for numeric, Boolean, or Date types', () => {
    expect(isContainsEligible('Double')).toBe(false);
    expect(isContainsEligible('Currency')).toBe(false);
    expect(isContainsEligible('Boolean')).toBe(false);
    expect(isContainsEligible('Date')).toBe(false);
  });
});

describe('escapeSoqlValue', () => {
  it('escapes a single quote so it cannot break out of the SOQL string literal', () => {
    expect(escapeSoqlValue("O'Brien")).toBe("O\\'Brien");
  });

  it('escapes a backslash before escaping quotes, so an existing backslash cannot neutralize the quote escape', () => {
    expect(escapeSoqlValue('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves an ordinary value untouched', () => {
    expect(escapeSoqlValue('Acme Corp')).toBe('Acme Corp');
  });
});

describe('escapeSoqlLikeValue', () => {
  it('escapes LIKE wildcard characters so a literal % or _ is matched literally', () => {
    expect(escapeSoqlLikeValue('50% off_sale')).toBe('50\\% off\\_sale');
  });

  it('also applies standard quote escaping', () => {
    expect(escapeSoqlLikeValue("O'Brien")).toBe("O\\'Brien");
  });
});

describe('buildFilterCondition', () => {
  it('builds a quoted, escaped equals condition for a text field', () => {
    expect(buildFilterCondition({ fieldApiName: 'Name', dataType: 'String', operator: 'equals', value: "O'Brien" })).toBe("Name = 'O\\'Brien'");
  });

  it('builds a LIKE condition wrapped in wildcards for "contains"', () => {
    expect(buildFilterCondition({ fieldApiName: 'Name', dataType: 'String', operator: 'contains', value: 'corp' })).toBe("Name LIKE '%corp%'");
  });

  it('builds an unquoted true/false condition for Boolean fields', () => {
    expect(buildFilterCondition({ fieldApiName: 'IsActive', dataType: 'Boolean', operator: 'equals', value: 'true' })).toBe('IsActive = true');
    expect(buildFilterCondition({ fieldApiName: 'IsActive', dataType: 'Boolean', operator: 'equals', value: 'false' })).toBe('IsActive = false');
  });

  it('builds an unquoted numeric condition for numeric fields', () => {
    expect(buildFilterCondition({ fieldApiName: 'AnnualRevenue', dataType: 'Currency', operator: 'equals', value: '1000' })).toBe('AnnualRevenue = 1000');
  });

  it('falls back to null for a non-numeric value on a numeric field, rather than emitting invalid SOQL', () => {
    expect(buildFilterCondition({ fieldApiName: 'AnnualRevenue', dataType: 'Currency', operator: 'equals', value: 'not-a-number' })).toBe(
      'AnnualRevenue = null'
    );
  });

  it('builds an unquoted Date condition, passing a YYYY-MM-DD value through as-is', () => {
    expect(buildFilterCondition({ fieldApiName: 'CloseDate', dataType: 'Date', operator: 'equals', value: '2026-01-15' })).toBe('CloseDate = 2026-01-15');
  });

  // A Date literal is unquoted in SOQL, so it can't lean on escapeSoqlValue's quote-escaping the
  // way every other type does - this is the one branch that must independently reject anything
  // that isn't the exact expected shape, since an unvalidated value here would be a genuine
  // SOQL-injection path rather than just producing a query that fails to parse.
  it('falls back to null for a Date value that is not exactly YYYY-MM-DD, rather than passing it through unescaped', () => {
    expect(buildFilterCondition({ fieldApiName: 'CloseDate', dataType: 'Date', operator: 'equals', value: "2026-01-15 OR Id != null --" })).toBe(
      'CloseDate = null'
    );
    expect(buildFilterCondition({ fieldApiName: 'CloseDate', dataType: 'Date', operator: 'equals', value: 'not-a-date' })).toBe('CloseDate = null');
  });
});

describe('buildMaskingSoql', () => {
  it('builds a plain SELECT with Id first, the given fields, and a LIMIT when there are no filters', () => {
    expect(buildMaskingSoql('Contact', ['Email', 'Phone'], 50)).toBe('SELECT Id, Email, Phone FROM Contact LIMIT 50');
    expect(buildMaskingSoql('Contact', ['Email', 'Phone'], 50, [])).toBe('SELECT Id, Email, Phone FROM Contact LIMIT 50');
  });

  it('appends a WHERE clause built from the given filters, ANDed together', () => {
    const filters = [
      { fieldApiName: 'Status__c', dataType: 'String', operator: 'equals', value: 'Test' },
      { fieldApiName: 'IsActive', dataType: 'Boolean', operator: 'equals', value: 'true' }
    ];
    expect(buildMaskingSoql('Contact', ['Email'], 50, filters)).toBe("SELECT Id, Email FROM Contact WHERE Status__c = 'Test' AND IsActive = true LIMIT 50");
  });
});

describe('generateMaskedValue', () => {
  it('generates a fake email for Email fields', () => {
    expect(generateMaskedValue({ apiName: 'Email', dataType: 'Email' }, 3)).toBe('masked3@example.com');
  });

  it('generates a fake, zero-padded phone number for Phone fields', () => {
    expect(generateMaskedValue({ apiName: 'Phone', dataType: 'Phone' }, 3)).toBe('555-0103');
  });

  it('generates a fake name when the field API name contains "name"', () => {
    expect(generateMaskedValue({ apiName: 'LastName', dataType: 'String' }, 5)).toBe('Test User 5');
  });

  it('falls back to a generic masked value for other text fields', () => {
    expect(generateMaskedValue({ apiName: 'Description', dataType: 'TextArea' }, 5)).toBe('Masked Value 5');
  });

  it('produces distinct values for different row indexes', () => {
    const first = generateMaskedValue({ apiName: 'Email', dataType: 'Email' }, 1);
    const second = generateMaskedValue({ apiName: 'Email', dataType: 'Email' }, 2);
    expect(first).not.toBe(second);
  });
});

describe('buildPreviewRows', () => {
  const fields = [{ apiName: 'Email', label: 'Email', dataType: 'Email' }];
  const records = [
    { Id: '001000000000001', Email: 'real1@acme.com' },
    { Id: '001000000000002', Email: 'real2@acme.com' }
  ];

  it('pairs each record with one cell per field, carrying the original value through', () => {
    const rows = buildPreviewRows(records, fields);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('001000000000001');
    expect(rows[0].cells[0]).toMatchObject({ apiName: 'Email', original: 'real1@acme.com', masked: 'masked1@example.com' });
    expect(rows[1].cells[0].masked).toBe('masked2@example.com');
  });
});

describe('buildMaskingColumns', () => {
  it('maps fields to the { apiName, dataType, editable: true } shape buildUpsertMutation expects', () => {
    expect(buildMaskingColumns([{ apiName: 'Email', dataType: 'Email' }])).toEqual([{ apiName: 'Email', dataType: 'Email', editable: true }]);
  });
});

describe('buildMaskingRows', () => {
  it('maps preview rows to { clientId, values } keyed by apiName', () => {
    const previewRows = [{ id: '001', cells: [{ apiName: 'Email', masked: 'masked1@example.com' }] }];
    expect(buildMaskingRows(previewRows)).toEqual([{ clientId: '001', values: { Email: 'masked1@example.com' } }]);
  });
});

describe('buildMatchedIdMap', () => {
  it('maps every preview row Id to itself - always an update, never a create', () => {
    const previewRows = [{ id: '001' }, { id: '002' }];
    const map = buildMatchedIdMap(previewRows);
    expect(map.get('001')).toBe('001');
    expect(map.get('002')).toBe('002');
    expect(map.size).toBe(2);
  });
});
