import GraphqlMultiRecordEntry from 'c/graphqlMultiRecordEntry';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { LightningElement, wire } from 'lwc';

// lightning__UrlAddressable pages can only ever be configured via URL parameters, not the
// <property> tag/Setup UI, so exposing these as configurable would gain nothing - hard-coded to
// match graphqlMultiRecordEntry's own defaults (and graphqlMultiRecordEntryAction's, the other
// launcher, for the same reason). Change them in code if this launch path ever needs different
// values.
const DEFAULT_INITIAL_ROW_COUNT = 1;
const DEFAULT_MAX_ROWS = 200;
const DEFAULT_BATCH_SIZE = 50;

// One short retry before giving up on auto-open. The Lightning Overlay Library that
// LightningModal depends on isn't always ready on the very first paint of a
// lightning__UrlAddressable page reached via a list view button click (a full route change,
// unlike an in-app NavigationMixin.Navigate), so .open() can fail silently on that first attempt.
const AUTO_OPEN_RETRY_DELAY_MS = 300;

/**
 * URL-addressable launcher for graphqlMultiRecordEntry, so a List View custom button
 * (Content Source: URL, pointing at /lightning/cmp/c__graphqlMultiRecordEntryPage) can open the
 * modal without a record context. The object to create records for isn't implied by a list view
 * the way it is for a record's Quick Action, so it must be passed as a URL parameter:
 * /lightning/cmp/c__graphqlMultiRecordEntryPage?c__objectApiName=Lead
 * (optionally add &c__recordTypeId=..., &c__layoutDeveloperName=..., &c__showAllFields=true, or
 * &c__requiredFieldsOnly=true, to skip the in-modal layout picker that otherwise always shows
 * first). Once the modal closes - saved or cancelled - this page navigates to the object's list
 * view, since a standalone page needs somewhere to land. Always
 * renders a visible "Add Records" button (not just an auto-open attempt) so a failed first
 * attempt leaves the user something to click instead of a page that looks blank until refreshed.
 * @alias GraphqlMultiRecordEntryPage
 * @extends LightningElement
 * @hideconstructor
 */
export default class GraphqlMultiRecordEntryPage extends NavigationMixin(LightningElement) {
  diagnosticsText;
  errorText;
  isOpening = false;

  _pageReference;
  _pageReferenceReceived = false;
  _autoOpenAttempted = false;

  @wire(CurrentPageReference)
  wiredPageReference(pageReference) {
    this._pageReference = pageReference;
    this._pageReferenceReceived = true;
    this.tryAutoOpen();
  }

  connectedCallback() {
    this.tryAutoOpen();
  }

  get objectApiName() {
    return this._pageReference?.state?.c__objectApiName || null;
  }

  get recordTypeId() {
    return this._pageReference?.state?.c__recordTypeId || null;
  }

  get layoutDeveloperName() {
    return this._pageReference?.state?.c__layoutDeveloperName || null;
  }

  get showAllFields() {
    return this._pageReference?.state?.c__showAllFields === 'true';
  }

  get requiredFieldsOnly() {
    return this._pageReference?.state?.c__requiredFieldsOnly === 'true';
  }

  tryAutoOpen() {
    if (this._autoOpenAttempted || !this._pageReferenceReceived) return;
    this._autoOpenAttempted = true;
    if (this.objectApiName) {
      this.openModal();
    } else {
      this.handleMissingObjectApiName();
    }
  }

  handleMissingObjectApiName() {
    this.diagnosticsText = [
      'objectApiName is required. Point the list view button at:',
      '/lightning/cmp/c__graphqlMultiRecordEntryPage?c__objectApiName=Lead',
      '(optionally add &c__recordTypeId=...).',
      '',
      `Received page reference state: ${JSON.stringify(this._pageReference?.state ?? {}, null, 2)}`
    ].join('\n');
  }

  buildModalConfig() {
    const config = {
      label: 'Add Records',
      size: 'large',
      objectApiName: this.objectApiName,
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

  handleOpenClick() {
    this.openModal();
  }

  async openModal(isRetry = false) {
    this.isOpening = true;
    this.errorText = undefined;
    try {
      await GraphqlMultiRecordEntry.open(this.buildModalConfig());
      this.navigateToListView();
    } catch (error) {
      if (!isRetry) {
        await new Promise((resolve) => setTimeout(resolve, AUTO_OPEN_RETRY_DELAY_MS));
        await this.openModal(true);
        return;
      }
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error opening the modal';
    } finally {
      this.isOpening = false;
    }
  }

  navigateToListView() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: this.objectApiName, actionName: 'list' }
    });
  }
}
