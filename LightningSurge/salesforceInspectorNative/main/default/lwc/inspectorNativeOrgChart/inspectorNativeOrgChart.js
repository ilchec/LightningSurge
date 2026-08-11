import CURRENT_USER_ID from '@salesforce/user/Id';
import {
  buildDirectReportsQuery,
  buildUserNodeQuery,
  buildUserSearchQuery,
  extractDirectReports,
  extractSearchResults,
  extractUserNode
} from 'c/inspectorNativeOrgChartUtils';
import { InspectorNativeQueryBridge } from 'c/inspectorNativeQueryBridge';
import { graphql } from 'lightning/graphql';
import { LightningElement, wire } from 'lwc';

const REPORTS_PAGE_SIZE = 20;
const SEARCH_RESULT_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Org Chart tab: browse the User ManagerId hierarchy - a "Reports To" node, the currently-centered
 * user, and their Direct Reports (with real cursor pagination, not a client-side cap - see
 * inspectorNativeOrgChartUtils' own doc comment) - the same one-hop-at-a-time, click-to-recenter
 * hub-and-spoke layout Relationship Map already established in this app, applied to people instead
 * of object schema. Opens on the current user by default; the search box jumps straight to anyone
 * else. Entirely GraphQL - no Apex at all, not even an object picker (User is the only object this
 * tab ever queries).
 *
 * Inspired by (not a code port of) svierk/awesome-lwc-collection's orgChartViewer
 * (https://github.com/svierk/awesome-lwc-collection/tree/main/force-app/main/default/lwc/orgChartViewer,
 * MIT licensed) - that component renders an interactive, pannable/zoomable chart via a ~324 KB
 * third-party static resource (d3 + d3-flextree + d3-org-chart) loaded at runtime. This app's own
 * convention (see the top-level README) is fully self-contained, no external scripts - so rather
 * than take on that dependency, this is a from-scratch reimplementation in the same spirit (search,
 * click-to-navigate a hierarchy) using this app's own established patterns instead. It doesn't
 * replicate the original's pan/zoom/expand-collapse canvas or PNG export.
 * @alias InspectorNativeOrgChart
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeOrgChart extends LightningElement {
  isLoadingUser = false;
  isLoadingReports = false;
  errorText;
  searchTerm = '';

  _currentUser;
  _directReports = [];
  _reportsTotalCount = 0;
  _reportsHasNextPage = false;
  _reportsCursor;
  _searchResults = [];
  _searchTimer;
  _queryBridge = new InspectorNativeQueryBridge();
  _pendingQuery;

  connectedCallback() {
    this.selectUser(CURRENT_USER_ID);
  }

  get pendingGraphqlQuery() {
    return this._pendingQuery;
  }

  @wire(graphql, { query: '$pendingGraphqlQuery' })
  wiredPendingQuery(result) {
    this._queryBridge.handleResult(result);
  }

  runGraphqlQuery(query) {
    const promise = this._queryBridge.beginRequest();
    this._pendingQuery = query;
    return promise;
  }

  get hasCurrentUser() {
    return Boolean(this._currentUser);
  }

  get centerName() {
    return this._currentUser?.name ?? '';
  }

  get centerTitle() {
    return this._currentUser?.title ?? '';
  }

  get hasManager() {
    return Boolean(this._currentUser?.managerId);
  }

  get managerNode() {
    return this._currentUser
      ? { id: this._currentUser.managerId, name: this._currentUser.managerName, title: this._currentUser.managerTitle }
      : null;
  }

  get directReports() {
    return this._directReports;
  }

  get hasNoDirectReports() {
    return this.hasCurrentUser && this._directReports.length === 0;
  }

  get directReportsCountLabel() {
    return `Direct Reports (${this._reportsTotalCount})`;
  }

  get hasMoreReports() {
    return this._reportsHasNextPage;
  }

  get remainingReportsCount() {
    return Math.max(0, this._reportsTotalCount - this._directReports.length);
  }

  get searchResults() {
    return this._searchResults;
  }

  get hasSearchResults() {
    return this._searchResults.length > 0;
  }

  async selectUser(userId) {
    if (!userId) {
      return;
    }
    this.isLoadingUser = true;
    this.errorText = undefined;
    this._directReports = [];
    this._reportsCursor = undefined;
    this._reportsHasNextPage = false;
    this._reportsTotalCount = 0;
    try {
      const data = await this.runGraphqlQuery(buildUserNodeQuery(userId));
      const node = extractUserNode(data);
      if (!node) {
        this.errorText = "That user wasn't found, or isn't visible to you.";
        this._currentUser = undefined;
        return;
      }
      this._currentUser = node;
      await this.loadDirectReportsPage(node.id);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading the org chart';
    } finally {
      this.isLoadingUser = false;
    }
  }

  async loadDirectReportsPage(userId) {
    const data = await this.runGraphqlQuery(buildDirectReportsQuery(userId, REPORTS_PAGE_SIZE, this._reportsCursor));
    const page = extractDirectReports(data);
    this._directReports = [...this._directReports, ...page.rows];
    this._reportsTotalCount = page.totalCount;
    this._reportsHasNextPage = page.pageInfo.hasNextPage;
    this._reportsCursor = page.pageInfo.endCursor;
  }

  async handleShowMoreReports() {
    if (!this._reportsHasNextPage || this.isLoadingReports) {
      return;
    }
    this.isLoadingReports = true;
    try {
      await this.loadDirectReportsPage(this._currentUser.id);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading more direct reports';
    } finally {
      this.isLoadingReports = false;
    }
  }

  handleNodeClick(event) {
    const userId = event.currentTarget.dataset.userId;
    if (!userId || userId === this._currentUser?.id) {
      return;
    }
    this.searchTerm = '';
    this._searchResults = [];
    this.selectUser(userId);
  }

  handleSearchChange(event) {
    this.searchTerm = event.target.value;
    window.clearTimeout(this._searchTimer);
    this._searchTimer = window.setTimeout(() => this.runSearch(), SEARCH_DEBOUNCE_MS);
  }

  async runSearch() {
    const term = this.searchTerm.trim();
    if (!term) {
      this._searchResults = [];
      return;
    }
    try {
      const data = await this.runGraphqlQuery(buildUserSearchQuery(term, SEARCH_RESULT_LIMIT));
      this._searchResults = extractSearchResults(data);
    } catch (error) {
      // A failed search just shows no results rather than surfacing an error banner - the user can
      // keep typing, and the main chart (already loaded) is unaffected either way.
      this._searchResults = [];
    }
  }

  handleSearchResultClick(event) {
    const userId = event.currentTarget.dataset.userId;
    this.searchTerm = '';
    this._searchResults = [];
    this.selectUser(userId);
  }
}
