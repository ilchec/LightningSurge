import { appendNewValue, filterPicklistFields, isDuplicatePicklistValue, moveValue, toggleValueActive } from 'c/inspectorNativePicklistManagerUtils';

function buildFakeObjectInfo() {
  return {
    fields: {
      Status__c: { label: 'Status', dataType: 'Picklist', custom: true },
      Priority: { label: 'Priority', dataType: 'Picklist', custom: false },
      Description__c: { label: 'Description', dataType: 'String', custom: true },
      Category__c: { label: 'Category', dataType: 'Picklist', custom: true }
    }
  };
}

describe('filterPicklistFields', () => {
  it('keeps only custom Picklist fields, sorted by label', () => {
    const fields = filterPicklistFields(buildFakeObjectInfo());
    expect(fields.map((field) => field.apiName)).toEqual(['Category__c', 'Status__c']);
  });

  it('excludes standard picklist fields', () => {
    const fields = filterPicklistFields(buildFakeObjectInfo());
    expect(fields.find((field) => field.apiName === 'Priority')).toBeUndefined();
  });

  it('excludes custom fields that are not picklists', () => {
    const fields = filterPicklistFields(buildFakeObjectInfo());
    expect(fields.find((field) => field.apiName === 'Description__c')).toBeUndefined();
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(filterPicklistFields({})).toEqual([]);
    expect(filterPicklistFields(undefined)).toEqual([]);
  });
});

describe('isDuplicatePicklistValue', () => {
  const values = [{ value: 'Open' }, { value: 'Closed' }];

  it('matches case-insensitively', () => {
    expect(isDuplicatePicklistValue(values, 'open')).toBe(true);
    expect(isDuplicatePicklistValue(values, 'OPEN')).toBe(true);
  });

  it('matches after trimming whitespace', () => {
    expect(isDuplicatePicklistValue(values, '  Closed  ')).toBe(true);
  });

  it('returns false for a genuinely new value', () => {
    expect(isDuplicatePicklistValue(values, 'Escalated')).toBe(false);
  });

  it('returns false for blank input', () => {
    expect(isDuplicatePicklistValue(values, '')).toBe(false);
    expect(isDuplicatePicklistValue(values, '   ')).toBe(false);
  });
});

describe('toggleValueActive', () => {
  it('flips only the targeted entry, leaving the rest and their order untouched', () => {
    const values = [
      { value: 'Open', isActive: true },
      { value: 'Closed', isActive: false }
    ];
    const toggled = toggleValueActive(values, 1);
    expect(toggled[0]).toEqual(values[0]);
    expect(toggled[1].isActive).toBe(true);
    expect(toggled.map((v) => v.value)).toEqual(['Open', 'Closed']);
  });

  it('does not mutate the original array', () => {
    const values = [{ value: 'Open', isActive: true }];
    toggleValueActive(values, 0);
    expect(values[0].isActive).toBe(true);
  });
});

describe('appendNewValue', () => {
  it('appends a new, active, non-default entry to the end', () => {
    const values = [{ value: 'Open', isActive: true, isDefault: true }];
    const updated = appendNewValue(values, 'Escalated');
    expect(updated).toHaveLength(2);
    expect(updated[1]).toEqual({ value: 'Escalated', label: 'Escalated', isActive: true, isDefault: false });
  });

  it('trims surrounding whitespace', () => {
    const updated = appendNewValue([], '  Escalated  ');
    expect(updated[0].value).toBe('Escalated');
  });

  it('is a no-op for blank input', () => {
    const values = [{ value: 'Open' }];
    expect(appendNewValue(values, '')).toBe(values);
    expect(appendNewValue(values, '   ')).toBe(values);
  });

  it('does not mutate the original array', () => {
    const values = [{ value: 'Open' }];
    appendNewValue(values, 'Closed');
    expect(values).toHaveLength(1);
  });
});

describe('moveValue', () => {
  const values = [{ value: 'A' }, { value: 'B' }, { value: 'C' }];

  it('swaps a value with its previous neighbor when moving up', () => {
    const moved = moveValue(values, 1, -1);
    expect(moved.map((v) => v.value)).toEqual(['B', 'A', 'C']);
  });

  it('swaps a value with its next neighbor when moving down', () => {
    const moved = moveValue(values, 1, 1);
    expect(moved.map((v) => v.value)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first value up', () => {
    expect(moveValue(values, 0, -1)).toBe(values);
  });

  it('is a no-op when moving the last value down', () => {
    expect(moveValue(values, 2, 1)).toBe(values);
  });

  it('does not mutate the original array', () => {
    moveValue(values, 1, -1);
    expect(values.map((v) => v.value)).toEqual(['A', 'B', 'C']);
  });
});
