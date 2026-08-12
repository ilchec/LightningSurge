import getPicklistValues from '@salesforce/apex/InspectorNativePicklistManager.getPicklistValues';
import savePicklistValues from '@salesforce/apex/InspectorNativePicklistManager.savePicklistValues';
import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { appendNewValue, filterPicklistFields, isDuplicatePicklistValue, moveValue, toggleValueActive, updateValueLabel } from 'c/inspectorNativePicklistManagerUtils';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

/**
 * Picklist Manager tab: pick an object, then a custom picklist field on it, and view/add/activate/
 * deactivate/reorder/rename its values in one table - instead of hunting through Setup's per-object
 * Field-Level detail page. Backed by InspectorNativePicklistManager (Tooling API callout, same
 * shape as Field Creator's field-creation callout) - see that class's doc comment for the scope
 * this tool deliberately stays within (custom fields only, no Global Value Sets). Reordering is
 * single adjacent-pair swaps (Move Up/Down), not free drag-and-drop - Save always resends the
 * complete value list in whatever order it's currently in, so that's the entire mechanism; no
 * separate "order" concept exists anywhere else.
 *
 * "Rename" edits a value's Label only, never its underlying Value - confirmed via research that
 * this is the actual, safe distinction Salesforce itself draws: renaming (label) leaves every
 * existing record pointing at the same underlying value, unaffected, while changing the value
 * itself isn't something the API auto-migrates existing records for (unlike Setup's own "Replace"
 * flow, a background job). The Value column is therefore never editable once a row exists, whether
 * it came from the initial read or was just added in this same session - see
 * inspectorNativePicklistManagerUtils.updateValueLabel's own doc comment for the fuller story.
 *
 * getPicklistValues/savePicklistValues are both called imperatively, not via @wire - a Tooling API
 * read is a live callout every time (not meaningfully cacheable the way getObjectInfo is, and
 * caching it risks showing stale values right after a save), and the save path obviously has to be
 * imperative regardless.
 *
 * There is deliberately no "Delete Value" action of any kind, in-tool or link-out - confirmed via
 * research that the Tooling/Metadata API cannot actually delete a picklist value at all, only
 * deactivate one (which this tool already offers via the Active toggle). A real delete - optionally
 * migrating existing records to a replacement value - is a Setup-UI-only action that runs as an
 * async background job with an email notification on completion; nothing about that flow is
 * exposed through the API for this tool to drive, and a link-out to Setup's own field page (tried,
 * then removed) didn't work reliably either. Deactivating a value remains the supported way to stop
 * it from being selected going forward.
 * @alias InspectorNativePicklistManager
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativePicklistManager extends LightningElement {
  isLoadingObjects = true;
  isLoadingValues = false;
  isSaving = false;
  errorText;
  newValueInput = '';

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;
  _selectedFieldApiName;
  _customFieldId;
  _values = [];
  _originalValuesJson;

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
    return filterPicklistFields(this._objectInfo).map((field) => ({ label: field.label, value: field.apiName }));
  }

  get hasNoPicklistFields() {
    return Boolean(this._objectInfo) && this.fieldOptions.length === 0;
  }

  get selectedFieldApiName() {
    return this._selectedFieldApiName;
  }

  get hasSelectedField() {
    return Boolean(this._selectedFieldApiName);
  }

  get hasValuesLoaded() {
    return Boolean(this._customFieldId);
  }

  get values() {
    const lastIndex = this._values.length - 1;
    return this._values.map((value, index) => ({
      ...value,
      rowIndex: index,
      isMoveUpDisabled: this.isSaving || index === 0,
      isMoveDownDisabled: this.isSaving || index === lastIndex
    }));
  }

  get hasNoValues() {
    return this.hasValuesLoaded && this._values.length === 0;
  }

  get hasUnsavedChanges() {
    return this.hasValuesLoaded && JSON.stringify(this._values) !== this._originalValuesJson;
  }

  get isSaveDisabled() {
    return this.isSaving || !this.hasUnsavedChanges;
  }

  get isDiscardDisabled() {
    return this.isSaving || !this.hasUnsavedChanges;
  }

  get isAddValueDisabled() {
    return this.isSaving || !this.newValueInput || !this.newValueInput.trim();
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._objectInfo = undefined;
    this.resetFieldSelection();
    this.errorText = undefined;
  }

  handleFieldSelect(event) {
    this._selectedFieldApiName = event.detail.value;
    this.loadValues();
  }

  resetFieldSelection() {
    this._selectedFieldApiName = undefined;
    this._customFieldId = undefined;
    this._values = [];
    this._originalValuesJson = undefined;
    this.newValueInput = '';
  }

  async loadValues() {
    this.isLoadingValues = true;
    this.errorText = undefined;
    this._customFieldId = undefined;
    this._values = [];
    try {
      const result = await getPicklistValues({ objectApiName: this._selectedObjectApiName, fieldApiName: this._selectedFieldApiName });
      this._customFieldId = result.customFieldId;
      this._values = result.values.map((value) => ({ ...value }));
      this._originalValuesJson = JSON.stringify(this._values);
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading picklist values';
    } finally {
      this.isLoadingValues = false;
    }
  }

  handleNewValueChange(event) {
    this.newValueInput = event.target.value;
  }

  handleAddValueClick() {
    const candidate = this.newValueInput.trim();
    if (!candidate) {
      return;
    }
    if (isDuplicatePicklistValue(this._values, candidate)) {
      showToast(this, 'Value already exists', `"${candidate}" is already in this field's value list.`, 'warning');
      return;
    }
    this._values = appendNewValue(this._values, candidate);
    this.newValueInput = '';
  }

  handleToggleActive(event) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex);
    this._values = toggleValueActive(this._values, rowIndex);
  }

  handleLabelChange(event) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex);
    this._values = updateValueLabel(this._values, rowIndex, event.target.value);
  }

  handleMoveUpClick(event) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex);
    this._values = moveValue(this._values, rowIndex, -1);
  }

  handleMoveDownClick(event) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex);
    this._values = moveValue(this._values, rowIndex, 1);
  }

  handleDiscardClick() {
    if (this.isDiscardDisabled) return;
    this._values = JSON.parse(this._originalValuesJson);
  }

  async handleSaveClick() {
    if (this.isSaveDisabled) return;
    this.isSaving = true;
    try {
      const result = await savePicklistValues({ customFieldId: this._customFieldId, valuesJson: JSON.stringify(this._values) });
      if (result.success) {
        this._originalValuesJson = JSON.stringify(this._values);
        showToast(this, 'Success', 'Picklist values saved', 'success');
      } else {
        showToast(this, 'Error saving picklist values', result.message ?? 'Unknown error', 'error');
      }
    } catch (error) {
      showToast(this, 'Error saving picklist values', error?.body?.message ?? error?.message ?? 'Unknown error', 'error');
    } finally {
      this.isSaving = false;
    }
  }
}
