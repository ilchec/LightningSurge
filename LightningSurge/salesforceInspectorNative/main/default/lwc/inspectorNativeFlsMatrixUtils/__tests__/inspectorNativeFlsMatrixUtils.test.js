import {
  buildDirtyGrantList,
  buildGrantKey,
  buildGrantStateMap,
  buildMatrixRows,
  toggleCellState
} from 'c/inspectorNativeFlsMatrixUtils';

describe('buildGrantStateMap', () => {
  it('keys existing grants by field+permissionSet', () => {
    const map = buildGrantStateMap([{ fieldApiName: 'Phone', permissionSetId: '0PS1', readAccess: true, editAccess: false }]);
    expect(map.get(buildGrantKey('Phone', '0PS1'))).toEqual({ readAccess: true, editAccess: false });
  });

  it('returns an empty map when given no grants', () => {
    expect(buildGrantStateMap(undefined).size).toBe(0);
    expect(buildGrantStateMap([]).size).toBe(0);
  });
});

describe('buildMatrixRows', () => {
  const fields = [{ apiName: 'Phone', label: 'Phone' }];
  const permissionSets = [{ id: '0PS1', label: 'Set One' }];

  it('defaults an untouched cell to no access', () => {
    const rows = buildMatrixRows(fields, permissionSets, new Map(), new Map());
    expect(rows[0].cells[0]).toMatchObject({ readAccess: false, editAccess: false, isDirty: false });
  });

  it('reflects existing server state when there is no unsaved edit', () => {
    const grantStateByKey = buildGrantStateMap([{ fieldApiName: 'Phone', permissionSetId: '0PS1', readAccess: true, editAccess: true }]);
    const rows = buildMatrixRows(fields, permissionSets, grantStateByKey, new Map());
    expect(rows[0].cells[0]).toMatchObject({ readAccess: true, editAccess: true, isDirty: false });
  });

  it('an unsaved edit overrides server state and marks the cell dirty', () => {
    const grantStateByKey = buildGrantStateMap([{ fieldApiName: 'Phone', permissionSetId: '0PS1', readAccess: true, editAccess: true }]);
    const dirtyStateByKey = new Map([[buildGrantKey('Phone', '0PS1'), { readAccess: false, editAccess: false }]]);
    const rows = buildMatrixRows(fields, permissionSets, grantStateByKey, dirtyStateByKey);
    expect(rows[0].cells[0]).toMatchObject({ readAccess: false, editAccess: false, isDirty: true });
  });
});

describe('toggleCellState', () => {
  it('checking Edit auto-checks Read', () => {
    const next = toggleCellState({ readAccess: false, editAccess: false }, 'edit');
    expect(next).toEqual({ readAccess: true, editAccess: true });
  });

  it('unchecking Edit leaves Read as-is', () => {
    const next = toggleCellState({ readAccess: true, editAccess: true }, 'edit');
    expect(next).toEqual({ readAccess: true, editAccess: false });
  });

  it('unchecking Read auto-unchecks Edit', () => {
    const next = toggleCellState({ readAccess: true, editAccess: true }, 'read');
    expect(next).toEqual({ readAccess: false, editAccess: false });
  });

  it('checking Read alone does not check Edit', () => {
    const next = toggleCellState({ readAccess: false, editAccess: false }, 'read');
    expect(next).toEqual({ readAccess: true, editAccess: false });
  });
});

describe('buildDirtyGrantList', () => {
  it('flattens the dirty-state map back into a grant list', () => {
    const dirtyStateByKey = new Map([
      [buildGrantKey('Phone', '0PS1'), { readAccess: true, editAccess: false }],
      [buildGrantKey('Fax', '0PS2'), { readAccess: true, editAccess: true }]
    ]);
    const grants = buildDirtyGrantList(dirtyStateByKey);
    expect(grants).toEqual([
      { fieldApiName: 'Phone', permissionSetId: '0PS1', readAccess: true, editAccess: false },
      { fieldApiName: 'Fax', permissionSetId: '0PS2', readAccess: true, editAccess: true }
    ]);
  });

  it('returns an empty array for an empty map', () => {
    expect(buildDirtyGrantList(new Map())).toEqual([]);
  });
});
