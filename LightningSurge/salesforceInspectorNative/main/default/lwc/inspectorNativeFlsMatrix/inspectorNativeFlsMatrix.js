import getFieldPermissionMatrix from '@salesforce/apex/InspectorNativeFlsMatrix.getFieldPermissionMatrix';
import saveFieldPermissions from '@salesforce/apex/InspectorNativeFlsMatrix.saveFieldPermissions';
import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { refreshApex } from '@salesforce/apex';
import {
  buildDirtyGrantList,
  buildGrantKey,
  buildGrantStateMap,
  buildMatrixRows,
  toggleCellState
} from 'c/inspectorNativeFlsMatrixUtils';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { LightningElement, wire } from 'lwc';

/**
 * FLS Matrix tab: every FLS-eligible field on an object crossed with every assignable permission
 * set, Read/Edit checkboxes pre-loaded with current access, bulk-saveable in one call. Backed by
 * InspectorNativeFlsMatrix - unlike Field Creator's Permissions modal (additive-only, one field at
 * a time), this tool IS the editor of record for a permission set's field access, so unchecking a
 * box here actually revokes it on Save, the same way Setup's own FLS UI behaves.
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
  // undefined until the matrix first loads for the currently-selected object - that's the signal
  // to default it to "every permission set shown". A later refresh (e.g. refreshApex after Save)
  // must NOT re-default it, or a user's narrowed-down selection would silently reset to "all"
  // every time they save - so this only ever gets initialized once per object, in wiredMatrix.
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
        this._visiblePermissionSetIds = new Set(data.permissionSets.map((permissionSet) => permissionSet.id));
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

  get dirtyCount() {
    return this._dirtyStateByKey.size;
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

  handleDiscardClick() {
    if (this.isDiscardDisabled) return;
    this._dirtyStateByKey = new Map();
  }

  async handleSaveClick() {
    if (this.isSaveDisabled) return;
    const grants = buildDirtyGrantList(this._dirtyStateByKey);
    this.isSaving = true;
    try {
      await saveFieldPermissions({ objectApiName: this._selectedObjectApiName, grants });
      this._dirtyStateByKey = new Map();
      await refreshApex(this._wiredMatrix);
      showToast(this, 'Success', 'Field permissions saved', 'success');
    } catch (error) {
      showToast(this, 'Error saving field permissions', error?.body?.message ?? error?.message ?? 'Unknown error', 'error');
    } finally {
      this.isSaving = false;
    }
  }
}
