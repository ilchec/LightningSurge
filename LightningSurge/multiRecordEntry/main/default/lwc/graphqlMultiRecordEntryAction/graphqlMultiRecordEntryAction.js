import GraphqlMultiRecordEntry from 'c/graphqlMultiRecordEntry';
import { CloseActionScreenEvent } from 'lightning/actions';
import { CurrentPageReference } from 'lightning/navigation';
import { RefreshEvent } from 'lightning/refresh';
import { api, LightningElement, wire } from 'lwc';

// Deliberately not @api properties: graphqlMultiRecordEntryPage (the other launcher) can only
// ever be configured via URL parameters, so exposing these as Setup-configurable here but not
// there would just be an inconsistency between the two, not a real capability gained - both
// launchers hard-code the same values here for that reason. Change them in code if a given
// deployment needs different values.
const DEFAULT_INITIAL_ROW_COUNT = 1;
const DEFAULT_MAX_ROWS = 200;
const DEFAULT_BATCH_SIZE = 50;

/**
 * Quick Action launcher for graphqlMultiRecordEntry. lightning/modal components can't be used as
 * a lightning__RecordAction target directly (they aren't rendered inline), so this thin component
 * opens the modal on load and closes the action panel once the user is done.
 *
 * lightning__RecordAction does not auto-inject objectApiName for a plain (non-override) Quick
 * Action, so it's parsed out of CurrentPageReference instead: for a standard__quickAction page
 * reference, attributes.apiName is "{ObjectApiName}.{ActionName}" (state.objectApiName is always
 * null). Falls back to an explicit objectApiName if one was somehow provided directly.
 * @alias GraphqlMultiRecordEntryAction
 * @extends LightningElement
 * @hideconstructor
 */
export default class GraphqlMultiRecordEntryAction extends LightningElement {
  /** API name of the object to create records for, if not derivable from the current page. @type {string} */
  @api objectApiName;

  /** Id of the record the action was invoked from, if the platform provides one. @type {string} */
  @api recordId;

  /** Optional record type applied to every row in this batch. @type {string} */
  @api recordTypeId;

  /**
   * Optional Record Type DeveloperName used to resolve a layout when the object has more than
   * one active Record Type and recordTypeId wasn't set. Ignored if recordTypeId is set; if it
   * doesn't match, the layout picker is shown instead. @type {string}
   */
  @api layoutDeveloperName;

  /**
   * Skips the layout picker and shows every createable field on the object, ignoring the
   * assigned layout. Takes priority over layoutDeveloperName but not recordTypeId. @type {boolean}
   */
  @api showAllFields = false;

  /**
   * Skips the layout picker and shows only fields genuinely required by the object itself,
   * ignoring the assigned layout. Also the only way to reach a layout's required fields when
   * that layout was never assigned to any Record Type. Takes priority over layoutDeveloperName
   * but not recordTypeId or showAllFields. @type {boolean}
   */
  @api requiredFieldsOnly = false;

  diagnosticsText;

  _pageReference;
  _pageReferenceReceived = false;
  _handled = false;

  @wire(CurrentPageReference)
  wiredPageReference(pageReference) {
    this._pageReference = pageReference;
    this._pageReferenceReceived = true;
    this.tryHandleAction();
  }

  connectedCallback() {
    this.tryHandleAction();
  }

  get resolvedObjectApiName() {
    if (this.objectApiName) return this.objectApiName;
    // For a standard__quickAction page reference, attributes.apiName is "{ObjectApiName}.{ActionName}"
    // (e.g. "Lead.Add_Multiple_Records") - state.objectApiName is present but always null.
    const quickActionApiName = this._pageReference?.attributes?.apiName;
    if (quickActionApiName?.includes('.')) return quickActionApiName.split('.')[0];
    return this._pageReference?.state?.objectApiName || null;
  }

  tryHandleAction() {
    if (this._handled) return;
    if (!this.objectApiName && !this._pageReferenceReceived) return;
    this._handled = true;
    if (this.resolvedObjectApiName) {
      this.openModal();
    } else {
      this.handleMissingObjectApiName();
    }
  }

  // TEMPORARY DIAGNOSTIC: renders every context value we've tried so far, since none of them have
  // reliably carried objectApiName in testing, and the panel stays open (no auto-close) so the
  // full text can be read/copied. Report it back so this can be fixed to read from whatever field
  // actually holds it, instead of guessing again.
  handleMissingObjectApiName() {
    const diagnostics = {
      objectApiName: this.objectApiName,
      recordId: this.recordId,
      recordTypeId: this.recordTypeId,
      pageReference: this._pageReference
    };
    this.diagnosticsText = JSON.stringify(diagnostics, null, 2);
  }

  handleDiagnosticsClose() {
    this.dispatchEvent(new CloseActionScreenEvent());
  }

  buildModalConfig() {
    const config = {
      label: 'Add Records',
      size: 'large',
      objectApiName: this.resolvedObjectApiName,
      initialRowCount: DEFAULT_INITIAL_ROW_COUNT,
      maxRows: DEFAULT_MAX_ROWS,
      batchSize: DEFAULT_BATCH_SIZE
    };
    if (this.recordTypeId) config.recordTypeId = this.recordTypeId;
    if (this.layoutDeveloperName) config.layoutDeveloperName = this.layoutDeveloperName;
    if (this.showAllFields) config.showAllFields = this.showAllFields;
    if (this.requiredFieldsOnly) config.requiredFieldsOnly = this.requiredFieldsOnly;
    return config;
  }

  async openModal() {
    const result = await GraphqlMultiRecordEntry.open(this.buildModalConfig());
    if (result?.createdRecordIds?.length || result?.updatedRecordIds?.length) {
      this.dispatchEvent(new RefreshEvent());
    }
    this.dispatchEvent(new CloseActionScreenEvent());
  }
}