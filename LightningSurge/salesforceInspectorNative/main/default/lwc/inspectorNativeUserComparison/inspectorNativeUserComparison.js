import getUserAssignments from '@salesforce/apex/InspectorNativeUserComparison.getUserAssignments';
import searchUsers from '@salesforce/apex/InspectorNativePermissionAssignment.searchUsers';
import {
  BASIC_SETTINGS_FIELDS,
  buildFieldRows,
  buildSetDiffRows,
  buildUserComparisonQuery,
  extractComparisonUserNode,
  filterDifferentOnly,
  PROFILE_ROLE_FIELDS
} from 'c/inspectorNativeUserComparisonUtils';
import { graphql } from 'lightning/graphql';
import { LightningElement, wire } from 'lwc';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * User Comparison tab: pick two users and see their Basic Settings, Profile & Role, Permission
 * Sets, Permission Set Groups, Public Group membership, and Queue membership side by side, grouped
 * by category. Identical items line up in the same row; items only one user has render with a gap
 * on the other side. A "Show All / Show Only Different" toggle controls the view - defaults to
 * different only.
 *
 * User search reuses InspectorNativePermissionAssignment.searchUsers (the same click-to-select
 * pattern already used by Record Access Inspector), not a new Apex method - two independent
 * instances of it, one per side, since this app has no existing "pick N of something" widget for
 * exactly 2 that isn't a full dual-listbox (overkill for a two-person comparison).
 *
 * Basic Settings/Profile & Role come from two separate, single-`eq`-match GraphQL queries (one per
 * selected user) via inspectorNativeUserComparisonUtils.buildUserComparisonQuery - see that file's
 * own doc comment for why two single queries rather than one `in`-filtered query, and for the
 * flagged-not-fully-certain Profile/UserRole relationship traversal. Permission Sets/Groups/Public
 * Groups/Queues come from InspectorNativeUserComparison.getUserAssignments (Apex, read-only) - this
 * repo has never queried PermissionSetAssignment/GroupMember via GraphQL, only ever via Apex SOQL, so
 * that's the proven path reused here rather than a fresh GraphQL-exposure gamble.
 * @alias InspectorNativeUserComparison
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeUserComparison extends LightningElement {
  userASearchTerm = '';
  userBSearchTerm = '';
  showAll = false;
  errorText;

  _selectedUserA;
  _selectedUserB;
  _searchResultsA = [];
  _searchResultsB = [];
  _searchTimerA;
  _searchTimerB;
  _userAComparisonData;
  _userBComparisonData;
  _userAAssignments;
  _userBAssignments;

  // Tracks which user Id each data source's currently-held result actually corresponds to, rather
  // than a plain loaded boolean - a reactive @wire only re-invokes its callback when its own
  // reactive param actually changes value, so e.g. changing User B alone never re-fires
  // wiredUserA/wiredAssignments's userAId-driven half. A boolean flag reset on every selection
  // change (the original, buggy approach) could get stuck false forever on the side that didn't
  // change, leaving isLoadingComparison permanently true. Comparing "loaded for" against the
  // current Id self-corrects: it's automatically "stale" the instant a relevant Id changes, and
  // automatically "fresh" again the moment that specific wire actually delivers new data.
  _userALoadedForId;
  _userBLoadedForId;
  _assignmentsLoadedForUserAId;
  _assignmentsLoadedForUserBId;

  get selectedUserA() {
    return this._selectedUserA;
  }

  get selectedUserB() {
    return this._selectedUserB;
  }

  get hasSelectedUserA() {
    return Boolean(this._selectedUserA);
  }

  get hasSelectedUserB() {
    return Boolean(this._selectedUserB);
  }

  get hasBothUsersSelected() {
    return this.hasSelectedUserA && this.hasSelectedUserB;
  }

  get searchResultsA() {
    return this._searchResultsA;
  }

  get searchResultsB() {
    return this._searchResultsB;
  }

  get hasSearchResultsA() {
    return this._searchResultsA.length > 0;
  }

  get hasSearchResultsB() {
    return this._searchResultsB.length > 0;
  }

  get userAId() {
    return this._selectedUserA?.id;
  }

  get userBId() {
    return this._selectedUserB?.id;
  }

  get userAQuery() {
    return this.userAId ? buildUserComparisonQuery(this.userAId) : undefined;
  }

  get userBQuery() {
    return this.userBId ? buildUserComparisonQuery(this.userBId) : undefined;
  }

  @wire(graphql, { query: '$userAQuery' })
  wiredUserA({ data, errors }) {
    if (!this.userAId) return;
    if (data) {
      this._userAComparisonData = extractComparisonUserNode(data);
      this._userALoadedForId = this.userAId;
    } else if (errors) {
      this._userAComparisonData = undefined;
      this._userALoadedForId = this.userAId;
      this.errorText = errors[0]?.message ?? 'Unknown error loading the first user';
    }
  }

  @wire(graphql, { query: '$userBQuery' })
  wiredUserB({ data, errors }) {
    if (!this.userBId) return;
    if (data) {
      this._userBComparisonData = extractComparisonUserNode(data);
      this._userBLoadedForId = this.userBId;
    } else if (errors) {
      this._userBComparisonData = undefined;
      this._userBLoadedForId = this.userBId;
      this.errorText = errors[0]?.message ?? 'Unknown error loading the second user';
    }
  }

  @wire(getUserAssignments, { firstUserId: '$userAId', secondUserId: '$userBId' })
  wiredAssignments({ data, error }) {
    if (!this.hasBothUsersSelected) return;
    if (data) {
      this._userAAssignments = data[0];
      this._userBAssignments = data[1];
      this._assignmentsLoadedForUserAId = this.userAId;
      this._assignmentsLoadedForUserBId = this.userBId;
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading permission assignments';
    }
  }

  get isLoadingComparison() {
    return (
      this.hasBothUsersSelected &&
      (this._userALoadedForId !== this.userAId ||
        this._userBLoadedForId !== this.userBId ||
        this._assignmentsLoadedForUserAId !== this.userAId ||
        this._assignmentsLoadedForUserBId !== this.userBId)
    );
  }

  get hasComparison() {
    return this.hasBothUsersSelected && !this.isLoadingComparison;
  }

  // Display-ready rowClass computed here (component layer), not in the pure filter/build utils -
  // same split as every other *Utils/*component pair in this app (e.g. FLS Matrix's cellClass).
  // isCheckboxCategory tells the template which cell shape a category's rows carry: the four
  // set-based categories (Permission Sets/Groups, Public Groups, Queues) hold hasA/hasB booleans,
  // rendered as checkboxes rather than repeating the row's own label as text a second and third
  // time; the two field-based categories hold valueA/valueB text, rendered plainly.
  get categories() {
    if (!this.hasComparison) {
      return [];
    }
    const permissionSetsA = this._userAAssignments?.permissionSetLabels;
    const permissionSetsB = this._userBAssignments?.permissionSetLabels;
    const permissionSetGroupsA = this._userAAssignments?.permissionSetGroupLabels;
    const permissionSetGroupsB = this._userBAssignments?.permissionSetGroupLabels;
    const publicGroupsA = this._userAAssignments?.publicGroupNames;
    const publicGroupsB = this._userBAssignments?.publicGroupNames;
    const queuesA = this._userAAssignments?.queueNames;
    const queuesB = this._userBAssignments?.queueNames;

    return [
      { name: 'Basic Settings', isCheckboxCategory: false, rows: buildFieldRows(this._userAComparisonData, this._userBComparisonData, BASIC_SETTINGS_FIELDS) },
      { name: 'Profile & Role', isCheckboxCategory: false, rows: buildFieldRows(this._userAComparisonData, this._userBComparisonData, PROFILE_ROLE_FIELDS) },
      { name: 'Permission Sets', isCheckboxCategory: true, rows: buildSetDiffRows(permissionSetsA, permissionSetsB) },
      { name: 'Permission Set Groups', isCheckboxCategory: true, rows: buildSetDiffRows(permissionSetGroupsA, permissionSetGroupsB) },
      { name: 'Public Groups', isCheckboxCategory: true, rows: buildSetDiffRows(publicGroupsA, publicGroupsB) },
      { name: 'Queues', isCheckboxCategory: true, rows: buildSetDiffRows(queuesA, queuesB) }
    ]
      .map((category) => ({
        ...category,
        rows: filterDifferentOnly(category.rows, this.showAll).map((row) => ({
          ...row,
          rowClass: row.isDifferent ? 'comparison-row comparison-row_different' : 'comparison-row'
        }))
      }))
      .filter((category) => category.rows.length > 0);
  }

  get hasNoDifferences() {
    return this.hasComparison && !this.showAll && this.categories.length === 0;
  }

  handleShowAllToggle(event) {
    this.showAll = event.target.checked;
  }

  handleUserASearchChange(event) {
    this.userASearchTerm = event.target.value;
    this._selectedUserA = undefined;
    this.resetComparisonState();
    window.clearTimeout(this._searchTimerA);
    this._searchTimerA = window.setTimeout(() => this.runSearchA(), SEARCH_DEBOUNCE_MS);
  }

  handleUserBSearchChange(event) {
    this.userBSearchTerm = event.target.value;
    this._selectedUserB = undefined;
    this.resetComparisonState();
    window.clearTimeout(this._searchTimerB);
    this._searchTimerB = window.setTimeout(() => this.runSearchB(), SEARCH_DEBOUNCE_MS);
  }

  async runSearchA() {
    const term = this.userASearchTerm.trim();
    if (!term) {
      this._searchResultsA = [];
      return;
    }
    try {
      this._searchResultsA = await searchUsers({ searchTerm: term });
    } catch (error) {
      // Fail quiet, same choice Record Access Inspector/Org Chart's own search already make - the
      // rest of the form is unaffected either way.
      this._searchResultsA = [];
    }
  }

  async runSearchB() {
    const term = this.userBSearchTerm.trim();
    if (!term) {
      this._searchResultsB = [];
      return;
    }
    try {
      this._searchResultsB = await searchUsers({ searchTerm: term });
    } catch (error) {
      this._searchResultsB = [];
    }
  }

  handleUserAResultClick(event) {
    const userId = event.currentTarget.dataset.userId;
    this._selectedUserA = this._searchResultsA.find((user) => user.id === userId);
    this._searchResultsA = [];
    this.userASearchTerm = this._selectedUserA?.name ?? '';
    this.resetComparisonState();
  }

  handleUserBResultClick(event) {
    const userId = event.currentTarget.dataset.userId;
    this._selectedUserB = this._searchResultsB.find((user) => user.id === userId);
    this._searchResultsB = [];
    this.userBSearchTerm = this._selectedUserB?.name ?? '';
    this.resetComparisonState();
  }

  handleClearUserA() {
    this._selectedUserA = undefined;
    this.userASearchTerm = '';
    this.resetComparisonState();
  }

  handleClearUserB() {
    this._selectedUserB = undefined;
    this.userBSearchTerm = '';
    this.resetComparisonState();
  }

  // Only clears the error banner - comparison data/loaded-tracking for a side that didn't just
  // change is left alone deliberately. isLoadingComparison/hasComparison already key off whether
  // each held result's tracked Id still matches the currently selected Id, so a changed side
  // reads as "loading" on its own the instant its Id changes, without needing to be zeroed out
  // here first - and a side that didn't change keeps showing its still-valid data instead of an
  // unnecessary reload.
  resetComparisonState() {
    this.errorText = undefined;
  }
}
