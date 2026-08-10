import { serializeGqlValue } from 'c/graphqlMultiRecordEntrySharedUtils';

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
