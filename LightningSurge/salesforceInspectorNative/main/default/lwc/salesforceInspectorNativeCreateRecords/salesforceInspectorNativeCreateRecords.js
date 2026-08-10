import getCreatableObjects from '@salesforce/apex/SalesforceInspectorNativeObjectPickerController.getCreatableObjects';
import GraphqlMultiRecordEntry from 'c/graphqlMultiRecordEntry';
import { NavigationMixin } from 'lightning/navigation';
import { LightningElement, wire } from 'lwc';

// Not @api-configurable for the same reason the other two graphqlMultiRecordEntry launchers
// (graphqlMultiRecordEntryAction, graphqlMultiRecordEntryPage) hard-code these: no Setup-side
// property panel exists for this entry point either. Change them in code if this launch path ever
// needs different values.
const DEFAULT_INITIAL_ROW_COUNT = 1;
const DEFAULT_MAX_ROWS = 200;
const DEFAULT_BATCH_SIZE = 50;

/**
 * Create Records tab content for the Salesforce Inspector Native app: an object picker backed by
 * a live, permission-aware object list (SalesforceInspectorNativeObjectPickerController - the only
 * Apex in this repo, see that class's doc comment for why), which opens graphqlMultiRecordEntry
 * for whichever object is selected.
 * @alias SalesforceInspectorNativeCreateRecords
 * @extends LightningElement
 * @hideconstructor
 */
export default class SalesforceInspectorNativeCreateRecords extends NavigationMixin(LightningElement) {
  isLoadingObjects = true;
  errorText;
  isOpening = false;

  _objectOptions = [];

  @wire(getCreatableObjects)
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

  buildModalConfig(objectApiName) {
    return {
      label: 'Add Records',
      size: 'large',
      objectApiName,
      initialRowCount: DEFAULT_INITIAL_ROW_COUNT,
      maxRows: DEFAULT_MAX_ROWS,
      batchSize: DEFAULT_BATCH_SIZE
    };
  }

  async handleObjectSelect(event) {
    const objectApiName = event.detail.value;
    this.isOpening = true;
    this.errorText = undefined;
    try {
      await GraphqlMultiRecordEntry.open(this.buildModalConfig(objectApiName));
      this.navigateToListView(objectApiName);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error opening the modal';
    } finally {
      this.isOpening = false;
    }
  }

  navigateToListView(objectApiName) {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName, actionName: 'list' }
    });
  }
}
