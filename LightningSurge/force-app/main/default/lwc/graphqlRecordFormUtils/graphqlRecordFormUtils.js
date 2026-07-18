import { gql } from 'lightning/graphql';

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
 * Maps a UI API field data type to the input widget type rendered by graphqlRecordFormField.
 * @param {string} dataType - The field's UI API data type (e.g. 'Picklist', 'Reference').
 * @returns {string} The widget type. Defaults to 'text' for unmapped types.
 */
export function mapDataTypeToInputType(dataType) {
  return DATA_TYPE_TO_INPUT_TYPE[dataType] || 'text';
}

/**
 * Extracts the record, object info, layout, and resolved record type for an existing record,
 * from a getRecordUi wire result.
 */
export function getEditContext(data, recordId) {
  const record = data.records[recordId];
  const objectApiName = record.apiName;
  const recordTypeId = record.recordTypeId;
  const objectInfo = data.objectInfos[objectApiName];
  const layout = data.layouts[objectApiName]?.[recordTypeId]?.Full?.Edit;
  return { record, objectApiName, recordTypeId, objectInfo, layout };
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
export function getPicklistOptions(apiName, picklistData) {
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
 * Builds the field UI model(s) (label, required, editable, type, options, ...) for a single
 * layout item, respecting field-level security (missing/inaccessible fields yield no model) and
 * create/update editability. Most items wrap exactly one field, but compound fields - e.g. the
 * Lead/Contact Name item - list each underlying field (Salutation, FirstName, LastName) as its
 * own layoutComponent, so one layout item can yield several field models. Used by graphqlRecordForm
 * to apply consistent FLS and layout rules. (The multiRecordEntry package vendors the parts of
 * this file it needs, consolidated into its own graphqlMultiRecordEntrySharedUtils, so it can be
 * deployed independently.)
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

function buildRow(row, objectInfo, formValues, picklistData, isCreateMode, rowId) {
  const items = (row.layoutItems || []).flatMap((item) =>
    buildFieldModels(item, objectInfo, formValues, picklistData, isCreateMode)
  );
  return { id: rowId, items };
}

function buildSection(section, objectInfo, formValues, picklistData, isCreateMode, sectionId) {
  const rows = (section.layoutRows || [])
    .map((row, rowIndex) =>
      buildRow(row, objectInfo, formValues, picklistData, isCreateMode, `${sectionId}-${rowIndex}`)
    )
    .filter((row) => row.items.length > 0);
  const columns = section.columns || 1;
  const colClass = columns === 2 ? 'slds-size_1-of-2' : 'slds-size_1-of-1';
  return { id: sectionId, heading: section.heading, columns, colClass, rows };
}

/**
 * Builds the renderable section/row/field structure for a layout, respecting field-level
 * security and editability as returned by the UI API (inaccessible fields are simply absent
 * from the layout; non-editable fields are flagged so inputs render disabled).
 */
export function buildSections(layout, objectInfo, formValues, picklistData, isCreateMode) {
  const sections = layout?.sections ?? [];
  return sections
    .map((section, index) =>
      buildSection(section, objectInfo, formValues, picklistData, isCreateMode, `section-${index}`)
    )
    .filter((section) => section.rows.length > 0);
}

/**
 * Flattens the section/row structure into a single list of field models.
 */
export function flattenFieldModels(sections) {
  return sections.flatMap((section) => section.rows.flatMap((row) => row.items));
}

/**
 * Serializes a raw form value into a GraphQL literal for the given field data type.
 */
export function serializeGqlValue(dataType, value) {
  if (value === null || value === undefined || value === '') return 'null';
  if (dataType === 'Boolean') return String(Boolean(value));
  if (NUMERIC_DATA_TYPES.has(dataType)) return String(Number(value));
  const escaped = String(value)
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

function buildFieldAssignments(fieldModels, formValues) {
  return fieldModels
    .filter((field) => field.editable)
    .map((field) => `${field.apiName}: ${serializeGqlValue(field.dataType, formValues[field.apiName])}`)
    .join(', ');
}

/**
 * Builds a GraphQL mutation that creates a new record via uiapi.{Object}Create.
 */
export function buildCreateMutation(objectApiName, fieldModels, formValues) {
  const fieldStr = buildFieldAssignments(fieldModels, formValues);
  return gql`
    mutation CreateRecord {
      uiapi {
        ${objectApiName}Create(input: { ${objectApiName}: { ${fieldStr} } }) {
          Record {
            Id
          }
        }
      }
    }
  `;
}

/**
 * Builds a GraphQL mutation that updates an existing record via uiapi.{Object}Update.
 */
export function buildUpdateMutation(objectApiName, recordId, fieldModels, formValues) {
  const fieldStr = buildFieldAssignments(fieldModels, formValues);
  return gql`
    mutation UpdateRecord {
      uiapi {
        ${objectApiName}Update(input: { Id: "${recordId}", ${objectApiName}: { ${fieldStr} } }) {
          Record {
            Id
          }
        }
      }
    }
  `;
}

/**
 * Extracts the saved record Id from a create/update mutation result.
 */
export function extractSavedRecordId(result, objectApiName, isCreateMode, fallbackRecordId) {
  const key = `${objectApiName}${isCreateMode ? 'Create' : 'Update'}`;
  return result?.data?.uiapi?.[key]?.Record?.Id ?? fallbackRecordId ?? null;
}