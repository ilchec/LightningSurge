import getFieldReferences from '@salesforce/apex/InspectorNativeDependencyAnalysis.getFieldReferences';
import getObjectReferences from '@salesforce/apex/InspectorNativeDependencyAnalysis.getObjectReferences';
import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { filterCustomFields, groupReferencesByType } from 'c/inspectorNativeDependencyAnalysisUtils';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

/**
 * Impact Analysis tab: "what references this custom field/object" - Flows, Apex, layouts, and more,
 * via the Tooling API's Dependency API (MetadataComponentDependency). Backed by
 * InspectorNativeDependencyAnalysis - see that class's doc comment for why this needs a Tooling API
 * callout even though it's read-only, and for the coverage caveats (no Reports, 2,000-row cap,
 * shallower Flow coverage than Apex/formula) surfaced here as a persistent banner, not just on an
 * empty result - an empty result must never read as "nothing references this," only as "nothing
 * found by this API."
 *
 * Scoped to custom fields and custom objects, matching InspectorNativePicklistManager's own scope
 * note - a standard field/object doesn't have a CustomField/CustomObject record to resolve a Tooling
 * component Id from.
 * @alias InspectorNativeDependencyAnalysis
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeDependencyAnalysis extends LightningElement {
  isLoadingObjects = true;
  isAnalyzing = false;
  errorText;
  isWholeObjectMode = false;

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;
  _selectedFieldApiName;
  _groupedResults;
  _hasRun = false;

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

  get fieldOptions() {
    if (!this._objectInfo) {
      return [];
    }
    return filterCustomFields(this._objectInfo).map((field) => ({ label: field.label, value: field.apiName }));
  }

  get selectedFieldApiName() {
    return this._selectedFieldApiName;
  }

  get isFieldPickerDisabled() {
    return this.isWholeObjectMode;
  }

  get isAnalyzeDisabled() {
    return this.isAnalyzing || !this.hasSelectedObject || (!this.isWholeObjectMode && !this._selectedFieldApiName);
  }

  get hasRun() {
    return this._hasRun;
  }

  get groupedResults() {
    return this._groupedResults ?? [];
  }

  get hasNoResults() {
    return this._hasRun && !this.isAnalyzing && this.groupedResults.length === 0;
  }

  get resultsSubjectLabel() {
    return this.isWholeObjectMode ? this._selectedObjectApiName : this._selectedFieldApiName;
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._objectInfo = undefined;
    this._selectedFieldApiName = undefined;
    this._groupedResults = undefined;
    this._hasRun = false;
    this.errorText = undefined;
  }

  handleFieldSelect(event) {
    this._selectedFieldApiName = event.detail.value;
  }

  handleWholeObjectToggle(event) {
    this.isWholeObjectMode = event.target.checked;
    if (this.isWholeObjectMode) {
      this._selectedFieldApiName = undefined;
    }
  }

  async handleAnalyzeClick() {
    if (this.isAnalyzeDisabled) return;
    this.isAnalyzing = true;
    this.errorText = undefined;
    this._groupedResults = undefined;
    try {
      const references = this.isWholeObjectMode
        ? await getObjectReferences({ objectApiName: this._selectedObjectApiName })
        : await getFieldReferences({ objectApiName: this._selectedObjectApiName, fieldApiName: this._selectedFieldApiName });
      this._groupedResults = groupReferencesByType(references);
      this._hasRun = true;
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error analyzing dependencies';
      this._hasRun = false;
    } finally {
      this.isAnalyzing = false;
    }
  }
}
