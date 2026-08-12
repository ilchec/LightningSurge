/**
 * Pure functions behind the Picklist Manager tab. `custom` and `dataType` are both confirmed real
 * UI API FieldInfo properties (see inspectorNativeSchemaExplorerUtils's own doc comment for the
 * verification story) - filtering on them client-side means no extra Apex call is needed just to
 * find which fields on an object are custom picklists.
 */

/**
 * Every custom Picklist field on the object, sorted by label. Standard-field picklists are excluded
 * here (not just server-side) - they live in a differently-shaped Tooling object this tool doesn't
 * support yet, so there's no reason to even offer them and hit that error on selection.
 */
export function filterPicklistFields(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .filter((apiName) => fields[apiName].dataType === 'Picklist' && fields[apiName].custom)
    .map((apiName) => ({ apiName, label: fields[apiName].label || apiName }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Case-insensitive check against a value already present in the list - the picklist API value
 * ("fullName"), not the label, since that's what actually has to be unique on the platform.
 */
export function isDuplicatePicklistValue(values, candidateValue) {
  const normalized = (candidateValue || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return values.some((value) => (value.value || '').trim().toLowerCase() === normalized);
}

/** Flips one value's isActive flag, leaving every other entry (and their order) untouched. */
export function toggleValueActive(values, index) {
  return values.map((value, i) => (i === index ? { ...value, isActive: !value.isActive } : value));
}

/**
 * Appends a new, active value to the end of the list - new values are never inserted mid-list, so
 * the existing, already-in-use order is never disturbed by adding one more. Blank input is a no-op
 * (returns the same list) rather than an error - the caller decides whether to also validate
 * duplicates via isDuplicatePicklistValue before calling this.
 */
export function appendNewValue(values, rawValue) {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return values;
  }
  return [...values, { value: trimmed, label: trimmed, isActive: true, isDefault: false }];
}

/**
 * Swaps the value at `index` with its neighbor `direction` steps away (-1 for up, +1 for down) - a
 * single adjacent-pair swap, not a full drag-and-drop reorder. Save always resends the complete
 * value list in whatever order it's currently in, so this is the entire reordering mechanism; no
 * separate "order" field or server-side reordering logic is needed. A no-op (returns the same list,
 * not a copy) at either end of the list rather than wrapping around or erroring.
 */
export function moveValue(values, index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= values.length) {
    return values;
  }
  const updated = [...values];
  const moved = updated[index];
  updated[index] = updated[targetIndex];
  updated[targetIndex] = moved;
  return updated;
}
