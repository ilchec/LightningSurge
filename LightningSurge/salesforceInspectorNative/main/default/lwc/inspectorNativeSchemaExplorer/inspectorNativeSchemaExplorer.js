import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { buildFieldRows, buildFieldSetupUrl, filterFieldRows } from 'c/inspectorNativeSchemaExplorerUtils';
import { NavigationMixin } from 'lightning/navigation';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

/**
 * Schema Explorer tab: pick an object, browse every field it has - label, API name, type,
 * required/unique/external ID/createable/updateable, and what it references - in one searchable
 * table. Entirely UI API-driven (getObjectInfo, the same wire every other tab in this app already
 * uses for field metadata); the only Apex involved is the same InspectorNativeObjectPicker object
 * list every other picker in this app uses, here via its broader getQueryableObjects (this tool
 * has nothing to do with creating records, so createable-only would wrongly hide objects). Each
 * row's pencil icon opens that field's Setup detail page in a new tab - see
 * inspectorNativeSchemaExplorerUtils.buildFieldSetupUrl for why it's the plain-API-name URL form,
 * not the more robust DurableId-resolved one.
 * @alias InspectorNativeSchemaExplorer
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeSchemaExplorer extends NavigationMixin(LightningElement) {
  isLoadingObjects = true;
  errorText;
  searchTerm = '';

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;

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

  get hasSchemaLoaded() {
    return Boolean(this._objectInfo);
  }

  get isLoadingSchema() {
    return this.hasSelectedObject && !this.hasSchemaLoaded && !this.errorText;
  }

  get objectLabel() {
    return this._objectInfo?.label ?? this._selectedObjectApiName ?? '';
  }

  // Display-ready strings live here (mapped over the pure, test-covered row list), not in
  // inspectorNativeSchemaExplorerUtils itself - LWC templates can't evaluate a ternary inline, so
  // this is where "true/false" becomes the label actually shown in each cell.
  get fieldRows() {
    if (!this._objectInfo) {
      return [];
    }
    return filterFieldRows(buildFieldRows(this._objectInfo), this.searchTerm).map((row) => ({
      ...row,
      requiredText: row.required ? 'Required' : '',
      uniqueText: row.unique ? 'Unique' : '',
      externalIdText: row.externalId ? 'External ID' : '',
      createableText: row.createable ? 'Yes' : 'No',
      updateableText: row.updateable ? 'Yes' : 'No'
    }));
  }

  get fieldCountLabel() {
    const count = this.fieldRows.length;
    return `${count} field${count === 1 ? '' : 's'}`;
  }

  get hasNoMatchingFields() {
    return this.hasSchemaLoaded && this.fieldRows.length === 0;
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._objectInfo = undefined;
    this.searchTerm = '';
    this.errorText = undefined;
  }

  handleSearchChange(event) {
    this.searchTerm = event.target.value;
  }

  // standard__webPage (rather than a typed PageReference) is the only option here - there's no
  // dedicated NavigationMixin page type for "a specific field's Setup detail page".
  handleEditFieldClick(event) {
    const fieldApiName = event.currentTarget.dataset.fieldApiName;
    this[NavigationMixin.Navigate]({
      type: 'standard__webPage',
      attributes: { url: buildFieldSetupUrl(this._selectedObjectApiName, fieldApiName) }
    });
  }
}
