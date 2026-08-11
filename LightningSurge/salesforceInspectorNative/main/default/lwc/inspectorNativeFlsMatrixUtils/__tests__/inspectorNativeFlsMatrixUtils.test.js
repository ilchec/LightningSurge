import {
  buildDirtyGrantList,
  buildDirtyObjectPermissionGrantList,
  buildGrantKey,
  buildGrantStateMap,
  buildMatrixRows,
  buildObjectPermissionStateMap,
  defaultObjectPermissionState,
  isSameObjectPermissionState,
  toggleCellState,
  toggleObjectPermissionState
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

describe('buildObjectPermissionStateMap', () => {
  it('keys existing object permissions by permissionSetId', () => {
    const map = buildObjectPermissionStateMap([
      { permissionSetId: '0PS1', readAccess: true, createAccess: true, editAccess: false, deleteAccess: false, viewAllAccess: false, modifyAllAccess: false }
    ]);
    expect(map.get('0PS1')).toEqual({
      readAccess: true,
      createAccess: true,
      editAccess: false,
      deleteAccess: false,
      viewAllAccess: false,
      modifyAllAccess: false
    });
  });

  it('returns an empty map when given none', () => {
    expect(buildObjectPermissionStateMap(undefined).size).toBe(0);
    expect(buildObjectPermissionStateMap([]).size).toBe(0);
  });
});

describe('toggleObjectPermissionState', () => {
  it('checking Edit auto-checks Read', () => {
    const next = toggleObjectPermissionState(defaultObjectPermissionState(), 'edit');
    expect(next).toMatchObject({ readAccess: true, editAccess: true });
  });

  it('checking Delete auto-checks Read and Edit', () => {
    const next = toggleObjectPermissionState(defaultObjectPermissionState(), 'delete');
    expect(next).toMatchObject({ readAccess: true, editAccess: true, deleteAccess: true });
  });

  it('checking View All auto-checks Read', () => {
    const next = toggleObjectPermissionState(defaultObjectPermissionState(), 'viewAll');
    expect(next).toMatchObject({ readAccess: true, viewAllAccess: true });
  });

  it('checking Modify All auto-checks Read, Edit, and Delete', () => {
    const next = toggleObjectPermissionState(defaultObjectPermissionState(), 'modifyAll');
    expect(next).toMatchObject({ readAccess: true, editAccess: true, deleteAccess: true, modifyAllAccess: true });
  });

  it('unchecking Read cascades to unchecking Edit, Delete, View All, and Modify All', () => {
    const fullyGranted = { readAccess: true, createAccess: true, editAccess: true, deleteAccess: true, viewAllAccess: true, modifyAllAccess: true };
    const next = toggleObjectPermissionState(fullyGranted, 'read');
    expect(next).toMatchObject({
      readAccess: false,
      editAccess: false,
      deleteAccess: false,
      viewAllAccess: false,
      modifyAllAccess: false
    });
    // Create has no dependency on Read.
    expect(next.createAccess).toBe(true);
  });

  it('unchecking Edit cascades to unchecking Delete and Modify All, but leaves Read alone', () => {
    const fullyGranted = { readAccess: true, createAccess: false, editAccess: true, deleteAccess: true, viewAllAccess: false, modifyAllAccess: true };
    const next = toggleObjectPermissionState(fullyGranted, 'edit');
    expect(next).toMatchObject({ readAccess: true, editAccess: false, deleteAccess: false, modifyAllAccess: false });
  });

  it('unchecking Delete cascades to unchecking Modify All only', () => {
    const state = { readAccess: true, createAccess: false, editAccess: true, deleteAccess: true, viewAllAccess: false, modifyAllAccess: true };
    const next = toggleObjectPermissionState(state, 'delete');
    expect(next).toMatchObject({ readAccess: true, editAccess: true, deleteAccess: false, modifyAllAccess: false });
  });

  it('toggling Create never affects any other field', () => {
    const next = toggleObjectPermissionState(defaultObjectPermissionState(), 'create');
    expect(next).toEqual({ ...defaultObjectPermissionState(), createAccess: true });
  });
});

describe('isSameObjectPermissionState', () => {
  it('returns true for identical states', () => {
    expect(isSameObjectPermissionState(defaultObjectPermissionState(), defaultObjectPermissionState())).toBe(true);
  });

  it('returns false when any single field differs', () => {
    const a = defaultObjectPermissionState();
    const b = { ...defaultObjectPermissionState(), createAccess: true };
    expect(isSameObjectPermissionState(a, b)).toBe(false);
  });
});

describe('buildDirtyObjectPermissionGrantList', () => {
  it('flattens the dirty map back into a grant list, including permissionSetId', () => {
    const dirty = new Map([['0PS1', { ...defaultObjectPermissionState(), readAccess: true }]]);
    const grants = buildDirtyObjectPermissionGrantList(dirty);
    expect(grants).toEqual([{ permissionSetId: '0PS1', ...defaultObjectPermissionState(), readAccess: true }]);
  });

  it('returns an empty array for an empty map', () => {
    expect(buildDirtyObjectPermissionGrantList(new Map())).toEqual([]);
  });
});
