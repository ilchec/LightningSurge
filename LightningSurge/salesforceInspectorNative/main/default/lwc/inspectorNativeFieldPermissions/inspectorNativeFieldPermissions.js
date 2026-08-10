import getAssignablePermissionSets from '@salesforce/apex/InspectorNativeFieldPermissions.getAssignablePermissionSets';
import LightningModal from 'lightning/modal';
import { api, wire } from 'lwc';

/**
 * "Set Field Permissions" modal for one field row in Field Creator: pick which permission sets get
 * Read/Edit access to the field once it's created. Doesn't grant anything itself - it just
 * collects the selection and resolves it back to the caller (inspectorNativeFieldCreator),
 * which applies it via InspectorNativeFieldPermissions.grantFieldPermissions after that row's field
 * is actually created successfully. Resolves null on Cancel (a true no-op, same as the Options
 * modal), or `{ grants, applyToAll }` on Save/"Apply to All Fields" - the caller copies `grants` to
 * every other row when applyToAll is true.
 * @alias InspectorNativeFieldPermissions
 * @extends LightningModal
 * @hideconstructor
 */
export default class InspectorNativeFieldPermissions extends LightningModal {
  // Current selections passed in by the caller: [{ permissionSetId, readAccess, editAccess }].
  @api grants = [];

  isLoading = true;
  errorText;
  searchText = '';

  _permissionSets = [];
  _selectionByPermissionSetId = new Map();

  connectedCallback() {
    this._selectionByPermissionSetId = new Map(
      (this.grants || []).map((grant) => [
        grant.permissionSetId,
        { readAccess: Boolean(grant.readAccess), editAccess: Boolean(grant.editAccess) }
      ])
    );
  }

  @wire(getAssignablePermissionSets)
  wiredPermissionSets({ data, error }) {
    this.isLoading = false;
    if (data) {
      this._permissionSets = data;
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading permission sets';
    }
  }

  handleSearchChange(event) {
    this.searchText = event.target.value;
  }

  get rows() {
    const search = this.searchText.trim().toLowerCase();
    return this._permissionSets
      .filter((permissionSet) => !search || permissionSet.label.toLowerCase().includes(search))
      .map((permissionSet) => {
        const selection = this._selectionByPermissionSetId.get(permissionSet.id) || { readAccess: false, editAccess: false };
        return {
          id: permissionSet.id,
          label: permissionSet.label,
          readAccess: selection.readAccess,
          editAccess: selection.editAccess
        };
      });
  }

  get hasNoResults() {
    return !this.isLoading && !this.errorText && this.rows.length === 0;
  }

  // "Select all" header checkboxes reflect/act on the currently-filtered rows only, matching the
  // search box right above them - selecting all while a search is active only selects the matches.
  get allEditSelected() {
    const rows = this.rows;
    return rows.length > 0 && rows.every((row) => row.editAccess);
  }

  get allReadSelected() {
    const rows = this.rows;
    return rows.length > 0 && rows.every((row) => row.readAccess);
  }

  handleSelectAllEdit(event) {
    const checked = event.target.checked;
    this.rows.forEach((row) => this.updateSelection(row.id, { editAccessOverride: checked }));
  }

  handleSelectAllRead(event) {
    const checked = event.target.checked;
    this.rows.forEach((row) => this.updateSelection(row.id, { readAccessOverride: checked }));
  }

  handleReadChange(event) {
    this.updateSelection(event.currentTarget.dataset.id, { readAccessOverride: event.target.checked });
  }

  handleEditChange(event) {
    this.updateSelection(event.currentTarget.dataset.id, { editAccessOverride: event.target.checked });
  }

  updateSelection(permissionSetId, { readAccessOverride, editAccessOverride }) {
    const current = this._selectionByPermissionSetId.get(permissionSetId) || { readAccess: false, editAccess: false };
    const next = { ...current };
    if (readAccessOverride !== undefined) {
      next.readAccess = readAccessOverride;
    }
    if (editAccessOverride !== undefined) {
      next.editAccess = editAccessOverride;
      // Edit implies read, mirrored here so the checkbox state itself reflects it immediately
      // rather than only being reconciled server-side.
      if (editAccessOverride) {
        next.readAccess = true;
      }
    }
    const updated = new Map(this._selectionByPermissionSetId);
    updated.set(permissionSetId, next);
    this._selectionByPermissionSetId = updated;
  }

  buildGrants() {
    return Array.from(this._selectionByPermissionSetId.entries())
      .filter(([, selection]) => selection.readAccess || selection.editAccess)
      .map(([permissionSetId, selection]) => ({
        permissionSetId,
        readAccess: selection.readAccess,
        editAccess: selection.editAccess
      }));
  }

  handleCancel() {
    this.close(null);
  }

  handleSave() {
    this.close({ grants: this.buildGrants(), applyToAll: false });
  }

  handleApplyToAllFields() {
    this.close({ grants: this.buildGrants(), applyToAll: true });
  }
}
