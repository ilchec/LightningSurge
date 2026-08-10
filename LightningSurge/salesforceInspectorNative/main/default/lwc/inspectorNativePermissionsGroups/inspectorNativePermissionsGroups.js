import getAssignableItems from '@salesforce/apex/InspectorNativePermissionAssignment.getAssignableItems';
import searchUsers from '@salesforce/apex/InspectorNativePermissionAssignment.searchUsers';
import assignPermissions from '@salesforce/apex/InspectorNativePermissionAssignment.assignPermissions';
import { LightningElement, wire } from 'lwc';

const TYPE_FILTER_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'Permission Sets', value: 'PermissionSet' },
  { label: 'Permission Set Groups', value: 'PermissionSetGroup' },
  { label: 'Public Groups', value: 'PublicGroup' }
];

const TYPE_LABELS = {
  PermissionSet: 'Permission Set',
  PermissionSetGroup: 'Permission Set Group',
  PublicGroup: 'Public Group'
};

const USER_SEARCH_DEBOUNCE_MS = 300;
const MIN_USER_SEARCH_LENGTH = 2;

/**
 * Permissions and Groups tab: bulk-assign Permission Sets, Permission Set Groups, and Public Groups
 * to a set of users in one operation. A 3-step inline flow (no modal, same convention as the rest
 * of this app) - select items, select users (+ optional expiration date), review the per-assignment
 * results. Backed by InspectorNativePermissionAssignment - see that class's doc comment for why
 * Public Group membership has no expiration option (GroupMember has no such field on the platform)
 * and what happens when a selected user already has a selected item assigned.
 * @alias InspectorNativePermissionsGroups
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativePermissionsGroups extends LightningElement {
  isLoadingItems = true;
  itemListErrorText;
  step = 'select-items'; // 'select-items' | 'select-users' | 'results'

  itemSearchText = '';
  itemTypeFilter = '';
  userSearchText = '';
  isSearchingUsers = false;
  userSearchErrorText;
  expirationDate;
  isAssigning = false;
  assignErrorText;

  _items = [];
  _selectedItemsById = new Map();
  _userSearchResults = [];
  _selectedUsersById = new Map();
  _userSearchTimer;
  _assignmentResults;

  @wire(getAssignableItems)
  wiredItems({ data, error }) {
    this.isLoadingItems = false;
    if (data) {
      this._items = data;
    } else if (error) {
      this.itemListErrorText = error?.body?.message ?? error?.message ?? 'Unknown error loading permission sets/groups';
    }
  }

  get typeFilterOptions() {
    return TYPE_FILTER_OPTIONS;
  }

  get isSelectItemsStep() {
    return this.step === 'select-items';
  }

  get isSelectUsersStep() {
    return this.step === 'select-users';
  }

  get isResultsStep() {
    return this.step === 'results';
  }

  handleItemSearchChange(event) {
    this.itemSearchText = event.target.value;
  }

  handleItemTypeFilterChange(event) {
    this.itemTypeFilter = event.detail.value;
  }

  get itemRows() {
    const search = this.itemSearchText.trim().toLowerCase();
    return this._items
      .filter((item) => !this.itemTypeFilter || item.type === this.itemTypeFilter)
      .filter((item) => !search || item.label.toLowerCase().includes(search))
      .map((item) => ({
        id: item.id,
        label: item.label,
        typeLabel: TYPE_LABELS[item.type] ?? item.type,
        selected: this._selectedItemsById.has(item.id)
      }));
  }

  get hasNoItemResults() {
    return !this.isLoadingItems && !this.itemListErrorText && this.itemRows.length === 0;
  }

  handleItemToggle(event) {
    const id = event.currentTarget.dataset.id;
    const checked = event.target.checked;
    const updated = new Map(this._selectedItemsById);
    if (checked) {
      const item = this._items.find((i) => i.id === id);
      if (item) {
        updated.set(id, { label: item.label, type: item.type });
      }
    } else {
      updated.delete(id);
    }
    this._selectedItemsById = updated;
  }

  get selectedItems() {
    return Array.from(this._selectedItemsById.entries()).map(([id, item]) => ({
      id,
      label: item.label,
      type: item.type,
      typeLabel: TYPE_LABELS[item.type] ?? item.type
    }));
  }

  get selectedItemCount() {
    return this._selectedItemsById.size;
  }

  get isNextDisabled() {
    return this._selectedItemsById.size === 0;
  }

  // Public Group membership (GroupMember) has no expiration field on the platform - only offer the
  // expiration input when it would actually do something.
  get needsExpirationDate() {
    return this.selectedItems.some((item) => item.type === 'PermissionSet' || item.type === 'PermissionSetGroup');
  }

  handleNextStep() {
    if (this.isNextDisabled) {
      return;
    }
    this.step = 'select-users';
  }

  handleBackToItems() {
    this.step = 'select-items';
  }

  handleUserSearchChange(event) {
    const value = event.target.value;
    this.userSearchText = value;
    window.clearTimeout(this._userSearchTimer);
    this._userSearchTimer = window.setTimeout(() => this.runUserSearch(value), USER_SEARCH_DEBOUNCE_MS);
  }

  async runUserSearch(searchTerm) {
    const trimmed = searchTerm.trim();
    if (trimmed.length < MIN_USER_SEARCH_LENGTH) {
      this._userSearchResults = [];
      return;
    }
    this.isSearchingUsers = true;
    this.userSearchErrorText = undefined;
    try {
      this._userSearchResults = await searchUsers({ searchTerm: trimmed });
    } catch (error) {
      this.userSearchErrorText = error?.body?.message ?? error?.message ?? 'Unknown error searching users';
    } finally {
      this.isSearchingUsers = false;
    }
  }

  get userSearchRows() {
    return this._userSearchResults.map((user) => ({ ...user, selected: this._selectedUsersById.has(user.id) }));
  }

  get hasNoUserSearchResults() {
    return (
      !this.isSearchingUsers &&
      !this.userSearchErrorText &&
      this.userSearchText.trim().length >= MIN_USER_SEARCH_LENGTH &&
      this.userSearchRows.length === 0
    );
  }

  handleUserToggle(event) {
    const id = event.currentTarget.dataset.id;
    const checked = event.target.checked;
    const updated = new Map(this._selectedUsersById);
    if (checked) {
      const user = this._userSearchResults.find((u) => u.id === id);
      if (user) {
        updated.set(id, { name: user.name });
      }
    } else {
      updated.delete(id);
    }
    this._selectedUsersById = updated;
  }

  // Selected users are shown as removable pills rather than relying on the search results table -
  // a selection can scroll out of the current search results, but should still be visibly editable.
  get selectedUserPills() {
    return Array.from(this._selectedUsersById.entries()).map(([id, user]) => ({ label: user.name, name: id }));
  }

  handleRemoveUserPill(event) {
    const id = event.detail.item.name;
    const updated = new Map(this._selectedUsersById);
    updated.delete(id);
    this._selectedUsersById = updated;
  }

  get hasSelectedUsers() {
    return this._selectedUsersById.size > 0;
  }

  get selectedUserCount() {
    return this._selectedUsersById.size;
  }

  handleExpirationDateChange(event) {
    this.expirationDate = event.target.value;
  }

  get isAssignDisabled() {
    return this.isAssigning || !this.hasSelectedUsers;
  }

  async handleAssignClick() {
    if (this.isAssignDisabled) {
      return;
    }
    this.isAssigning = true;
    this.assignErrorText = undefined;
    const permissionSetIds = this.selectedItems.filter((item) => item.type === 'PermissionSet').map((item) => item.id);
    const permissionSetGroupIds = this.selectedItems.filter((item) => item.type === 'PermissionSetGroup').map((item) => item.id);
    const publicGroupIds = this.selectedItems.filter((item) => item.type === 'PublicGroup').map((item) => item.id);
    const userIds = Array.from(this._selectedUsersById.keys());
    try {
      this._assignmentResults = await assignPermissions({
        permissionSetIds,
        permissionSetGroupIds,
        publicGroupIds,
        userIds,
        expirationDate: this.needsExpirationDate && this.expirationDate ? this.expirationDate : null
      });
      this.step = 'results';
    } catch (error) {
      this.assignErrorText = error?.body?.message ?? error?.message ?? 'Unknown error assigning permissions';
    } finally {
      this.isAssigning = false;
    }
  }

  handleBackToUsers() {
    this.step = 'select-users';
  }

  get resultRows() {
    return (this._assignmentResults ?? []).map((result, index) => ({
      key: index,
      userLabel: result.userLabel,
      targetLabel: result.targetLabel,
      typeLabel: TYPE_LABELS[result.targetType] ?? result.targetType,
      success: result.success,
      message: result.message
    }));
  }

  handleAssignMore() {
    this.step = 'select-items';
    this._selectedItemsById = new Map();
    this._selectedUsersById = new Map();
    this._userSearchResults = [];
    this.userSearchText = '';
    this.itemSearchText = '';
    this.itemTypeFilter = '';
    this.expirationDate = undefined;
    this._assignmentResults = undefined;
  }
}
