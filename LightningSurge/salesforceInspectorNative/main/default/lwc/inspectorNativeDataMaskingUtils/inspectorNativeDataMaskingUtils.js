/**
 * Pure functions behind the Data Masking tab. Reuses this app's existing record-entry mutation
 * builders (buildUpsertMutation/extractSaveResults, from inspectorNativeRecordEntryUtils - the same
 * ones Query Records already trusts) rather than duplicating that logic - this file only builds the
 * masking-specific pieces: which fields are eligible, the (optionally filtered) read query, and the
 * fake replacement values themselves.
 *
 * `dataType`/`updateable` are both confirmed real UI API FieldInfo properties (see
 * inspectorNativeSchemaExplorerUtils's own doc comment for the verification story).
 *
 * The filter read query is the first place in this package that builds raw SOQL text client-side
 * with a *user-typed* value interpolated into it (every other SOQL/GraphQL builder here only ever
 * interpolates field/object API names, which come from constrained dropdowns, not free text) - see
 * escapeSoqlValue/escapeSoqlLikeValue's own doc comments for the SOQL-injection-relevant escaping
 * that exists specifically because of that.
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

// Filter fields aren't limited to maskable types (the whole point is usually to scope by something
// you're *not* masking, e.g. a status/environment flag) - but a few types are excluded because
// buildFilterCondition below doesn't have a correct SOQL literal form for them (DateTime needs a
// full ISO literal this tool doesn't collect via a plain date input, compound/encrypted types
// aren't filterable via a simple equality/contains comparison at all).
const EXCLUDED_FILTER_DATA_TYPES = new Set(['DateTime', 'Address', 'Location', 'Base64', 'EncryptedString', 'MultiPicklist']);

/** Every field on the object usable as a filter condition, sorted by label - see the exclusion note above. */
export function filterableFieldOptions(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .filter((apiName) => !EXCLUDED_FILTER_DATA_TYPES.has(fields[apiName].dataType))
    .map((apiName) => ({ apiName, label: fields[apiName].label || apiName, dataType: fields[apiName].dataType }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const NUMERIC_FILTER_DATA_TYPES = new Set(['Double', 'Int', 'Currency', 'Percent']);
const DATE_LITERAL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Text-ish types are the only ones "contains" (a SOQL LIKE) makes sense for - every other type
 * offers only "equals" as an operator, both client-side (see the component's operatorOptions) and
 * here (buildFilterCondition ignores operator entirely for non-text types).
 */
export function isContainsEligible(dataType) {
  return !NUMERIC_FILTER_DATA_TYPES.has(dataType) && dataType !== 'Boolean' && dataType !== 'Date';
}

// SOQL string literals are single-quoted; a backslash or an embedded single quote in untrusted
// input must be escaped or it breaks out of the literal - this is a real SOQL-injection-relevant
// spot (the filter value is user-typed, then interpolated directly into a SOQL string this tool
// sends to InspectorNativeSoqlRunner.runQuery, which executes it as-is). Backslash is escaped
// first, deliberately, so a raw backslash immediately before a quote can't neutralize the quote's
// own escaping.
export function escapeSoqlValue(rawValue) {
  return String(rawValue).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/** Same escaping as escapeSoqlValue, plus neutralizing LIKE's own wildcard characters (%, _) so a literal % or _ in the search text is matched literally, not treated as a wildcard. */
export function escapeSoqlLikeValue(rawValue) {
  return String(rawValue).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll("'", "\\'");
}

/**
 * Builds one filter's own SOQL condition fragment, formatting the value as the field's dataType
 * requires - SOQL Boolean/numeric/Date literals are unquoted, everything else is a quoted, escaped
 * string. "contains" always renders as a LIKE regardless of what's passed for other types (see
 * isContainsEligible - the UI never offers it for a type where that wouldn't make sense).
 */
export function buildFilterCondition(filter) {
  const { fieldApiName, dataType, operator, value } = filter;
  if (operator === 'contains') {
    return `${fieldApiName} LIKE '%${escapeSoqlLikeValue(value)}%'`;
  }
  if (dataType === 'Boolean') {
    return `${fieldApiName} = ${String(value).toLowerCase() === 'true' ? 'true' : 'false'}`;
  }
  if (NUMERIC_FILTER_DATA_TYPES.has(dataType)) {
    const parsed = Number(value);
    return `${fieldApiName} = ${Number.isNaN(parsed) ? 'null' : parsed}`;
  }
  if (dataType === 'Date') {
    // A SOQL Date literal is unquoted, so this can't lean on escapeSoqlValue's quote-escaping the
    // way every other branch does - an unvalidated value here would be a real SOQL-injection path.
    // lightning-input type="date" normally guarantees a plain YYYY-MM-DD string, but that's a
    // client-side UI constraint, not something enforced between here and the query this tool sends
    // - so it's re-validated against that exact shape here regardless of what actually produced the
    // value, falling back to the always-safe "null" literal (matching the numeric branch's own
    // fallback) rather than ever passing an unvalidated string straight into the query unescaped.
    return DATE_LITERAL_PATTERN.test(value) ? `${fieldApiName} = ${value}` : `${fieldApiName} = null`;
  }
  return `${fieldApiName} = '${escapeSoqlValue(value)}'`;
}

/**
 * "Fetch N records with just these fields" SOQL, optionally narrowed by a set of filter conditions
 * ANDed together - the entire filtering mechanism this tool offers (no OR, no grouping), matching
 * the same "start narrow" scope Data Export's own filter-free read uses as its baseline.
 */
export function buildMaskingSoql(objectApiName, fieldApiNames, maxRows, filters) {
  const whereClause = filters && filters.length ? ` WHERE ${filters.map(buildFilterCondition).join(' AND ')}` : '';
  return `SELECT Id, ${fieldApiNames.join(', ')} FROM ${objectApiName}${whereClause} LIMIT ${maxRows}`;
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
