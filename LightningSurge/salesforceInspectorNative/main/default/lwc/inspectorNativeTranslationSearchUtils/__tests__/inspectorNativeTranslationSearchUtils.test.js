import { buildResultSetupUrl, groupResultsByType } from 'c/inspectorNativeTranslationSearchUtils';

describe('groupResultsByType', () => {
  it('groups results into one section per itemType, sorted by type', () => {
    const results = [
      { itemType: 'Field', matchedText: 'Zeta Field' },
      { itemType: 'Custom Label', matchedText: 'Some Label' },
      { itemType: 'Field', matchedText: 'Alpha Field' }
    ];
    const grouped = groupResultsByType(results);
    expect(grouped.map((section) => section.itemType)).toEqual(['Custom Label', 'Field']);
    expect(grouped[1].items.map((item) => item.matchedText)).toEqual(['Alpha Field', 'Zeta Field']);
    expect(grouped[1].count).toBe(2);
  });

  it('sorts items within a section by matchedText', () => {
    const results = [
      { itemType: 'Object', matchedText: 'Zebra Object' },
      { itemType: 'Object', matchedText: 'Apple Object' }
    ];
    const grouped = groupResultsByType(results);
    expect(grouped[0].items.map((item) => item.matchedText)).toEqual(['Apple Object', 'Zebra Object']);
  });

  it('returns an empty array for empty/missing input', () => {
    expect(groupResultsByType([])).toEqual([]);
    expect(groupResultsByType(undefined)).toEqual([]);
  });
});

describe('buildResultSetupUrl', () => {
  it('builds a raw record-Id link to the label\'s own detail page for a Custom Label match', () => {
    const url = buildResultSetupUrl({ itemType: 'Custom Label', labelId: '01e000000000001AAA' });
    expect(url).toBe('/01e000000000001AAA');
  });

  it('returns undefined for a Custom Label match with no labelId', () => {
    expect(buildResultSetupUrl({ itemType: 'Custom Label', labelName: 'My_Label' })).toBeUndefined();
  });

  it('builds the object detail Setup URL for an Object match', () => {
    const url = buildResultSetupUrl({ itemType: 'Object', objectApiName: 'My_Object__c' });
    expect(url).toBe('/lightning/setup/ObjectManager/My_Object__c/Details/view');
  });

  it('returns undefined for an Object match with no objectApiName', () => {
    expect(buildResultSetupUrl({ itemType: 'Object' })).toBeUndefined();
  });

  it('links a Field match to Translation Workbench, not the field\'s own Setup detail page', () => {
    const url = buildResultSetupUrl({ itemType: 'Field', objectApiName: 'Account', fieldApiName: 'My_Field__c' });
    expect(url).toBe('/lightning/setup/LabelWorkbenchTranslate/home');
  });

  it('links a Picklist Value match to Translation Workbench too, same as Field', () => {
    const url = buildResultSetupUrl({ itemType: 'Picklist Value', objectApiName: 'Opportunity', fieldApiName: 'StageName' });
    expect(url).toBe('/lightning/setup/LabelWorkbenchTranslate/home');
  });

  it('returns undefined for missing input', () => {
    expect(buildResultSetupUrl(undefined)).toBeUndefined();
  });
});
