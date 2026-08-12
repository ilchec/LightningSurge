/**
 * Pure functions behind the Data Masking tab. Reuses this app's existing record-entry mutation
 * builders (buildUpsertMutation/extractSaveResults, from inspectorNativeRecordEntryUtils - the same
 * ones Query Records already trusts) rather than duplicating that logic - this file only builds the
 * masking-specific pieces: which fields are eligible, the read query, and the fake replacement
 * values themselves.
 *
 * `dataType`/`updateable` are both confirmed real UI API FieldInfo properties (see
 * inspectorNativeSchemaExplorerUtils's own doc comment for the verification story).
 */

// Deliberately narrow - text-ish/contact-detail types only. A formula, picklist, or system field
// either can't be written to at all or would need a type-appropriate generator this tool doesn't
// offer; skipping them here means the field picker never offers a selection that would fail later.
const MASKABLE_DATA_TYPES = new Set(['String', 'TextArea', 'Email', 'Phone']);

/** Every updateable field on the object whose type this tool knows how to mask, sorted by label. */
export function filterMaskableFields(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .filter((apiName) => MASKABLE_DATA_TYPES.has(fields[apiName].dataType) && fields[apiName].updateable)
    .map((apiName) => ({ apiName, label: fields[apiName].label || apiName, dataType: fields[apiName].dataType }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Plain "fetch N records with just these fields" SOQL - no WHERE clause, matches Data Export's own "export everything" scope. */
export function buildMaskingSoql(objectApiName, fieldApiNames, maxRows) {
  return `SELECT Id, ${fieldApiNames.join(', ')} FROM ${objectApiName} LIMIT ${maxRows}`;
}

/**
 * A deterministic, built-in fake value for one field on one row - index is the row's 1-based
 * position in the result set, so values stay unique across rows (important for fields that might
 * carry a uniqueness constraint, like Email) and reproducible across re-previewing the same query.
 * Field API name (not just its dataType) decides whether a "name"-flavored value is used, since the
 * UI API's dataType alone can't distinguish a Name field from any other plain String field.
 */
export function generateMaskedValue(field, index) {
  if (field.dataType === 'Email') {
    return `masked${index}@example.com`;
  }
  if (field.dataType === 'Phone') {
    return `555-01${String(index).padStart(2, '0')}`;
  }
  if ((field.apiName || '').toLowerCase().includes('name')) {
    return `Test User ${index}`;
  }
  return `Masked Value ${index}`;
}

/**
 * Builds one preview row per queried record: its Id, and one { apiName, label, original, masked }
 * cell per selected field - side by side, so a reviewer can see exactly what's about to change
 * before Apply is ever clicked.
 */
export function buildPreviewRows(records, fields) {
  return records.map((record, index) => ({
    id: record.Id,
    cells: fields.map((field) => ({
      apiName: field.apiName,
      label: field.label,
      original: record[field.apiName],
      masked: generateMaskedValue(field, index + 1)
    }))
  }));
}

/** { apiName, dataType, editable: true } per selected field - the column shape buildUpsertMutation expects. */
export function buildMaskingColumns(fields) {
  return fields.map((field) => ({ apiName: field.apiName, dataType: field.dataType, editable: true }));
}

/** { clientId, values } per preview row, values keyed by apiName - the row shape buildUpsertMutation expects. */
export function buildMaskingRows(previewRows) {
  return previewRows.map((row) => ({
    clientId: row.id,
    values: Object.fromEntries(row.cells.map((cell) => [cell.apiName, cell.masked]))
  }));
}

/**
 * Every preview row maps to itself - Data Masking only ever updates records it just queried
 * (real, already-existing Ids), never creates new ones, so buildUpsertMutation's create/update
 * branch always takes the update path here.
 */
export function buildMatchedIdMap(previewRows) {
  return new Map(previewRows.map((row) => [row.id, row.id]));
}
