/**
 * Pure functions behind the FLS Matrix tab: combining the server-loaded field/permission-set/
 * existing-grant lists with in-progress (unsaved) edits into one renderable grid, and the toggle
 * logic for a single Read/Edit checkbox pair.
 */

export function buildGrantKey(fieldApiName, permissionSetId) {
  return `${fieldApiName}::${permissionSetId}`;
}

/** { fieldApiName::permissionSetId -> { readAccess, editAccess } } from the server's existingGrants list. */
export function buildGrantStateMap(existingGrants) {
  const map = new Map();
  (existingGrants || []).forEach((grant) => {
    map.set(buildGrantKey(grant.fieldApiName, grant.permissionSetId), {
      readAccess: Boolean(grant.readAccess),
      editAccess: Boolean(grant.editAccess)
    });
  });
  return map;
}

/**
 * Builds one row per field, one cell per permission set. A cell's state comes from dirtyStateByKey
 * (an in-progress, unsaved edit) if present, otherwise from grantStateByKey (what's actually saved
 * server-side), otherwise "no access" - the same fallthrough a fresh, never-touched cell should show.
 */
export function buildMatrixRows(fields, permissionSets, grantStateByKey, dirtyStateByKey) {
  return (fields || []).map((field) => ({
    fieldApiName: field.apiName,
    fieldLabel: field.label,
    cells: (permissionSets || []).map((permissionSet) => {
      const key = buildGrantKey(field.apiName, permissionSet.id);
      const state = dirtyStateByKey.get(key) ?? grantStateByKey.get(key) ?? { readAccess: false, editAccess: false };
      return {
        key,
        fieldApiName: field.apiName,
        permissionSetId: permissionSet.id,
        readAccess: state.readAccess,
        editAccess: state.editAccess,
        isDirty: dirtyStateByKey.has(key)
      };
    })
  }));
}

/**
 * Applies one checkbox click to a cell's current state, enforcing the same "Edit implies Read"
 * invariant InspectorNativeFlsMatrix.saveFieldPermissions enforces server-side - checking Edit
 * auto-checks Read; unchecking Read auto-unchecks Edit (you can't have edit access without read
 * access). Kept client-side too so what's shown before Save matches what Save will actually do,
 * rather than surprising the user with a silently-added Read checkmark only after saving.
 */
export function toggleCellState(state, field) {
  if (field === 'edit') {
    const editAccess = !state.editAccess;
    return { readAccess: editAccess ? true : state.readAccess, editAccess };
  }
  const readAccess = !state.readAccess;
  return { readAccess, editAccess: readAccess ? state.editAccess : false };
}

/** Flattens the dirty-state map back into the List<InspectorNativeFlsGrant>-shaped payload saveFieldPermissions expects. */
export function buildDirtyGrantList(dirtyStateByKey) {
  const grants = [];
  dirtyStateByKey.forEach((state, key) => {
    const [fieldApiName, permissionSetId] = key.split('::');
    grants.push({ fieldApiName, permissionSetId, readAccess: state.readAccess, editAccess: state.editAccess });
  });
  return grants;
}

/**
 * Object-level access (ObjectPermissions) for one permission set on the FLS Matrix's object - a
 * second header row above the field matrix, one set of six checkboxes per permission set column,
 * since object-level access has no "field" dimension the way FieldPermissions does.
 */
export function defaultObjectPermissionState() {
  return {
    readAccess: false,
    createAccess: false,
    editAccess: false,
    deleteAccess: false,
    viewAllAccess: false,
    modifyAllAccess: false
  };
}

/** { permissionSetId -> objectPermissionState } from the server's existingObjectPermissions list. */
export function buildObjectPermissionStateMap(existingObjectPermissions) {
  const map = new Map();
  (existingObjectPermissions || []).forEach((permission) => {
    map.set(permission.permissionSetId, {
      readAccess: Boolean(permission.readAccess),
      createAccess: Boolean(permission.createAccess),
      editAccess: Boolean(permission.editAccess),
      deleteAccess: Boolean(permission.deleteAccess),
      viewAllAccess: Boolean(permission.viewAllAccess),
      modifyAllAccess: Boolean(permission.modifyAllAccess)
    });
  });
  return map;
}

/**
 * Applies one checkbox click to an object-permission cell's current state, enforcing the same
 * dependency chain Setup's own "Object Settings" page enforces (and InspectorNativeFlsMatrix.
 * saveFieldPermissions re-applies server-side, so a stale payload can never leave an inconsistent
 * combination saved even if this client-side logic were somehow bypassed):
 * Edit implies Read; Delete implies Read+Edit; View All implies Read; Modify All implies
 * Read+Edit+Delete. Unchecking a box that others depend on cascades the uncheck to those dependents
 * too (unchecking Read also unchecks Edit/Delete/View All/Modify All; unchecking Edit also unchecks
 * Delete/Modify All; unchecking Delete also unchecks Modify All) - Create has no dependency on, or
 * from, anything else.
 */
export function toggleObjectPermissionState(state, field) {
  const next = { ...state };
  if (field === 'read') {
    next.readAccess = !state.readAccess;
    if (!next.readAccess) {
      next.editAccess = false;
      next.deleteAccess = false;
      next.viewAllAccess = false;
      next.modifyAllAccess = false;
    }
  } else if (field === 'create') {
    next.createAccess = !state.createAccess;
  } else if (field === 'edit') {
    next.editAccess = !state.editAccess;
    if (next.editAccess) {
      next.readAccess = true;
    } else {
      next.deleteAccess = false;
      next.modifyAllAccess = false;
    }
  } else if (field === 'delete') {
    next.deleteAccess = !state.deleteAccess;
    if (next.deleteAccess) {
      next.readAccess = true;
      next.editAccess = true;
    } else {
      next.modifyAllAccess = false;
    }
  } else if (field === 'viewAll') {
    next.viewAllAccess = !state.viewAllAccess;
    if (next.viewAllAccess) {
      next.readAccess = true;
    }
  } else if (field === 'modifyAll') {
    next.modifyAllAccess = !state.modifyAllAccess;
    if (next.modifyAllAccess) {
      next.readAccess = true;
      next.editAccess = true;
      next.deleteAccess = true;
    }
  }
  return next;
}

/** Whether two object-permission states represent the same access, field-by-field. */
export function isSameObjectPermissionState(a, b) {
  return (
    a.readAccess === b.readAccess &&
    a.createAccess === b.createAccess &&
    a.editAccess === b.editAccess &&
    a.deleteAccess === b.deleteAccess &&
    a.viewAllAccess === b.viewAllAccess &&
    a.modifyAllAccess === b.modifyAllAccess
  );
}

/** Flattens the object-permission dirty-state map into the List<InspectorNativeObjectPermissionGrant>-shaped payload saveFieldPermissions expects. */
export function buildDirtyObjectPermissionGrantList(dirtyByPermissionSetId) {
  const grants = [];
  dirtyByPermissionSetId.forEach((state, permissionSetId) => {
    grants.push({ permissionSetId, ...state });
  });
  return grants;
}
