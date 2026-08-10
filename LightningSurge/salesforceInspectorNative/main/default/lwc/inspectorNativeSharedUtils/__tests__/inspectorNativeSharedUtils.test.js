import { buildFieldModelForEdit, serializeGqlValue } from 'c/inspectorNativeSharedUtils';

describe('serializeGqlValue', () => {
  it('serializes null/undefined/empty-string values as the null literal', () => {
    expect(serializeGqlValue('Text', null)).toBe('null');
    expect(serializeGqlValue('Text', undefined)).toBe('null');
    expect(serializeGqlValue('Text', '')).toBe('null');
  });

  it('serializes booleans', () => {
    expect(serializeGqlValue('Boolean', true)).toBe('true');
    expect(serializeGqlValue('Boolean', false)).toBe('false');
  });

  it('serializes numeric types', () => {
    expect(serializeGqlValue('Double', 19.5)).toBe('19.5');
    expect(serializeGqlValue('Int', '42')).toBe('42');
    expect(serializeGqlValue('Currency', 100)).toBe('100');
  });

  it('falls back to the null literal instead of emitting a bare NaN for an unparseable numeric value', () => {
    expect(serializeGqlValue('Double', 'not a number')).toBe('null');
    expect(serializeGqlValue('Currency', '$1,200')).toBe('null');
  });

  it('quotes and escapes string values', () => {
    expect(serializeGqlValue('Text', 'Acme')).toBe('"Acme"');
    expect(serializeGqlValue('Text', 'Say "Hi"')).toBe('"Say \\"Hi\\""');
    expect(serializeGqlValue('Text', 'back\\slash')).toBe('"back\\\\slash"');
  });
});

describe('buildFieldModelForEdit', () => {
  const objectInfo = {
    fields: {
      Name: { label: 'Account Name', dataType: 'String', required: true, createable: true, updateable: true },
      // Createable but not updateable - e.g. a field only settable at creation.
      RecordSource: { label: 'Record Source', dataType: 'Picklist', required: false, createable: true, updateable: false },
      // Updateable but not createable - the inverse case, still a real combination in UI API metadata.
      Rating: { label: 'Rating', dataType: 'Picklist', required: false, createable: false, updateable: true }
    }
  };

  it('bases editable on updateable, not createable', () => {
    expect(buildFieldModelForEdit('Name', objectInfo, {}, {}).editable).toBe(true);
    expect(buildFieldModelForEdit('RecordSource', objectInfo, {}, {}).editable).toBe(false);
    expect(buildFieldModelForEdit('Rating', objectInfo, {}, {}).editable).toBe(true);
  });

  it('carries through label, required, and the current value', () => {
    const model = buildFieldModelForEdit('Name', objectInfo, { Name: 'Acme' }, {});
    expect(model).toMatchObject({ apiName: 'Name', label: 'Account Name', required: true, value: 'Acme' });
  });

  it('returns null for a field not present in objectInfo', () => {
    expect(buildFieldModelForEdit('NotAField', objectInfo, {}, {})).toBeNull();
  });
});
