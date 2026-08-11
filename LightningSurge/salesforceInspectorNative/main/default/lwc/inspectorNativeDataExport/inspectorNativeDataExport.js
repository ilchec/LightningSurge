import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { buildRowsCsv } from 'c/inspectorNativeCsvUtils';
import { buildExportableFieldOptions, buildExportQuery, extractExportRows } from 'c/inspectorNativeDataExportUtils';
import { InspectorNativeQueryBridge } from 'c/inspectorNativeQueryBridge';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { graphql } from 'lightning/graphql';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

const PAGE_SIZE = 200;
const HARD_ROW_CAP = 50000;

/**
 * Data Export tab: object + field picker instead of hand-typed SOQL (Query Records' own tool for
 * that), streaming past Query Records' 200-row cap via the same cursor-pagination pattern
 * relatedListReloaded's own query building uses - looping pages client-side (via
 * InspectorNativeQueryBridge, the same reactive-wire-to-Promise bridge inspectorNativeRecordEntry
 * uses for its own sequential lookups) until the object is exhausted or a hard safety cap is hit,
 * accumulating into one CSV download. No filtering/WHERE clause in this pass - deliberately scoped
 * to "export everything of this object with these fields", not a second query builder; Query
 * Records already covers the filtered/SOQL case.
 * @alias InspectorNativeDataExport
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeDataExport extends LightningElement {
  isLoadingObjects = true;
  isExporting = false;
  errorText;
  maxRowsInput = '';

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;
  _selectedFieldApiNames = [];
  _queryBridge = new InspectorNativeQueryBridge();
  _pendingQuery;
  _exportedCount = 0;
  _totalRecordCount = 0;

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

  @wire(getObjectInfo, { objectApiName: '$selectedObjectApiName' })
  wiredObjectInfo({ data, error }) {
    if (data) {
      this._objectInfo = data;
      // Every field starts selected - "export everything" is the most useful default; the field
      // picker is there for narrowing down, not for having to opt every field in one at a time.
      this._selectedFieldApiNames = buildExportableFieldOptions(data).map((option) => option.value);
    } else if (error) {
      this._objectInfo = undefined;
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading object fields';
    }
  }

  get hasSchemaLoaded() {
    return Boolean(this._objectInfo);
  }

  get fieldOptions() {
    return this._objectInfo ? buildExportableFieldOptions(this._objectInfo) : [];
  }

  get selectedFieldApiNames() {
    return this._selectedFieldApiNames;
  }

  get isExportDisabled() {
    return this.isExporting || !this.hasSchemaLoaded || this._selectedFieldApiNames.length === 0;
  }

  get exportButtonLabel() {
    return this.isExporting ? `Exporting (${this._exportedCount}${this._totalRecordCount ? ` of ${this._totalRecordCount}` : ''})...` : 'Export CSV';
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

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._objectInfo = undefined;
    this._selectedFieldApiNames = [];
    this.errorText = undefined;
  }

  handleFieldSelectionChange(event) {
    this._selectedFieldApiNames = event.detail.value;
  }

  handleMaxRowsChange(event) {
    this.maxRowsInput = event.target.value;
  }

  // Batched, sequential (one page at a time - the query bridge only supports one request in
  // flight) rather than firing every page's request at once - keeps this predictable and easy to
  // cap/cancel-by-hitting-the-limit, at the cost of a larger export taking noticeably longer than
  // a single giant query would (acceptable for a deliberate, user-initiated bulk export).
  async handleExportClick() {
    if (this.isExportDisabled) return;

    const fieldApiNames = this._selectedFieldApiNames;
    const userCap = Number(this.maxRowsInput);
    const effectiveCap = userCap > 0 ? Math.min(userCap, HARD_ROW_CAP) : HARD_ROW_CAP;

    this.isExporting = true;
    this.errorText = undefined;
    this._exportedCount = 0;
    this._totalRecordCount = 0;
    let allRows = [];
    let afterCursor;
    let hasNextPage = true;

    try {
      while (hasNextPage && allRows.length < effectiveCap) {
        const pageSize = Math.min(PAGE_SIZE, effectiveCap - allRows.length);
        const query = buildExportQuery({ objectApiName: this._selectedObjectApiName, fieldApiNames, pageSize, afterCursor });
        // eslint-disable-next-line no-await-in-loop
        const data = await this.runGraphqlQuery(query);
        const page = extractExportRows(data, this._selectedObjectApiName, fieldApiNames);
        allRows = [...allRows, ...page.rows];
        this._totalRecordCount = page.totalCount;
        this._exportedCount = allRows.length;
        hasNextPage = page.pageInfo.hasNextPage;
        afterCursor = page.pageInfo.endCursor;
      }

      if (hasNextPage) {
        showToast(this, 'Export capped', `Only the first ${allRows.length} record(s) were exported`, 'warning');
      }

      const csv = buildRowsCsv(
        fieldApiNames.map((apiName) => ({ apiName })),
        allRows.map((values) => ({ values }))
      );
      this.downloadCsv(csv, `${this._selectedObjectApiName}_export.csv`);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error exporting records';
    } finally {
      this.isExporting = false;
    }
  }

  downloadCsv(csv, fileName) {
    const link = this.template.querySelector('[data-id="download-link"]');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    link.download = fileName;
    link.click();
  }
}
