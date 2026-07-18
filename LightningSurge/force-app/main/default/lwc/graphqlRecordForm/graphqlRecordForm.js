import { navigateToRecord, showToast } from 'c/datatableUtils';
import {
  buildCreateMutation,
  buildSections,
  buildUpdateMutation,
  extractSavedRecordId,
  flattenFieldModels,
  getCreateContext,
  getEditContext,
  getInitialFormValues
} from 'c/graphqlRecordFormUtils';
import { executeMutation } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { getRecordCreateDefaults, getRecordUi } from 'lightning/uiRecordApi';
import { api, LightningElement, wire } from 'lwc';

/**
 * Drop-in replacement for the standard new/edit record form. Field presence, labels,
 * required-ness, and editability come from the record's assigned Full page layout (respecting
 * field-level security), and all reads/writes use the UI API GraphQL wire adapter - no Apex.
 * @alias GraphqlRecordForm
 * @extends LightningElement
 * @hideconstructor
 *
 * @example
 * <c-graphql-record-form object-api-name="Account" record-id={recordId}></c-graphql-record-form>
 */
export default class GraphqlRecordForm extends NavigationMixin(LightningElement) {
  /**
   * If the component is used on a lightning record page or as a New/Edit action override,
   * the platform sets this to the id of the current record. Absent when creating a new record.
   * @type {string}
   */
  @api recordId;

  /**
   * If the component is used on a lightning record page or action override, the platform sets
   * this to the API name of the current object. Required when placed on an App Page.
   * @type {string}
   */
  @api objectApiName;

  /**
   * Record type to use when creating a new record. The platform sets this automatically when
   * the component overrides a standard New action for an object with multiple record types.
   * @type {string}
   */
  @api recordTypeId;

  /**
   * Optional heading. Defaults to "New {Object}" or "Edit {Object}".
   * @type {string}
   */
  @api formTitle = '';

  /** @type {boolean} @default false */
  @api showCard = false;

  /** @type {string} @default 'utility:edit_form' */
  @api cardIcon = 'utility:edit_form';

  /** @type {string} @default 'Save' */
  @api saveButtonLabel = 'Save';

  /** @type {string} @default 'Cancel' */
  @api cancelButtonLabel = 'Cancel';

  /** If present, the Cancel button is hidden. @type {boolean} @default false */
  @api hideCancelButton = false;

  /** If present, the form does not navigate to the record's view page after a successful save. @type {boolean} @default false */
  @api skipNavigateAfterSave = false;

  isSaving = false;
  errorMessage = '';

  _layoutContext;
  _formValues = {};
  _picklistData;
  _initializedValues = false;

  get isEditMode() {
    return Boolean(this.recordId);
  }

  get editRecordIds() {
    return this.isEditMode ? [this.recordId] : undefined;
  }

  get createObjectApiName() {
    return this.isEditMode ? undefined : this.objectApiName;
  }

  get resolvedObjectApiName() {
    return this._layoutContext?.objectApiName;
  }

  get resolvedRecordTypeId() {
    return this._layoutContext?.recordTypeId;
  }

  @wire(getRecordUi, { recordIds: '$editRecordIds', layoutTypes: ['Full'], modes: ['Edit'] })
  wiredRecordUi({ data, error }) {
    if (data) {
      this.applyContext(getEditContext(data, this.recordId));
    } else if (error) {
      this.setError(error);
    }
  }

  @wire(getRecordCreateDefaults, { objectApiName: '$createObjectApiName', recordTypeId: '$recordTypeId' })
  wiredCreateDefaults({ data, error }) {
    if (data) {
      this.applyContext(getCreateContext(data, this.objectApiName));
    } else if (error) {
      this.setError(error);
    }
  }

  @wire(getPicklistValuesByRecordType, {
    objectApiName: '$resolvedObjectApiName',
    recordTypeId: '$resolvedRecordTypeId'
  })
  wiredPicklists({ data }) {
    if (data) this._picklistData = data;
  }

  applyContext(context) {
    this._layoutContext = context;
    if (!this._initializedValues) {
      this._formValues = getInitialFormValues(context.record);
      this._initializedValues = true;
    }
  }

  setError(error) {
    this.errorMessage = error?.body?.message ?? error?.message ?? 'Unknown error loading the form';
  }

  get isLoading() {
    return !this._layoutContext;
  }

  get sections() {
    if (!this._layoutContext?.layout || !this._layoutContext?.objectInfo) return [];
    return buildSections(
      this._layoutContext.layout,
      this._layoutContext.objectInfo,
      this._formValues,
      this._picklistData,
      !this.isEditMode
    );
  }

  get hasSections() {
    return this.sections.length > 0;
  }

  get computedTitle() {
    if (this.formTitle) return this.formTitle;
    const objectName = this.resolvedObjectApiName || this.objectApiName || '';
    return this.isEditMode ? `Edit ${objectName}` : `New ${objectName}`;
  }

  get hasError() {
    return Boolean(this.errorMessage);
  }

  get isSaveDisabled() {
    return this.isSaving || this.isLoading;
  }

  handleFieldChange(event) {
    const { apiName, value } = event.detail;
    this._formValues = { ...this._formValues, [apiName]: value };
  }

  reportValidity() {
    const fields = this.template.querySelectorAll('c-graphql-record-form-field');
    let allValid = true;
    fields.forEach((field) => {
      if (!field.reportValidity()) allValid = false;
    });
    return allValid;
  }

  async handleSave() {
    if (!this.reportValidity()) return;
    this.isSaving = true;
    this.errorMessage = '';
    try {
      const result = await executeMutation({ query: this.buildMutation() });
      this.handleSaveResult(result);
    } catch (error) {
      this.setError(error);
    } finally {
      this.isSaving = false;
    }
  }

  buildMutation() {
    const fieldModels = flattenFieldModels(this.sections);
    return this.isEditMode
      ? buildUpdateMutation(this.resolvedObjectApiName, this.recordId, fieldModels, this._formValues)
      : buildCreateMutation(this.resolvedObjectApiName, fieldModels, this._formValues);
  }

  handleSaveResult(result) {
    const errors = result?.errors ?? [];
    if (errors.length) {
      this.errorMessage = errors[0]?.message ?? 'Unknown error saving the record';
      return;
    }
    const savedId = extractSavedRecordId(result, this.resolvedObjectApiName, !this.isEditMode, this.recordId);
    showToast(this, 'Success', 'Record saved', 'success');
    this.dispatchEvent(new CustomEvent('save', { detail: { recordId: savedId } }));
    if (!this.skipNavigateAfterSave && savedId) navigateToRecord(this, savedId, 'view');
  }

  handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
    if (this.recordId) {
      navigateToRecord(this, this.recordId, 'view');
    } else {
      this[NavigationMixin.Navigate]({
        type: 'standard__objectPage',
        attributes: { objectApiName: this.objectApiName, actionName: 'home' }
      });
    }
  }
}