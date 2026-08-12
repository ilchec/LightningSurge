import {
  buildMaskingColumns,
  buildMaskingRows,
  buildMaskingSoql,
  buildMatchedIdMap,
  buildPreviewRows,
  filterMaskableFields,
  generateMaskedValue
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

describe('buildMaskingSoql', () => {
  it('builds a plain SELECT with Id first, the given fields, and a LIMIT', () => {
    expect(buildMaskingSoql('Contact', ['Email', 'Phone'], 50)).toBe('SELECT Id, Email, Phone FROM Contact LIMIT 50');
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
