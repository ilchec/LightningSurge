import ensureObjectReadForFieldGrants from '@salesforce/apex/InspectorNativeFlsMatrix.ensureObjectReadForFieldGrants';
import getFieldPermissionMatrix from '@salesforce/apex/InspectorNativeFlsMatrix.getFieldPermissionMatrix';
import saveFieldPermissions from '@salesforce/apex/InspectorNativeFlsMatrix.saveFieldPermissions';
import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { refreshApex } from '@salesforce/apex';
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
import { showToast } from 'c/inspectorNativeSharedUtils';
import { LightningElement, wire } from 'lwc';

/**
 * FLS Matrix tab: every FLS-eligible field on an object crossed with every assignable permission
 * set, Read/Edit checkboxes pre-loaded with current access, bulk-saveable in one call. Backed by
 * InspectorNativeFlsMatrix - unlike Field Creator's Permissions modal (additive-only, one field at
 * a time), this tool IS the editor of record for a permission set's field access, so unchecking a
 * box here actually revokes it on Save, the same way Setup's own FLS UI behaves. A second header
 * row above the field matrix covers the object's own object-level access (Read/Create/Edit/Delete/
 * View All/Modify All) per permission set - field-level security only really means something
 * alongside object-level Read, so this tool covers both rather than leaving object-level access
 * as a gap.
 * @alias InspectorNativeFlsMatrix
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeFlsMatrix extends LightningElement {
  isLoadingObjects = true;
  isSaving = false;
  errorText;

  _objectOptions = [];
  _selectedObjectApiName;
  _matrixResult;
  _wiredMatrix;
  _dirtyStateByKey = new Map();
  _objectPermissionDirtyByPermissionSetId = new Map();
  // undefined until the matrix first loads for the currently-selected object - that's the signal
  // that this is a fresh load. Seeded to an EMPTY set (no permission sets shown) rather than
  // "every permission set" - an org with many permission sets renders a much smaller/faster
  // initial table, and the empty state prompts the user to the picker instead. A later refresh
  // (e.g. refreshApex after Save) must NOT re-seed it, or a user's own selection would silently
  // reset every time they save - so this only ever gets initialized once per object, in wiredMatrix.
  _visiblePermissionSetIds;
  _isPermissionSetPickerOpen = false;
  permissionSetFilterTerm = '';

  @wire(getQueryableObjects)
  wiredObjects({ data, error }) {
    this.isLoadingObjects = false;
    if (data) {
      this._objectOptions = data.map((option) => ({ label: option.label, value: option.apiName }));
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading the object list';
    }
  }

  get objectOptions() {
    return this._objectOptions;
  }

  get selectedObjectApiName() {
    return this._selectedObjectApiName;
  }

  get hasSelectedObject() {
    return Boolean(this._selectedObjectApiName);
  }

  @wire(getFieldPermissionMatrix, { objectApiName: '$selectedObjectApiName' })
  wiredMatrix(result) {
    this._wiredMatrix = result;
    const { data, error } = result;
    if (data) {
      this._matrixResult = data;
      if (!this._visiblePermissionSetIds) {
        this._visiblePermissionSetIds = new Set();
      }
    } else if (error) {
      this._matrixResult = undefined;
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading field permissions';
    }
  }

  get hasMatrixLoaded() {
    return Boolean(this._matrixResult);
  }

  get isLoadingMatrix() {
    return this.hasSelectedObject && !this.hasMatrixLoaded && !this.errorText;
  }

  get permissionSets() {
    return this._matrixResult?.permissionSets ?? [];
  }

  get hasNoPermissionSets() {
    return this.hasMatrixLoaded && this.permissionSets.length === 0;
  }

  // Filters which permission sets are browsable/selectable in the picker widget itself - purely a
  // display narrowing, never the matrix table's own columns (visiblePermissionSets reads from
  // _visiblePermissionSetIds directly, not from this filtered list), so typing here can never
  // accidentally hide an already-shown matrix column.
  get permissionSetPickerOptions() {
    const term = this.permissionSetFilterTerm.trim().toLowerCase();
    const matching = term ? this.permissionSets.filter((permissionSet) => permissionSet.label.toLowerCase().includes(term)) : this.permissionSets;
    return matching.map((permissionSet) => ({ label: permissionSet.label, value: permissionSet.id }));
  }

  get hasNoMatchingPermissionSetOptions() {
    return this.isPermissionSetPickerOpen && this.permissionSets.length > 0 && this.permissionSetPickerOptions.length === 0;
  }

  get selectedPermissionSetIds() {
    return this._visiblePermissionSetIds ? [...this._visiblePermissionSetIds] : [];
  }

  // Which permission sets actually render as matrix columns - the user-narrowed subset once the
  // picker's been used, or every assignable permission set before that (see _visiblePermissionSetIds).
  get visiblePermissionSets() {
    if (!this._visiblePermissionSetIds) {
      return this.permissionSets;
    }
    return this.permissionSets.filter((permissionSet) => this._visiblePermissionSetIds.has(permissionSet.id));
  }

  get hasNoVisiblePermissionSets() {
    return this.hasMatrixLoaded && this.permissionSets.length > 0 && this.visiblePermissionSets.length === 0;
  }

  get isPermissionSetPickerOpen() {
    return this._isPermissionSetPickerOpen;
  }

  get permissionSetPickerToggleLabel() {
    return this._isPermissionSetPickerOpen ? 'Hide Permission Set Picker' : 'Select Permission Sets';
  }

  get matrixSummaryLabel() {
    const fieldCount = this._matrixResult?.fields?.length ?? 0;
    return `${fieldCount} field(s) x ${this.visiblePermissionSets.length} of ${this.permissionSets.length} permission set(s) shown`;
  }

  // Display-ready cellClass lives here (component layer), not in the pure buildMatrixRows utility
  // - same split as every other *Utils/*component pair in this app (e.g. saveResults in
  // inspectorNativeRecordEntry): the pure function stays test-covered and presentation-agnostic.
  get matrixRows() {
    if (!this._matrixResult) {
      return [];
    }
    const grantStateByKey = buildGrantStateMap(this._matrixResult.existingGrants);
    const rows = buildMatrixRows(this._matrixResult.fields, this.visiblePermissionSets, grantStateByKey, this._dirtyStateByKey);
    return rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({ ...cell, cellClass: cell.isDirty ? 'matrix-cell matrix-cell_dirty' : 'matrix-cell' }))
    }));
  }

  // One cell per visible permission set column, for the object-level access header row - the same
  // dirty-overrides-server fallthrough as matrixRows, just keyed by permissionSetId alone since
  // object-level access has no field dimension.
  get objectPermissionHeaderCells() {
    if (!this._matrixResult) {
      return [];
    }
    const stateByPermissionSetId = buildObjectPermissionStateMap(this._matrixResult.existingObjectPermissions);
    return this.visiblePermissionSets.map((permissionSet) => {
      const isDirty = this._objectPermissionDirtyByPermissionSetId.has(permissionSet.id);
      const state =
        this._objectPermissionDirtyByPermissionSetId.get(permissionSet.id) ??
        stateByPermissionSetId.get(permissionSet.id) ??
        defaultObjectPermissionState();
      return {
        permissionSetId: permissionSet.id,
        ...state,
        isDirty,
        cellClass: isDirty ? 'matrix-cell matrix-cell_dirty' : 'matrix-cell'
      };
    });
  }

  get dirtyCount() {
    return this._dirtyStateByKey.size + this._objectPermissionDirtyByPermissionSetId.size;
  }

  get hasUnsavedChanges() {
    return this.dirtyCount > 0;
  }

  get saveButtonLabel() {
    return this.hasUnsavedChanges ? `Save Changes (${this.dirtyCount})` : 'Save Changes';
  }

  get isSaveDisabled() {
    return this.isSaving || !this.hasUnsavedChanges;
  }

  get isDiscardDisabled() {
    return this.isSaving || !this.hasUnsavedChanges;
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._matrixResult = undefined;
    this._dirtyStateByKey = new Map();
    this._objectPermissionDirtyByPermissionSetId = new Map();
    this._visiblePermissionSetIds = undefined;
    this._isPermissionSetPickerOpen = false;
    this.permissionSetFilterTerm = '';
    this.errorText = undefined;
  }

  handleTogglePermissionSetPicker() {
    this._isPermissionSetPickerOpen = !this._isPermissionSetPickerOpen;
    this.permissionSetFilterTerm = '';
  }

  handlePermissionSetFilterChange(event) {
    this.permissionSetFilterTerm = event.target.value;
  }

  handlePermissionSetSelectionChange(event) {
    this._visiblePermissionSetIds = new Set(event.detail.value);
  }

  // Scoped to whatever the filter currently shows (every permission set, when the filter is
  // blank) rather than always every permission set unconditionally - typing a filter then clicking
  // Select All/Deselect All is how these buttons become useful for bulk-toggling by search term,
  // e.g. filter to "Sales" then Select All to show just the Sales-related permission sets.
  handleSelectAllPermissionSets() {
    const filteredIds = this.permissionSetPickerOptions.map((option) => option.value);
    this._visiblePermissionSetIds = new Set([...(this._visiblePermissionSetIds ?? []), ...filteredIds]);
  }

  handleDeselectAllPermissionSets() {
    const filteredIds = new Set(this.permissionSetPickerOptions.map((option) => option.value));
    this._visiblePermissionSetIds = new Set([...(this._visiblePermissionSetIds ?? [])].filter((id) => !filteredIds.has(id)));
  }

  handleCellToggle(event) {
    const { fieldApiName, permissionSetId, field } = event.currentTarget.dataset;
    const key = buildGrantKey(fieldApiName, permissionSetId);
    const grantStateByKey = buildGrantStateMap(this._matrixResult.existingGrants);
    const original = grantStateByKey.get(key) ?? { readAccess: false, editAccess: false };
    const currentState = this._dirtyStateByKey.get(key) ?? original;
    const nextState = toggleCellState(currentState, field);

    const nextDirty = new Map(this._dirtyStateByKey);
    if (nextState.readAccess === original.readAccess && nextState.editAccess === original.editAccess) {
      // Back to the original saved state - no longer actually dirty, so it drops out of both the
      // unsaved-changes count and what Save would submit, instead of sending a no-op grant.
      nextDirty.delete(key);
    } else {
      nextDirty.set(key, nextState);
    }
    this._dirtyStateByKey = nextDirty;
  }

  handleObjectPermissionToggle(event) {
    const { permissionSetId, field } = event.currentTarget.dataset;
    const stateByPermissionSetId = buildObjectPermissionStateMap(this._matrixResult.existingObjectPermissions);
    const original = stateByPermissionSetId.get(permissionSetId) ?? defaultObjectPermissionState();
    const currentState = this._objectPermissionDirtyByPermissionSetId.get(permissionSetId) ?? original;
    const nextState = toggleObjectPermissionState(currentState, field);

    const nextDirty = new Map(this._objectPermissionDirtyByPermissionSetId);
    if (isSameObjectPermissionState(nextState, original)) {
      nextDirty.delete(permissionSetId);
    } else {
      nextDirty.set(permissionSetId, nextState);
    }
    this._objectPermissionDirtyByPermissionSetId = nextDirty;
  }

  handleDiscardClick() {
    if (this.isDiscardDisabled) return;
    this._dirtyStateByKey = new Map();
    this._objectPermissionDirtyByPermissionSetId = new Map();
  }

  async handleSaveClick() {
    if (this.isSaveDisabled) return;
    const grants = buildDirtyGrantList(this._dirtyStateByKey);
    const objectGrants = buildDirtyObjectPermissionGrantList(this._objectPermissionDirtyByPermissionSetId);
    // Grants travel as a JSON string, not a typed List<T> - see
    // InspectorNativeFlsMatrix.saveFieldPermissions's own comment for why.
    const grantsJson = JSON.stringify(grants);
    const objectGrantsJson = JSON.stringify(objectGrants);
    this.isSaving = true;
    try {
      // Two separate, sequentially-awaited Apex calls, not one - confirmed live that upserting the
      // object-level Read grant a field grant depends on, then immediately upserting the field grant
      // itself, in the SAME Apex transaction, still fails with INVALID_CROSS_REFERENCE_KEY every
      // time, even though the object-level upsert itself succeeds. Whatever check enforces that
      // dependency during a FieldPermissions upsert looks at already-committed state, not an earlier
      // DML statement's uncommitted effect within the same transaction - so this call has to fully
      // complete (its own transaction, genuinely committed) before saveFieldPermissions runs.
      await ensureObjectReadForFieldGrants({ objectApiName: this._selectedObjectApiName, grantsJson });
      await saveFieldPermissions({ objectApiName: this._selectedObjectApiName, grantsJson, objectGrantsJson });
      this._dirtyStateByKey = new Map();
      this._objectPermissionDirtyByPermissionSetId = new Map();
      await refreshApex(this._wiredMatrix);
      showToast(this, 'Success', 'Field and Object permissions saved', 'success');
    } catch (error) {
      showToast(this, 'Error saving field permissions', error?.body?.message ?? error?.message ?? 'Unknown error', 'error');
    } finally {
      this.isSaving = false;
    }
  }
}
