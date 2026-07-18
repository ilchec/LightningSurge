import { api, LightningElement } from 'lwc';

/**
 * Renders the section/row/field layout, error banner, and footer buttons for graphqlRecordForm.
 * Internal helper component, not intended for standalone use.
 * @alias GraphqlRecordFormBody
 * @extends LightningElement
 * @hideconstructor
 */
export default class GraphqlRecordFormBody extends LightningElement {
  @api isLoading = false;
  @api hasError = false;
  @api errorMessage = '';
  @api sections = [];
  @api isSaveDisabled = false;
  @api hideCancelButton = false;
  @api saveButtonLabel = 'Save';
  @api cancelButtonLabel = 'Cancel';

  get hasSections() {
    return this.sections.length > 0;
  }

  handleFieldChange(event) {
    this.dispatchEvent(new CustomEvent('fieldchange', { detail: event.detail }));
  }

  handleSave() {
    this.dispatchEvent(new CustomEvent('save'));
  }

  handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }
}