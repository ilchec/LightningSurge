import getRecordAccess from '@salesforce/apex/InspectorNativeRecordAccess.getRecordAccess';
import searchUsers from '@salesforce/apex/InspectorNativePermissionAssignment.searchUsers';
import { LightningElement } from 'lwc';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Record Access Inspector tab: "why can/can't user X see record Y" - pick a user (same
 * server-searched picker Permissions and Groups already uses, via
 * InspectorNativePermissionAssignment.searchUsers - reused rather than duplicated) and paste a
 * record Id, and see their Read/Edit/Delete/Transfer access plus MaxAccessLevel, backed by
 * UserRecordAccess (the platform's own purpose-built object for this - see
 * InspectorNativeRecordAccess's own doc comment for the confirmed field/query-shape details and
 * what's deliberately left out).
 *
 * A meaningful result depends on the person running this tool being able to see the record
 * themselves too - UserRecordAccess only reports on records visible to the querying context, same
 * `with sharing` enforcement as everywhere else in this app. An empty/no-access result can mean
 * either the target user genuinely has no access, or the record isn't visible to whoever's running
 * this check - there's no way to distinguish the two from this object alone, so that's called out
 * directly in the UI rather than left as a silent gap.
 * @alias InspectorNativeRecordAccess
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeRecordAccess extends LightningElement {
  recordIdInput = '';
  userSearchTerm = '';
  isChecking = false;
  errorText;

  _selectedUser;
  _searchResults = [];
  _searchTimer;
  _accessResult;

  get selectedUser() {
    return this._selectedUser;
  }

  get hasSelectedUser() {
    return Boolean(this._selectedUser);
  }

  get searchResults() {
    return this._searchResults;
  }

  get hasSearchResults() {
    return this._searchResults.length > 0;
  }

  get isCheckDisabled() {
    return this.isChecking || !this.recordIdInput.trim() || !this.hasSelectedUser;
  }

  get hasAccessResult() {
    return Boolean(this._accessResult);
  }

  get maxAccessLevel() {
    return this._accessResult?.maxAccessLevel ?? '';
  }

  get objectLabel() {
    return this._accessResult?.objectLabel ?? '';
  }

  // Display-ready row list built here (component layer) from the raw AccessResult, same split as
  // every other *Utils-less small tab in this app that doesn't need a separate pure-function file
  // for a shape this simple.
  get accessRows() {
    if (!this._accessResult) {
      return [];
    }
    return [
      { key: 'read', label: 'Read', granted: this._accessResult.hasReadAccess },
      { key: 'edit', label: 'Edit', granted: this._accessResult.hasEditAccess },
      { key: 'delete', label: 'Delete', granted: this._accessResult.hasDeleteAccess },
      { key: 'transfer', label: 'Transfer', granted: this._accessResult.hasTransferAccess }
    ];
  }

  handleRecordIdChange(event) {
    this.recordIdInput = event.target.value;
    this._accessResult = undefined;
  }

  handleUserSearchChange(event) {
    this.userSearchTerm = event.target.value;
    this._selectedUser = undefined;
    this._accessResult = undefined;
    window.clearTimeout(this._searchTimer);
    this._searchTimer = window.setTimeout(() => this.runSearch(), SEARCH_DEBOUNCE_MS);
  }

  async runSearch() {
    const term = this.userSearchTerm.trim();
    if (!term) {
      this._searchResults = [];
      return;
    }
    try {
      this._searchResults = await searchUsers({ searchTerm: term });
    } catch (error) {
      // Same "fail quiet" choice as Org Chart's own search - the main form (record Id input,
      // already-selected user if any) is unaffected either way.
      this._searchResults = [];
    }
  }

  handleUserResultClick(event) {
    const userId = event.currentTarget.dataset.userId;
    this._selectedUser = this._searchResults.find((user) => user.id === userId);
    this._searchResults = [];
    this.userSearchTerm = this._selectedUser?.name ?? '';
    this._accessResult = undefined;
  }

  handleClearUser() {
    this._selectedUser = undefined;
    this.userSearchTerm = '';
    this._accessResult = undefined;
  }

  async handleCheckAccessClick() {
    if (this.isCheckDisabled) {
      return;
    }
    this.isChecking = true;
    this.errorText = undefined;
    this._accessResult = undefined;
    try {
      this._accessResult = await getRecordAccess({ recordId: this.recordIdInput.trim(), userId: this._selectedUser.id });
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error checking record access';
    } finally {
      this.isChecking = false;
    }
  }
}
