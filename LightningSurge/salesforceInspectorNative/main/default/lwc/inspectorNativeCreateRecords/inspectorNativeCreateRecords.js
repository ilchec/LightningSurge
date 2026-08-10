import getCreatableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getCreatableObjects';
import { buildRecordTypeQuery, extractRecordTypes } from 'c/inspectorNativeRecordEntryUtils';
import { graphql } from 'lightning/graphql';
import { LightningElement, wire } from 'lwc';

const DEFAULT_LAYOUT_OPTION_VALUE = '__DEFAULT_LAYOUT__';
const ALL_FIELDS_OPTION_VALUE = '__ALL_FIELDS__';
const REQUIRED_ONLY_OPTION_VALUE = '__REQUIRED_ONLY__';

/**
 * Create Records tab content for the Salesforce Inspector Native app: a single row of selectors
 * (object, then layout once an object is picked) with the record-entry grid rendered inline below
 * them - no modal. The object list is backed by InspectorNativeObjectPicker
 * (see that class's doc comment for why it's one of this app's few Apex exceptions); the layout options reuse
 * buildRecordTypeQuery/extractRecordTypes from inspectorNativeRecordEntryUtils, the same pure
 * functions inspectorNativeRecordEntry's own (now-unused-in-this-flow) picker screen is
 * built on, so both stay consistent without duplicating the query-building/parsing logic itself -
 * only the thin combobox glue around it is duplicated here.
 * @alias InspectorNativeCreateRecords
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeCreateRecords extends LightningElement {
  isLoadingObjects = true;
  errorText;

  _objectOptions = [];
  _selectedObjectApiName;
  _availableRecordTypes = [];
  _layoutSelection;

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

  get selectedObjectApiName() {
    return this._selectedObjectApiName;
  }

  get hasSelectedObject() {
    return Boolean(this._selectedObjectApiName);
  }

  // Gates the Record Type query until an object is actually selected - mirrors the same
  // gate-a-wire-on-a-derived-getter pattern inspectorNativeRecordEntry itself uses
  // (wireObjectApiName/pendingGraphqlQuery) to avoid firing a query with nothing to query yet.
  get recordTypeQuery() {
    return this._selectedObjectApiName ? buildRecordTypeQuery(this._selectedObjectApiName) : undefined;
  }

  @wire(graphql, { query: '$recordTypeQuery' })
  wiredRecordTypes({ data }) {
    this._availableRecordTypes = data ? extractRecordTypes({ data }) : [];
  }

  // Same option shape as inspectorNativeRecordEntry's own recordTypeOptions getter -
  // Default Layout / each active Record Type / All Fields / Required Only.
  get recordTypeOptions() {
    return [
      { label: 'Default Layout', value: DEFAULT_LAYOUT_OPTION_VALUE },
      ...this._availableRecordTypes.map((rt) => ({ label: rt.label, value: rt.id })),
      { label: 'All Fields (ignore layout)', value: ALL_FIELDS_OPTION_VALUE },
      { label: 'Required Only (ignore layout)', value: REQUIRED_ONLY_OPTION_VALUE }
    ];
  }

  get isReadyToShowGrid() {
    return Boolean(this._selectedObjectApiName && this._layoutSelection);
  }

  get recordEntryRecordTypeId() {
    return this._layoutSelection?.recordTypeId ?? null;
  }

  get recordEntryShowAllFields() {
    return Boolean(this._layoutSelection?.showAllFields);
  }

  get recordEntryRequiredFieldsOnly() {
    return Boolean(this._layoutSelection?.requiredFieldsOnly);
  }

  get recordEntryUseDefaultLayout() {
    return Boolean(this._layoutSelection?.useDefaultLayout);
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    // A new object invalidates any layout already chosen for the previous one.
    this._availableRecordTypes = [];
    this._layoutSelection = undefined;
  }

  handleLayoutSelect(event) {
    const value = event.detail.value;
    if (value === ALL_FIELDS_OPTION_VALUE) {
      this._layoutSelection = { showAllFields: true };
    } else if (value === REQUIRED_ONLY_OPTION_VALUE) {
      this._layoutSelection = { requiredFieldsOnly: true };
    } else if (value === DEFAULT_LAYOUT_OPTION_VALUE) {
      this._layoutSelection = { useDefaultLayout: true };
    } else {
      this._layoutSelection = { recordTypeId: value };
    }
  }

  // The selector row is this page's permanent anchor - finishing (or cancelling) resets back to
  // "pick an object" rather than navigating anywhere. Results already show clickable links to
  // every saved record, so there's no separate list-view navigation needed here. Resetting
  // isReadyToShowGrid to false destroys the child (it's only rendered lwc:if={isReadyToShowGrid}),
  // guaranteeing the next selection starts from a clean instance with no leftover state.
  handleEntryDone() {
    this.resetSelection();
  }

  handleEntryCancel() {
    this.resetSelection();
  }

  resetSelection() {
    this._selectedObjectApiName = undefined;
    this._availableRecordTypes = [];
    this._layoutSelection = undefined;
  }
}
