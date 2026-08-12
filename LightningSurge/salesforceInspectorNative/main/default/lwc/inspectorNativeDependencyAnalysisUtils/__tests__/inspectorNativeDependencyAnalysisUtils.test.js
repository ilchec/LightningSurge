import { filterCustomFields, groupReferencesByType } from 'c/inspectorNativeDependencyAnalysisUtils';

describe('filterCustomFields', () => {
  it('keeps only custom fields, sorted by label, regardless of data type', () => {
    const objectInfo = {
      fields: {
        Name: { label: 'Account Name', custom: false },
        Status__c: { label: 'Status', custom: true },
        AccountNumber__c: { label: 'Account Number', custom: true }
      }
    };
    const fields = filterCustomFields(objectInfo);
    expect(fields.map((field) => field.apiName)).toEqual(['AccountNumber__c', 'Status__c']);
  });

  it('returns an empty array when objectInfo has no fields', () => {
    expect(filterCustomFields({})).toEqual([]);
    expect(filterCustomFields(undefined)).toEqual([]);
  });
});

describe('groupReferencesByType', () => {
  it('groups references by componentType, sections sorted by type, names sorted within a section', () => {
    const references = [
      { componentName: 'ZFlow', componentType: 'Flow' },
      { componentName: 'AApexClass', componentType: 'ApexClass' },
      { componentName: 'AFlow', componentType: 'Flow' }
    ];
    const grouped = groupReferencesByType(references);
    expect(grouped.map((section) => section.componentType)).toEqual(['ApexClass', 'Flow']);
    const flowSection = grouped.find((section) => section.componentType === 'Flow');
    expect(flowSection.componentNames).toEqual(['AFlow', 'ZFlow']);
    expect(flowSection.count).toBe(2);
  });

  it('groups an unlabeled component type under "Unknown"', () => {
    const grouped = groupReferencesByType([{ componentName: 'Mystery' }]);
    expect(grouped).toEqual([{ componentType: 'Unknown', componentNames: ['Mystery'], count: 1 }]);
  });

  it('returns an empty array for no references', () => {
    expect(groupReferencesByType([])).toEqual([]);
    expect(groupReferencesByType(undefined)).toEqual([]);
  });
});
