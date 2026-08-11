import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

const DATA_TYPE_TO_INPUT_TYPE = {
  Boolean: 'checkbox',
  Date: 'date',
  DateTime: 'datetime-local',
  Email: 'email',
  EncryptedString: 'password',
  Phone: 'tel',
  Url: 'url',
  Int: 'number',
  Double: 'number',
  Long: 'number',
  Currency: 'number',
  Percent: 'number',
  Picklist: 'picklist',
  MultiPicklist: 'multipicklist',
  Reference: 'reference',
  TextArea: 'textarea'
};

const NUMERIC_DATA_TYPES = new Set(['Int', 'Double', 'Long', 'Currency', 'Percent']);
const UNSUPPORTED_DATA_TYPES = new Set(['Address', 'Location', 'Base64']);

/**
 * Dispatches a toast event on the given component.
 * @param {LightningElement} component - The component instance
 * @param {string} title - Toast title
 * @param {string} message - Toast message
 * @param {string} variant - Toast variant (success, error, warning, info)
 * @param {string} [mode] - Toast mode (dismissible, pester, sticky). Defaults to dismissible.
 */
export function showToast(component, title, message, variant, mode) {
  component.dispatchEvent(new ShowToastEvent({ title, message, variant, mode }));
}

/**
 * Navigates to a record page using the NavigationMixin.
 * @param {LightningElement} component - The component instance (must extend NavigationMixin)
 * @param {string} recordId - The record Id to navigate to
 * @param {string} actionName - The navigation action ('view' or 'edit')
 */
export function navigateToRecord(component, recordId, actionName) {
  component[NavigationMixin.Navigate]({
    type: 'standard__recordPage',
    attributes: { recordId, actionName }
  });
}

function mapDataTypeToInputType(dataType) {
  return DATA_TYPE_TO_INPUT_TYPE[dataType] || 'text';
}

/**
 * Extracts the default record, object info, and layout for a new record,
 * from a getRecordCreateDefaults wire result.
 */
export function getCreateContext(data, objectApiName) {
  const record = data.record;
  const recordTypeId = record?.recordTypeId ?? null;
  const objectInfo = data.objectInfos[objectApiName];
  const layout = data.layout;
  return { record, objectApiName, recordTypeId, objectInfo, layout };
}

/**
 * Builds the initial form value map (apiName -> raw value) from a UI API record representation.
 */
export function getInitialFormValues(record) {
  const values = {};
  const fields = record?.fields || {};
  Object.keys(fields).forEach((apiName) => {
    values[apiName] = fields[apiName]?.value ?? null;
  });
  return values;
}

/**
 * Returns combobox-ready picklist options for a field. Dependent picklist filtering
 * (controlling field validFor bitmaps) is not applied; all active values are returned.
 */
function getPicklistOptions(apiName, picklistData) {
  const values = picklistData?.picklistFieldValues?.[apiName]?.values ?? [];
  return values.map((v) => ({ label: v.label, value: v.value }));
}

function getNumberStep(fieldInfo) {
  if (!NUMERIC_DATA_TYPES.has(fieldInfo.dataType) || fieldInfo.dataType === 'Int' || fieldInfo.dataType === 'Long') {
    return null;
  }
  const scale = fieldInfo.scale ?? 2;
  return scale > 0 ? (1 / 10 ** scale).toFixed(scale) : '1';
}

/**
 * Picks the target object for a reference field's record-picker. Most reference fields have a
 * single referenceToInfos entry, but polymorphic ones (e.g. OwnerId: User or Group) list more
 * than one - and the UI API doesn't guarantee that array's order is stable across separate
 * fetches. Blindly taking index 0 means the guessed type can flip between calls (e.g. on a page
 * reload) while the field's actual value doesn't change, leaving the record-picker unable to
 * resolve a display name for an otherwise-valid Id ("Unknown"). User is preferred since that's
 * what Owner-like fields resolve to in practice.
 */
function pickReferenceObjectApiName(referenceToInfos) {
  if (!referenceToInfos?.length) return null;
  const userInfo = referenceToInfos.find((info) => info.apiName === 'User');
  return (userInfo || referenceToInfos[0]).apiName;
}

function buildSingleFieldModel(apiName, label, required, editable, objectInfo, formValues, picklistData) {
  const fieldInfo = objectInfo.fields[apiName];
  if (!fieldInfo || UNSUPPORTED_DATA_TYPES.has(fieldInfo.dataType)) return null;

  const type = mapDataTypeToInputType(fieldInfo.dataType);
  const model = {
    apiName,
    label,
    required: Boolean(required),
    // The field's own API-level required-ness, independent of any layout override above - lets
    // callers offer an "ignore layout-required fields" mode that only still blocks on this.
    apiRequired: Boolean(fieldInfo.required),
    editable: Boolean(editable),
    dataType: fieldInfo.dataType,
    type,
    value: formValues[apiName] ?? null,
    step: getNumberStep(fieldInfo)
  };
  if (type === 'picklist' || type === 'multipicklist') {
    model.options = getPicklistOptions(apiName, picklistData);
  }
  if (type === 'reference') {
    model.referenceObjectApiName = pickReferenceObjectApiName(fieldInfo.referenceToInfos);
  }
  return model;
}

/**
 * Builds a single field's UI model directly from objectInfo (no layout item involved), for
 * "show all fields regardless of layout" modes. required/editable come straight from the field's
 * own API-level required/createable flags, since there's no layout override to consider.
 */
export function buildFieldModelFromFieldInfo(apiName, objectInfo, formValues, picklistData) {
  const fieldInfo = objectInfo.fields[apiName];
  if (!fieldInfo) return null;
  return buildSingleFieldModel(apiName, fieldInfo.label, fieldInfo.required, fieldInfo.createable, objectInfo, formValues, picklistData);
}

/**
 * Same as buildFieldModelFromFieldInfo, but for editing an *existing* record rather than creating
 * a new one: editable comes from the field's updateable flag, not createable - some fields are one
 * but not the other (e.g. a field only settable at creation, or only after). No layout item is
 * involved here either, since a queried/edited record's field list comes from whatever was
 * queried, not a layout.
 */
export function buildFieldModelForEdit(apiName, objectInfo, formValues, picklistData) {
  const fieldInfo = objectInfo.fields[apiName];
  if (!fieldInfo) return null;
  return buildSingleFieldModel(apiName, fieldInfo.label, fieldInfo.required, fieldInfo.updateable, objectInfo, formValues, picklistData);
}

/**
 * Builds the field UI model(s) (label, required, editable, type, options, ...) for a single
 * layout item, respecting field-level security (missing/inaccessible fields yield no model) and
 * create/update editability. Most items wrap exactly one field, but compound fields - e.g. the
 * Lead/Contact Name item - list each underlying field (Salutation, FirstName, LastName) as its
 * own layoutComponent, so one layout item can yield several field models.
 */
export function buildFieldModels(layoutItem, objectInfo, formValues, picklistData, isCreateMode) {
  const components = (layoutItem.layoutComponents || []).filter((c) => c.componentType === 'Field');
  if (components.length === 0) return [];

  const editable = isCreateMode ? layoutItem.editableForNew : layoutItem.editableForUpdate;

  if (components.length === 1) {
    const apiName = components[0].apiName;
    const label = layoutItem.label || objectInfo.fields[apiName]?.label;
    const model = buildSingleFieldModel(apiName, label, layoutItem.required, editable, objectInfo, formValues, picklistData);
    return model ? [model] : [];
  }

  return components
    .map((component) => {
      const fieldInfo = objectInfo.fields[component.apiName];
      return buildSingleFieldModel(
        component.apiName,
        fieldInfo?.label,
        fieldInfo?.required,
        editable,
        objectInfo,
        formValues,
        picklistData
      );
    })
    .filter(Boolean);
}

/**
 * Builds a read-only column model for a relationship-traversal field queried via SOQL dot notation
 * (e.g. "Account.Name") - not a real field on this object's own objectInfo.fields, so it can't go
 * through buildFieldModelForEdit. Always non-editable: there's no update mutation path back to a
 * related record's field through this object's own row, so it's rendered as a plain read-only text
 * field regardless of what the related field's real type is - good enough for display, which is all
 * a traversed field can ever be here. Label is just the dotted apiName itself (e.g. "Account.Name")
 * rather than a resolved field label - the related object's own field labels aren't reliably
 * knowable client-side without fetching that object's objectInfo too, and this is clear enough for
 * an admin tool.
 */
export function buildRelationshipFieldModel(apiName) {
  return {
    apiName,
    label: apiName,
    required: false,
    apiRequired: false,
    editable: false,
    dataType: 'String',
    type: 'text',
    value: null,
    step: null
  };
}

/**
 * Serializes a raw form value into a GraphQL literal for the given field data type.
 */
export function serializeGqlValue(dataType, value) {
  if (value === null || value === undefined || value === '') return 'null';
  if (dataType === 'Boolean') return String(Boolean(value));
  if (NUMERIC_DATA_TYPES.has(dataType)) {
    // A bare NaN literal is invalid GraphQL syntax and would fail the whole aliased batch
    // mutation, not just this row's alias - fall back to null instead of ever emitting it.
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 'null' : String(parsed);
  }
  const escaped = String(value)
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}
