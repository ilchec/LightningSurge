import { api, LightningElement } from 'lwc';

const TEXT_LIKE_TYPES = new Set(['text', 'email', 'tel', 'url', 'password']);

/**
 * Renders a single form input for a graphqlRecordForm field model, picking the right base
 * Lightning input component for the field's data type and emitting normalized change events.
 * @alias GraphqlRecordFormField
 * @extends LightningElement
 * @hideconstructor
 */
export default class GraphqlRecordFormField extends LightningElement {
  /**
   * Field model built by graphqlRecordFormUtils.buildSections: { apiName, label, type,
   * required, editable, value, options, referenceObjectApiName, step }.
   * @type {Object}
   */
  @api field;

  get isTextLike() {
    return TEXT_LIKE_TYPES.has(this.field?.type);
  }

  get isNumber() {
    return this.field?.type === 'number';
  }

  get isCheckbox() {
    return this.field?.type === 'checkbox';
  }

  get isDate() {
    return this.field?.type === 'date';
  }

  get isDateTime() {
    return this.field?.type === 'datetime-local';
  }

  get isTextarea() {
    return this.field?.type === 'textarea';
  }

  get isPicklist() {
    return this.field?.type === 'picklist';
  }

  get isMultiPicklist() {
    return this.field?.type === 'multipicklist';
  }

  get isReference() {
    return this.field?.type === 'reference';
  }

  get isDisabled() {
    return !this.field?.editable;
  }

  get multiPicklistValue() {
    return this.field?.value ? String(this.field.value).split(';') : [];
  }

  /**
   * Converts the stored ISO-8601 UTC value into the local "YYYY-MM-DDTHH:mm" format
   * expected by the native datetime-local input.
   */
  get localDateTimeValue() {
    if (!this.field?.value) return null;
    const date = new Date(this.field.value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  @api
  reportValidity() {
    // A disabled field can't be corrected by the user and its value is never submitted (see
    // buildRowFieldAssignments' editable filter), so it can't be allowed to block saving - e.g.
    // a required-but-disabled Owner field whose display-only default value didn't resolve.
    if (this.isDisabled) return true;
    const input = this.template.querySelector('[data-input]');
    if (!input || typeof input.reportValidity !== 'function') return true;
    return input.reportValidity();
  }

  /**
   * Returns the native constraint-validation message for this field, or null if it's valid/not
   * applicable. Call after reportValidity() so the underlying input's validation state is fresh.
   * @returns {string|null}
   */
  @api
  getValidationMessage() {
    if (this.isDisabled) return null;
    const input = this.template.querySelector('[data-input]');
    return input?.validationMessage || null;
  }

  handleChange(event) {
    const value = this.getValueFromEvent(event);
    this.dispatchEvent(
      new CustomEvent('fieldchange', {
        detail: { apiName: this.field.apiName, value },
        bubbles: true,
        composed: true
      })
    );
  }

  getValueFromEvent(event) {
    if (this.isCheckbox) return event.target.checked;
    if (this.isMultiPicklist) return event.detail.value.join(';');
    if (this.isReference) return event.detail.recordId;
    if (this.isPicklist) return event.detail.value;
    if (this.isDateTime) return event.target.value ? new Date(event.target.value).toISOString() : null;
    return event.target.value;
  }
}