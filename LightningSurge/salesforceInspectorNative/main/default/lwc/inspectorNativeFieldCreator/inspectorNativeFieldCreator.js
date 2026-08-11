import grantFieldPermissions from '@salesforce/apex/InspectorNativeFieldPermissions.grantFieldPermissions';
import deployCustomFields from '@salesforce/apex/InspectorNativeFieldCreator.deployCustomFields';
import getCreatableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getCreatableObjects';
import InspectorNativeFieldOptions from 'c/inspectorNativeFieldOptions';
import InspectorNativeFieldPermissions from 'c/inspectorNativeFieldPermissions';
import { showToast } from 'c/inspectorNativeSharedUtils';
import { LightningElement, wire } from 'lwc';

const FIELD_TYPE_OPTIONS = [
  { label: 'Text', value: 'Text' },
  { label: 'Text Area (Long)', value: 'LongTextArea' },
  { label: 'Checkbox', value: 'Checkbox' },
  { label: 'Number', value: 'Number' },
  { label: 'Currency', value: 'Currency' },
  { label: 'Percent', value: 'Percent' },
  { label: 'Date', value: 'Date' },
  { label: 'Date/Time', value: 'DateTime' },
  { label: 'Email', value: 'Email' },
  { label: 'Phone', value: 'Phone' },
  { label: 'URL', value: 'Url' },
  { label: 'Picklist', value: 'Picklist' }
];

const LENGTH_TYPES = new Set(['Text', 'LongTextArea', 'Email', 'Url']);
const PRECISION_SCALE_TYPES = new Set(['Number', 'Currency', 'Percent']);
const UNIQUE_EXTERNAL_ID_TYPES = new Set(['Text', 'Number', 'Email']);

const DEFAULT_LENGTH = 255;
const DEFAULT_PRECISION = 18;
const DEFAULT_SCALE = 2;
const DEFAULT_VISIBLE_LINES = 3;

const API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

// Best-effort Label -> API Name suggestion (non-alphanumeric -> underscore, collapsed/trimmed).
// Only applied while the user hasn't directly edited the API Name field for that row.
function deriveApiName(label) {
  return label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function isValidApiNameFragment(apiName) {
  return API_NAME_PATTERN.test(apiName.trim());
}

// Which Options-modal inputs apply to a given field type - kept in one place so the modal itself
// doesn't need to duplicate this type-to-fields classification.
function getOptionFlagsForType(fieldType) {
  return {
    showLength: LENGTH_TYPES.has(fieldType),
    showVisibleLines: fieldType === 'LongTextArea',
    showPrecisionScale: PRECISION_SCALE_TYPES.has(fieldType),
    showPicklistValues: fieldType === 'Picklist',
    showRequired: Boolean(fieldType) && fieldType !== 'Checkbox',
    showUniqueExternalId: UNIQUE_EXTERNAL_ID_TYPES.has(fieldType)
  };
}

/**
 * Field Creator tab: pick an object, define one or more custom fields, deploy them - modeled on
 * Salesforce Inspector Reloaded's Field Creator tool, scoped to standalone field types (no
 * Lookup/Master-Detail - see salesforceInspectorNative/README.md for why). Backed by
 * InspectorNativeFieldCreator, the third (and so far last) Apex exception in this app, and the
 * first that writes to org schema rather than just reading data. Field-level security grants (via
 * the Permissions modal) go through the separate InspectorNativeFieldPermissions, applied after a
 * field is successfully created.
 *
 * Deployment is a synchronous Tooling API callout per field (see the Apex class's own doc comment
 * for why that's the mechanism, not the built-in Metadata Apex namespace) - each field's success/
 * failure, with the real error message on failure, is known immediately from deployCustomFields()'s own
 * return value. No polling needed.
 *
 * Row-level detail (type-specific options, permission grants) lives behind the Options/Permissions
 * buttons rather than inline, keeping the main table compact - one row per field with just Label/
 * API Name/Type visible, matching Salesforce Inspector Reloaded's own layout.
 * @alias InspectorNativeFieldCreator
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeFieldCreator extends LightningElement {
  isLoadingObjects = true;
  objectListErrorText;
  isDeploying = false;
  deployErrorText;

  _objectOptions = [];
  _selectedObjectApiName;
  _nextRowKey = 1;
  _rows = [];
  _validationErrors = [];
  _deployResults;

  connectedCallback() {
    this.addRow();
  }

  @wire(getCreatableObjects)
  wiredObjects({ data, error }) {
    this.isLoadingObjects = false;
    if (data) {
      this._objectOptions = data.map((option) => ({ label: option.label, value: option.apiName }));
    } else if (error) {
      this.objectListErrorText = error?.body?.message ?? error?.message ?? 'Unknown error loading the object list';
    }
  }

  get objectOptions() {
    return this._objectOptions;
  }

  get selectedObjectApiName() {
    return this._selectedObjectApiName;
  }

  handleObjectSelect(event) {
    this._selectedObjectApiName = event.detail.value;
    this._deployResults = undefined;
  }

  get fieldTypeOptions() {
    return FIELD_TYPE_OPTIONS;
  }

  get fieldRows() {
    return this._rows;
  }

  get hasMultipleRows() {
    return this._rows.length > 1;
  }

  get isDeployDisabled() {
    return this.isDeploying || !this._selectedObjectApiName || this._rows.length === 0;
  }

  get validationErrors() {
    return this._validationErrors;
  }

  get deployResults() {
    return this._deployResults;
  }

  get hasDeployResults() {
    return Boolean(this._deployResults);
  }

  createRow() {
    const key = this._nextRowKey;
    this._nextRowKey += 1;
    return {
      key,
      label: '',
      apiName: '',
      apiNameEdited: false,
      fieldType: '',
      length: DEFAULT_LENGTH,
      precision: DEFAULT_PRECISION,
      scale: DEFAULT_SCALE,
      visibleLines: DEFAULT_VISIBLE_LINES,
      isRequired: false,
      description: '',
      helpText: '',
      isUnique: false,
      isExternalId: false,
      picklistValuesText: '',
      permissionGrants: []
    };
  }

  addRow() {
    this._rows = [...this._rows, this.createRow()];
  }

  handleAddRow() {
    this.addRow();
  }

  handleRemoveRow(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    this._rows = this._rows.filter((row) => row.key !== key);
  }

  handleCloneRow(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    const index = this._rows.findIndex((row) => row.key === key);
    if (index === -1) return;
    const source = this._rows[index];
    const clone = { ...source, key: this._nextRowKey, permissionGrants: source.permissionGrants.map((grant) => ({ ...grant })) };
    this._nextRowKey += 1;
    this._rows = [...this._rows.slice(0, index + 1), clone, ...this._rows.slice(index + 1)];
  }

  updateRow(key, patch) {
    this._rows = this._rows.map((row) => (row.key === key ? { ...row, ...patch } : row));
    this._validationErrors = [];
  }

  handleLabelChange(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    const value = event.target.value;
    const row = this._rows.find((r) => r.key === key);
    const apiName = row?.apiNameEdited ? row.apiName : deriveApiName(value);
    this.updateRow(key, { label: value, apiName });
  }

  handleApiNameChange(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    this.updateRow(key, { apiName: event.target.value, apiNameEdited: true });
  }

  handleFieldTypeChange(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    this.updateRow(key, { fieldType: event.detail.value });
  }

  async handleOpenOptions(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    const row = this._rows.find((r) => r.key === key);
    if (!row) return;
    const result = await InspectorNativeFieldOptions.open({
      size: 'small',
      ...getOptionFlagsForType(row.fieldType),
      length: row.length,
      visibleLines: row.visibleLines,
      precision: row.precision,
      scale: row.scale,
      isRequired: row.isRequired,
      description: row.description,
      helpText: row.helpText,
      isUnique: row.isUnique,
      isExternalId: row.isExternalId,
      picklistValuesText: row.picklistValuesText
    });
    if (result) {
      this.updateRow(key, result);
    }
  }

  async handleOpenPermissions(event) {
    const key = Number(event.currentTarget.dataset.rowKey);
    const row = this._rows.find((r) => r.key === key);
    if (!row) return;
    const result = await InspectorNativeFieldPermissions.open({
      size: 'medium',
      grants: row.permissionGrants
    });
    if (!result) return;
    if (result.applyToAll) {
      this._rows = this._rows.map((r) => ({ ...r, permissionGrants: result.grants.map((grant) => ({ ...grant })) }));
    } else {
      this.updateRow(key, { permissionGrants: result.grants });
    }
  }

  validate() {
    const errors = [];
    this._rows.forEach((row, index) => {
      const rowNumber = index + 1;
      if (!row.label.trim()) {
        errors.push({ key: `${row.key}-label`, message: `Row ${rowNumber}: Label is required.` });
      }
      if (!row.apiName.trim() || !isValidApiNameFragment(row.apiName)) {
        errors.push({
          key: `${row.key}-apiName`,
          message: `Row ${rowNumber}: API Name must start with a letter and contain only letters, numbers, and underscores.`
        });
      }
      if (!row.fieldType) {
        errors.push({ key: `${row.key}-type`, message: `Row ${rowNumber}: Choose a field type.` });
      }
      if (LENGTH_TYPES.has(row.fieldType) && !row.length) {
        errors.push({ key: `${row.key}-length`, message: `Row ${rowNumber}: Set a Length in Options.` });
      }
      if (PRECISION_SCALE_TYPES.has(row.fieldType) && (!row.precision || row.scale === null || row.scale === undefined)) {
        errors.push({ key: `${row.key}-precscale`, message: `Row ${rowNumber}: Set Precision and Scale in Options.` });
      }
      if (row.fieldType === 'Picklist' && !row.picklistValuesText.split('\n').some((value) => value.trim())) {
        errors.push({ key: `${row.key}-picklist`, message: `Row ${rowNumber}: Add at least one picklist value in Options.` });
      }
    });
    return errors;
  }

  buildFieldSpec(row) {
    return {
      objectApiName: this._selectedObjectApiName,
      label: row.label.trim(),
      // Matches InspectorNativeFieldSpec.fieldApiName - see that class's own doc comment for why
      // this whole spec shape lives in its own top-level Apex class rather than nested inside
      // InspectorNativeFieldCreator.
      fieldApiName: row.apiName.trim(),
      fieldType: row.fieldType,
      length: LENGTH_TYPES.has(row.fieldType) ? row.length : null,
      precision: PRECISION_SCALE_TYPES.has(row.fieldType) ? row.precision : null,
      scale: PRECISION_SCALE_TYPES.has(row.fieldType) ? row.scale : null,
      visibleLines: row.fieldType === 'LongTextArea' ? row.visibleLines : null,
      isRequired: row.isRequired,
      description: row.description.trim() || null,
      helpText: row.helpText.trim() || null,
      isUnique: UNIQUE_EXTERNAL_ID_TYPES.has(row.fieldType) ? row.isUnique : false,
      isExternalId: UNIQUE_EXTERNAL_ID_TYPES.has(row.fieldType) ? row.isExternalId : false,
      picklistValues:
        row.fieldType === 'Picklist'
          ? row.picklistValuesText
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean)
          : null
    };
  }

  async handleDeployClick() {
    if (this.isDeployDisabled) return;
    const errors = this.validate();
    this._validationErrors = errors;
    if (errors.length) {
      showToast(this, 'Fix the highlighted fields before deploying', errors.map((err) => err.message).join('\n'), 'error', 'sticky');
      return;
    }

    this.isDeploying = true;
    this.deployErrorText = undefined;
    this._deployResults = undefined;
    const rowsBeingDeployed = this._rows;
    const fieldSpecs = rowsBeingDeployed.map((row) => this.buildFieldSpec(row));
    // fieldSpecs travels as a JSON string (fieldSpecsJson), not a typed List<T> parameter - see the
    // Apex class's own doc comment for why.
    try {
      // One Tooling API callout per field, each with its own immediate success/failure and (on
      // failure) the real error message - see the Apex class's doc comment for why this replaced
      // the original polling design.
      const results = await deployCustomFields({ fieldSpecsJson: JSON.stringify(fieldSpecs) });
      this._deployResults = await this.applyPermissionGrants(results, rowsBeingDeployed);
    } catch (error) {
      this.deployErrorText = error?.body?.message ?? error?.message ?? 'Unknown error deploying fields';
    } finally {
      this.isDeploying = false;
    }
  }

  // Permission grants are applied per successfully-created field, after the fact - a field that
  // failed to create has nothing to grant permissions on, and a field with no permission grants
  // configured needs no extra call at all. A grant failure doesn't change the field's own
  // success/message - it's reported as a separate, additive permissionWarning, since the field
  // itself was still created fine.
  async applyPermissionGrants(results, rows) {
    const updatedResults = [];
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const row = rows[i];
      if (result.success && row?.permissionGrants?.length) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await grantFieldPermissions({
            objectApiName: this._selectedObjectApiName,
            fieldApiName: result.apiName,
            grants: row.permissionGrants
          });
          updatedResults.push(result);
        } catch (error) {
          updatedResults.push({
            ...result,
            permissionWarning: `Couldn't apply permissions: ${error?.body?.message ?? error?.message ?? 'Unknown error'}`
          });
        }
      } else {
        updatedResults.push(result);
      }
    }
    return updatedResults;
  }

  handleAddMoreFields() {
    this._rows = [];
    this.addRow();
    this._deployResults = undefined;
    this._validationErrors = [];
  }
}
