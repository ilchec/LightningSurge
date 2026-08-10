import LightningModal from 'lightning/modal';
import { api } from 'lwc';

/**
 * "Set Field Options" modal for one field row in Field Creator. Which inputs are shown is decided
 * entirely by the caller (showLength/showVisibleLines/showPrecisionScale/showPicklistValues/
 * showRequired/showUniqueExternalId, computed once in inspectorNativeFieldCreator from
 * the row's field type) - this component doesn't duplicate that type-to-fields classification, it
 * just renders whatever it's told to. Resolves with the edited values on Save, or null on Cancel -
 * the caller only applies the result on a non-null resolution, so Cancel is a true no-op.
 * @alias InspectorNativeFieldOptions
 * @extends LightningModal
 * @hideconstructor
 */
export default class InspectorNativeFieldOptions extends LightningModal {
  @api showLength = false;
  @api showVisibleLines = false;
  @api showPrecisionScale = false;
  @api showPicklistValues = false;
  @api showRequired = false;
  @api showUniqueExternalId = false;

  @api length;
  @api visibleLines;
  @api precision;
  @api scale;
  @api isRequired = false;
  @api description = '';
  @api helpText = '';
  @api isUnique = false;
  @api isExternalId = false;
  @api picklistValuesText = '';

  handleLengthChange(event) {
    this.length = event.target.value === '' ? null : Number(event.target.value);
  }

  handleVisibleLinesChange(event) {
    this.visibleLines = event.target.value === '' ? null : Number(event.target.value);
  }

  handlePrecisionChange(event) {
    this.precision = event.target.value === '' ? null : Number(event.target.value);
  }

  handleScaleChange(event) {
    this.scale = event.target.value === '' ? null : Number(event.target.value);
  }

  handleRequiredChange(event) {
    this.isRequired = event.target.checked;
  }

  handleDescriptionChange(event) {
    this.description = event.target.value;
  }

  handleHelpTextChange(event) {
    this.helpText = event.target.value;
  }

  handleUniqueChange(event) {
    this.isUnique = event.target.checked;
  }

  handleExternalIdChange(event) {
    this.isExternalId = event.target.checked;
  }

  handlePicklistValuesChange(event) {
    this.picklistValuesText = event.target.value;
  }

  handleCancel() {
    this.close(null);
  }

  handleSave() {
    this.close({
      length: this.length,
      visibleLines: this.visibleLines,
      precision: this.precision,
      scale: this.scale,
      isRequired: this.isRequired,
      description: this.description,
      helpText: this.helpText,
      isUnique: this.isUnique,
      isExternalId: this.isExternalId,
      picklistValuesText: this.picklistValuesText
    });
  }
}
