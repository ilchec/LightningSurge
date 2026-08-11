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
