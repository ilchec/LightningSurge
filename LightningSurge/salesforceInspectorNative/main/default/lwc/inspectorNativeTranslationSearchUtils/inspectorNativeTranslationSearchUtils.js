/**
 * Pure functions behind the Translation Finder tab: grouping InspectorNativeTranslationSearch's flat
 * result list by itemType for the tab's grouped tables, and building each result's "View in Setup"
 * link where one actually exists.
 */

/**
 * Groups a flat list of search results into one section per itemType ('Custom Label', 'Object',
 * 'Field', 'Picklist Value'), each sorted by matchedText, sections themselves sorted by type - same
 * shape as inspectorNativeDependencyAnalysisUtils.groupReferencesByType, since both tabs render a
 * grouped-by-type table list.
 */
export function groupResultsByType(results) {
  const byType = new Map();
  (results || []).forEach((result) => {
    const type = result.itemType || 'Unknown';
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type).push(result);
  });
  return [...byType.entries()]
    .map(([itemType, items]) => ({
      itemType,
      items: [...items].sort((a, b) => a.matchedText.localeCompare(b.matchedText)),
      count: items.length
    }))
    .sort((a, b) => a.itemType.localeCompare(b.itemType));
}

// Translation Workbench's own "Translate" working screen (the Setup Component/object/field picker
// where a Field/Picklist Value translation actually gets entered) - not a per-item deep link (that
// picker doesn't take URL params to preselect anything), but lands directly on the right screen.
const TRANSLATION_WORKBENCH_URL = '/lightning/setup/LabelWorkbenchTranslate/home';

/**
 * Custom Label links to its own record detail page, via its raw record Id (`/{id}`) - not a guessed
 * Setup page name, just the universal Salesforce record-Id routing every record Id resolves through
 * regardless of object type. That detail page has its own per-language "Override" related list,
 * where a translation for that specific label is added directly - no separate Translation Workbench
 * wizard needed for a single already-known label.
 *
 * Object links to its own Setup object detail page, same pattern Schema Explorer's own
 * buildFieldSetupUrl already uses for fields. Field/Picklist Value link to Translation Workbench
 * itself (see TRANSLATION_WORKBENCH_URL) rather than the field's own Setup detail page - that's
 * where a field label/help text/picklist value translation actually gets entered.
 */
export function buildResultSetupUrl(result) {
  if (!result) {
    return undefined;
  }
  if (result.itemType === 'Custom Label') {
    return result.labelId ? `/${result.labelId}` : undefined;
  }
  if (result.itemType === 'Object') {
    return result.objectApiName ? `/lightning/setup/ObjectManager/${result.objectApiName}/Details/view` : undefined;
  }
  if (result.itemType === 'Field' || result.itemType === 'Picklist Value') {
    return TRANSLATION_WORKBENCH_URL;
  }
  return undefined;
}
