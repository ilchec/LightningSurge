import runQuery from '@salesforce/apex/InspectorNativeSoqlRunner.runQuery';
import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import {
  buildMaskingColumns,
  buildMaskingRows,
  buildMaskingSoql,
  buildMatchedIdMap,
  buildPreviewRows,
  filterMaskableFields
} from 'c/inspectorNativeDataMaskingUtils';
import { buildUpsertMutation, extractSaveResults } from 'c/inspectorNativeRecordEntryUtils';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { executeMutation } from 'lightning/graphql';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

const DEFAULT_MAX_ROWS = 50;
const HARD_MAX_ROWS = 200;

/**
 * Data Masking tab: overwrite a small, fixed set of built-in fake values (name/email/phone/generic
 * text) across a chosen object's records - for scrubbing a sandbox before handing it to a vendor or
 * QA, without Data Loader. No new Apex - reuses InspectorNativeSoqlRunner.runQuery (the same read
 * path Query Records already uses) and inspectorNativeRecordEntryUtils's buildUpsertMutation/
 * extractSaveResults (the same GraphQL mutation builder Query Records already trusts to save edited
 * rows). See inspectorNativeDataMaskingUtils's own doc comment for the fake-value generators and why
 * this reuses rather than duplicates the save path.
 *
 * Preview-then-apply, not a silent overwrite - Preview runs the read and generates the replacement
 * values without touching anything; Apply is the only step that actually writes. Row count is capped
 * at 200 (a write operation, not a read one - kept modest deliberately, unlike Data Export's much
 * higher read-only cap).
 * @alias InspectorNativeDataMasking
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeDataMasking extends LightningElement {
  isLoadingObjects = true;
  isPreviewing = false;
  isApplying = false;
  errorText;
  maxRows = DEFAULT_MAX_ROWS;

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;
  _selectedFieldApiNames = [];
  _previewRows;
  _appliedResults;

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
    } else if (error) {
      this._objectInfo = undefined;
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading object schema';
    }
  }

  get maskableFields() {
    return this._objectInfo ? filterMaskableFields(this._objectInfo) : [];
  }

  get fieldOptions() {
    return this.maskableFields.map((field) => ({ label: `${field.label} (${field.dataType})`, value: field.apiName }));
  }

  get hasNoMaskableFields() {
    return Boolean(this._objectInfo) && this.fieldOptions.length === 0;
  }

  get selectedFieldApiNames() {
    return this._selectedFieldApiNames;
  }

  get isPreviewDisabled() {
    return this.isPreviewing || !this.hasSelectedObject || this._selectedFieldApiNames.length === 0 || !this.maxRows || this.maxRows < 1;
  }

  get hasPreview() {
    return Boolean(this._previewRows);
  }

  get previewRowCount() {
    return this._previewRows?.length ?? 0;
  }

  get hasNoPreviewRows() {
    return this.hasPreview && this.previewRowCount === 0;
  }

  get isApplyDisabled() {
    return this.isApplying || !this.hasPreview || this.previewRowCount === 0;
  }

  get appliedResults() {
    return this._appliedResults ?? [];
  }

  get appliedSuccessCount() {
    return this.appliedResults.filter((result) => result.success).length;
  }

  get appliedFailureCount() {
    return this.appliedResults.length - this.appliedSuccessCount;
  }

  get hasAppliedResults() {
    return Boolean(this._appliedResults);
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._objectInfo = undefined;
    this._selectedFieldApiNames = [];
    this._previewRows = undefined;
    this._appliedResults = undefined;
    this.errorText = undefined;
  }

  handleFieldSelectionChange(event) {
    this._selectedFieldApiNames = event.detail.value;
    this._previewRows = undefined;
    this._appliedResults = undefined;
  }

  handleMaxRowsChange(event) {
    const parsed = parseInt(event.target.value, 10);
    this.maxRows = Number.isNaN(parsed) ? null : Math.min(parsed, HARD_MAX_ROWS);
  }

  async handlePreviewClick() {
    if (this.isPreviewDisabled) return;
    this.isPreviewing = true;
    this.errorText = undefined;
    this._previewRows = undefined;
    this._appliedResults = undefined;
    try {
      const fields = this.maskableFields.filter((field) => this._selectedFieldApiNames.includes(field.apiName));
      const soql = buildMaskingSoql(this._selectedObjectApiName, fields.map((field) => field.apiName), this.maxRows);
      const result = await runQuery({ soql });
      this._previewRows = buildPreviewRows(result.records, fields);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error previewing masked values';
    } finally {
      this.isPreviewing = false;
    }
  }

  // Display-ready rows (component layer), not in the pure buildPreviewRows utility - same split as
  // every other *Utils/*component pair in this app.
  get previewDisplayRows() {
    return (this._previewRows ?? []).map((row) => ({ id: row.id, cells: row.cells }));
  }

  // Header labels for the preview table - a separate getter (not read off previewDisplayRows[0])
  // so the header still renders correctly even if a preview ever comes back with zero rows.
  get previewFieldHeaders() {
    return this.maskableFields.filter((field) => this._selectedFieldApiNames.includes(field.apiName));
  }

  async handleApplyClick() {
    if (this.isApplyDisabled) return;
    this.isApplying = true;
    try {
      const fields = this.maskableFields.filter((field) => this._selectedFieldApiNames.includes(field.apiName));
      const columns = buildMaskingColumns(fields);
      const rows = buildMaskingRows(this._previewRows);
      const matchedIdByClientId = buildMatchedIdMap(this._previewRows);
      const mutation = buildUpsertMutation(this._selectedObjectApiName, columns, rows, matchedIdByClientId);
      const result = await executeMutation({ query: mutation });
      this._appliedResults = extractSaveResults(result, rows, matchedIdByClientId);
      const failureCount = this._appliedResults.filter((r) => !r.success).length;
      if (failureCount === 0) {
        showToast(this, 'Success', `Masked ${this._appliedResults.length} record(s)`, 'success');
      } else {
        showToast(this, 'Masking finished with errors', `${failureCount} of ${this._appliedResults.length} record(s) failed - see details below.`, 'warning');
      }
      this._previewRows = undefined;
    } catch (error) {
      showToast(this, 'Error applying masking', error?.body?.message ?? error?.message ?? 'Unknown error', 'error');
    } finally {
      this.isApplying = false;
    }
  }
}
