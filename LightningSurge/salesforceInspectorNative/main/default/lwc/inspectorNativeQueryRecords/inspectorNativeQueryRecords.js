import runQuery from '@salesforce/apex/InspectorNativeSoqlRunner.runQuery';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { LightningElement } from 'lwc';

const MAX_ROWS = 200;
const QUERY_PLACEHOLDER = 'SELECT Id, Name FROM Account LIMIT 50';

/**
 * Query Records tab content: a SOQL query box whose results are edited/saved in the same grid
 * (Field View/Table View, both save modes) Create Records uses - inspectorNativeRecordEntry
 * in its "query mode" (see that component's queryMode doc comment). Backed by
 * InspectorNativeSoqlRunner, the second (and so far last) Apex exception in this app.
 * @alias InspectorNativeQueryRecords
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeQueryRecords extends LightningElement {
  queryText = '';
  isRunning = false;
  errorText;

  _hasRun = false;
  _objectApiName;
  _fieldApiNames = [];
  _records = [];

  get queryPlaceholder() {
    return QUERY_PLACEHOLDER;
  }

  get isRunDisabled() {
    return this.isRunning || !this.queryText.trim();
  }

  get objectApiName() {
    return this._objectApiName;
  }

  get fieldApiNames() {
    return this._fieldApiNames;
  }

  get records() {
    return this._records;
  }

  get hasResults() {
    return this._hasRun && this._records.length > 0;
  }

  get hasNoResults() {
    return this._hasRun && this._records.length === 0 && !this.errorText;
  }

  handleQueryTextChange(event) {
    this.queryText = event.target.value;
  }

  async handleRunQuery() {
    if (this.isRunDisabled) return;
    this.isRunning = true;
    this.errorText = undefined;
    // Destroys any previously-rendered result grid before the new one mounts (hasResults gates
    // it with lwc:if), guaranteeing a clean instance per query the same way
    // inspectorNativeCreateRecords resets between object selections.
    this._hasRun = false;
    try {
      const result = await runQuery({ soql: this.queryText });
      const records = result.records ?? [];
      const truncated = records.length > MAX_ROWS;
      this._objectApiName = result.objectApiName;
      this._fieldApiNames = result.fieldApiNames ?? [];
      this._records = truncated ? records.slice(0, MAX_ROWS) : records;
      this._hasRun = true;
      if (truncated) {
        showToast(this, 'Row limit reached', `Only the first ${MAX_ROWS} of ${records.length} rows were loaded`, 'warning');
      }
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error running the query';
    } finally {
      this.isRunning = false;
    }
  }

  // The results grid is the permanent-ish surface until reset - finishing (done) or cancelling in
  // the grid both just clear the results, ready for the next query, mirroring
  // inspectorNativeCreateRecords' own reset-in-place pattern.
  handleReset() {
    this._hasRun = false;
    this._objectApiName = undefined;
    this._fieldApiNames = [];
    this._records = [];
  }
}
