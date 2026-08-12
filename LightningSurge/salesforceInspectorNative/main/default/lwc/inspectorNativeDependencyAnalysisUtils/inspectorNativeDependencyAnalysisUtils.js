/**
 * Pure functions behind the Impact Analysis tab. `custom` is a confirmed real UI API FieldInfo
 * property (see inspectorNativeSchemaExplorerUtils's own doc comment for the verification story) -
 * filtering on it client-side means the field picker only ever offers fields this tool can actually
 * look up (InspectorNativeDependencyAnalysis only resolves custom fields/objects to a Tooling
 * component Id - see that class's own doc comment for why).
 */

/** Every custom field on the object, sorted by label - any data type, not just picklists. */
export function filterCustomFields(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .filter((apiName) => fields[apiName].custom)
    .map((apiName) => ({ apiName, label: fields[apiName].label || apiName }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Groups a flat list of { componentName, componentType } references into one section per
 * componentType, each sorted by name, sections themselves sorted by type - the server already
 * returns rows in this order, but grouping (not just sorting) only makes sense done here, where the
 * grouped-table markup actually needs it.
 */
export function groupReferencesByType(references) {
  const byType = new Map();
  (references || []).forEach((reference) => {
    const type = reference.componentType || 'Unknown';
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type).push(reference.componentName);
  });
  return [...byType.entries()]
    .map(([componentType, componentNames]) => ({
      componentType,
      componentNames: [...componentNames].sort((a, b) => a.localeCompare(b)),
      count: componentNames.length
    }))
    .sort((a, b) => a.componentType.localeCompare(b.componentType));
}
