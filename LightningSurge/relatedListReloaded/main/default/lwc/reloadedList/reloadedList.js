import ReloadedListRecordForm from 'c/reloadedListRecordForm';
import {
  buildDeleteMutation,
  buildListQuery,
  extractRecordFromNode,
  isFilterableFieldType,
  isSortableFieldType,
  navigateToRecord,
  showToast
} from 'c/reloadedListUtils';
import LightningConfirm from 'lightning/confirm';
import { executeMutation, graphql } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { getRelatedListInfo } from 'lightning/uiRelatedListApi';
import { LightningElement, api, wire } from 'lwc';

const ROWS_WHEN_EXPANDED = 15;
const FILTER_DEBOUNCE_MS = 300;
const NUMERIC_DATA_TYPES = new Set(['Int', 'Double', 'Long', 'Currency', 'Percent']);

function filterInputTypeFor(dataType) {
  if (NUMERIC_DATA_TYPES.has(dataType)) {
    return 'number';
  }
  if (dataType === 'Date' || dataType === 'DateTime') {
    return 'date';
  }
  return 'text';
}

/**
 * A standalone, GraphQL-powered stand-in for the standard Lightning related list: same look and
 * behavior (title/icon/count, sortable columns, New, per-row Edit/Delete, click a row to navigate),
 * plus two things the standard one doesn't have - an inline Expand toggle (compact preview -> up to
 * 15 rows with Previous/Next pagination) and a filter input per column. Column configuration comes
 * from getRelatedListInfo with its default restrictColumnsToLayout - the same page-layout-driven
 * config the standard related list itself renders from. See relatedListReloaded/README.md for the
 * full design rationale (including the one flagged getRelatedListInfo shape uncertainty).
 * @alias ReloadedList
 * @extends LightningElement
 * @hideconstructor
 */
export default class ReloadedList extends NavigationMixin(LightningElement) {
  @api recordId;
  @api objectApiName;
  @api relationshipApiName;
  @api rowsWhenCollapsed = 4;

  isLoading = true;
  errorText;
  isExpanded = false;

  _parentObjectInfo;
  _childObjectInfo;
  _displayColumns;
  _records = [];
  _totalRecordCount = 0;
  _sortField;
  _sortDirection = 'asc';
  _columnFiltersByField = new Map();
  _cursorCache = [null];
  _currentPage = 1;
  _filterTimer;
  _refresh;

  @wire(getObjectInfo, { objectApiName: '$objectApiName' })
  wiredParentObjectInfo({ data, error }) {
    if (data) {
      this._parentObjectInfo = data;
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading object info';
    }
  }

  get childRelationship() {
    return this._parentObjectInfo?.childRelationships?.find((rel) => rel.relationshipName === this.relationshipApiName);
  }

  get childObjectApiName() {
    return this.childRelationship?.childObjectApiName;
  }

  get parentFieldApiName() {
    return this.childRelationship?.fieldName;
  }

  @wire(getObjectInfo, { objectApiName: '$childObjectApiName' })
  wiredChildObjectInfo({ data, error }) {
    if (data) {
      this._childObjectInfo = data;
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading related object info';
    }
  }

  @wire(getRelatedListInfo, { parentObjectApiName: '$objectApiName', relatedListId: '$relationshipApiName' })
  wiredRelatedListInfo({ data, error }) {
    if (data) {
      this._displayColumns = data.displayColumns;
    } else if (error) {
      this.isLoading = false;
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading related list configuration';
    }
  }

  get columns() {
    if (!this._displayColumns || !this._childObjectInfo) {
      return [];
    }
    const fieldsInfo = this._childObjectInfo.fields;
    return this._displayColumns.map((displayColumn) => {
      const fieldInfo = fieldsInfo[displayColumn.fieldApiName];
      const dataType = fieldInfo?.dataType ?? 'String';
      const isSorted = this._sortField === displayColumn.fieldApiName;
      return {
        fieldApiName: displayColumn.fieldApiName,
        label: displayColumn.label || fieldInfo?.label || displayColumn.fieldApiName,
        dataType,
        sortable: isSortableFieldType(dataType),
        filterable: isFilterableFieldType(dataType),
        isBooleanFilter: dataType === 'Boolean',
        filterInputType: filterInputTypeFor(dataType),
        isSorted,
        // Always shown on every sortable column (not just the active one) so sorting is
        // discoverable - dimmed via CSS when this isn't the active sort column.
        sortIconName: isSorted && this._sortDirection === 'desc' ? 'utility:arrowdown' : 'utility:arrowup',
        sortIconClass: isSorted ? 'sort-icon sort-icon_active' : 'sort-icon'
      };
    });
  }

  get fieldApiNames() {
    return this.columns.map((column) => column.fieldApiName);
  }

  get fieldDataTypes() {
    const map = {};
    this.columns.forEach((column) => {
      map[column.fieldApiName] = column.dataType;
    });
    return map;
  }

  get pageSize() {
    return this.isExpanded ? ROWS_WHEN_EXPANDED : Number(this.rowsWhenCollapsed);
  }

  get columnFilters() {
    return Array.from(this._columnFiltersByField.entries()).map(([fieldApiName, value]) => ({
      fieldApiName,
      dataType: this.fieldDataTypes[fieldApiName],
      value
    }));
  }

  get listQuery() {
    if (!this.recordId || !this.childObjectApiName || !this.parentFieldApiName || !this.fieldApiNames.length) {
      return undefined;
    }
    return buildListQuery({
      childObjectApiName: this.childObjectApiName,
      parentFieldApiName: this.parentFieldApiName,
      parentRecordId: this.recordId,
      fieldApiNames: this.fieldApiNames,
      columnFilters: this.columnFilters,
      sortField: this._sortField,
      sortDirection: this._sortDirection,
      pageSize: this.pageSize,
      afterCursor: this._cursorCache[this._currentPage - 1] || null
    });
  }

  @wire(graphql, { query: '$listQuery' })
  wiredList({ data, errors, refresh }) {
    this._refresh = refresh;
    if (data) {
      this.isLoading = false;
      this.errorText = undefined;
      const result = data.uiapi.query[this.childObjectApiName];
      this._totalRecordCount = result.totalCount;
      this._records = result.edges.map(({ node }) => extractRecordFromNode(node, this.fieldApiNames, this.fieldDataTypes));
      const { hasNextPage, endCursor } = result.pageInfo;
      if (hasNextPage && this._cursorCache.length <= this._currentPage) {
        this._cursorCache = [...this._cursorCache, endCursor];
      }
    } else if (errors) {
      this.isLoading = false;
      this.errorText = errors[0]?.message ?? 'Unknown error loading records';
    }
  }

  refreshList() {
    return this._refresh?.() ?? Promise.resolve();
  }

  get displayRows() {
    return this._records.map((record) => ({
      id: record.Id,
      cells: this.columns.map((column, index) => ({
        key: `${record.Id}-${column.fieldApiName}`,
        value: record[column.fieldApiName],
        isFirstColumn: index === 0,
        isBoolean: column.dataType === 'Boolean'
      }))
    }));
  }

  get objectIconUrl() {
    return this._childObjectInfo?.themeInfo?.iconUrl;
  }

  // ObjectInfo.themeInfo only gives a color and an icon URL, not an SLDS "standard:x" token
  // lightning-icon could use directly - this reproduces the colored-square icon container the
  // standard related list itself uses, without guessing at a token that might not exist for every
  // object.
  get objectIconContainerStyle() {
    const color = this._childObjectInfo?.themeInfo?.color;
    return color ? `background-color: #${color};` : '';
  }

  get headerLabel() {
    const label = this._childObjectInfo?.labelPlural ?? this.relationshipApiName ?? '';
    return `${label} (${this._totalRecordCount})`;
  }

  get canCreate() {
    return this._childObjectInfo?.createable === true;
  }

  get canExpand() {
    return this._totalRecordCount > Number(this.rowsWhenCollapsed);
  }

  get expandToggleLabel() {
    return this.isExpanded ? 'Show Less' : `View All (${this._totalRecordCount})`;
  }

  get showPagination() {
    return this.isExpanded && this.totalPages > 1;
  }

  get totalPages() {
    return Math.ceil(this._totalRecordCount / this.pageSize) || 1;
  }

  get isFirstPage() {
    return this._currentPage <= 1;
  }

  get isLastPage() {
    return this._currentPage >= this.totalPages;
  }

  get paginationLabel() {
    return `Page ${this._currentPage} of ${this.totalPages}`;
  }

  get hasNoRecords() {
    return !this.isLoading && !this.errorText && this._records.length === 0;
  }

  resetPaging() {
    this._currentPage = 1;
    this._cursorCache = [null];
  }

  handleToggleExpand() {
    this.isExpanded = !this.isExpanded;
    this.resetPaging();
  }

  handleSort(event) {
    const fieldApiName = event.currentTarget.dataset.field;
    if (this._sortField === fieldApiName) {
      this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this._sortField = fieldApiName;
      this._sortDirection = 'asc';
    }
    this.resetPaging();
  }

  get booleanFilterOptions() {
    return [
      { label: 'Any', value: '' },
      { label: 'True', value: 'true' },
      { label: 'False', value: 'false' }
    ];
  }

  handleFilterChange(event) {
    const fieldApiName = event.currentTarget.dataset.field;
    this.debounceFilterUpdate(fieldApiName, event.target.value);
  }

  // lightning-combobox (used for Boolean columns' Any/True/False filter) reports its value via
  // event.detail rather than event.target, unlike lightning-input - kept as a separate handler
  // rather than branching inside handleFilterChange.
  handleBooleanFilterChange(event) {
    const fieldApiName = event.currentTarget.dataset.field;
    this.debounceFilterUpdate(fieldApiName, event.detail.value);
  }

  debounceFilterUpdate(fieldApiName, value) {
    window.clearTimeout(this._filterTimer);
    this._filterTimer = window.setTimeout(() => {
      const updated = new Map(this._columnFiltersByField);
      if (value) {
        updated.set(fieldApiName, value);
      } else {
        updated.delete(fieldApiName);
      }
      this._columnFiltersByField = updated;
      this.resetPaging();
    }, FILTER_DEBOUNCE_MS);
  }

  handlePreviousPage() {
    if (this._currentPage > 1) {
      this._currentPage -= 1;
    }
  }

  handleNextPage() {
    if (this._currentPage < this.totalPages) {
      this._currentPage += 1;
    }
  }

  handleRowClick(event) {
    event.preventDefault();
    const recordIdToOpen = event.currentTarget.dataset.id;
    navigateToRecord(this, recordIdToOpen, 'view');
  }

  async handleNewClick() {
    const result = await ReloadedListRecordForm.open({
      size: 'medium',
      objectApiName: this.childObjectApiName,
      objectLabel: this._childObjectInfo?.label
    });
    if (result) {
      this.refreshList();
    }
  }

  async handleRowAction(event) {
    const action = event.detail.value;
    const recordIdForRow = event.currentTarget.dataset.id;
    if (action === 'edit') {
      const result = await ReloadedListRecordForm.open({
        size: 'medium',
        objectApiName: this.childObjectApiName,
        objectLabel: this._childObjectInfo?.label,
        recordId: recordIdForRow
      });
      if (result) {
        this.refreshList();
      }
    } else if (action === 'delete') {
      this.confirmAndDelete(recordIdForRow);
    }
  }

  async confirmAndDelete(recordIdToDelete) {
    const confirmed = await LightningConfirm.open({
      message: "Delete this record? This can't be undone.",
      label: 'Delete Record',
      theme: 'error'
    });
    if (!confirmed) {
      return;
    }
    try {
      const result = await executeMutation({ query: buildDeleteMutation(this.childObjectApiName, recordIdToDelete) });
      if (result?.errors?.length) {
        showToast(this, 'Error deleting record', result.errors[0]?.message ?? 'Unknown error', 'error');
        return;
      }
      showToast(this, 'Success', 'Record deleted', 'success');
      this.refreshList();
    } catch (error) {
      showToast(this, 'Error deleting record', error?.body?.message ?? error?.message ?? 'Unknown error', 'error');
    }
  }
}
