/**
 * Pure functions behind the Schema Explorer tab: turns a getObjectInfo response into a flat,
 * searchable field list. Every property read here (label, dataType, required, unique, externalId,
 * createable, updateable, referenceToInfos) is a confirmed real property of the UI API's FieldInfo
 * shape (developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_field.htm) -
 * verified directly rather than assumed, after this app's own Field Creator saga showed how costly
 * an unverified metadata-shape assumption can be.
 */

/**
 * Builds one row per field on the object, sorted by label. Picklist values themselves aren't
 * included - that's a separate wire (getPicklistValuesByRecordType) this tool doesn't fetch, to
 * keep this a lightweight describe-only browser rather than pulling in a second wire per object.
 */
export function buildFieldRows(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .map((apiName) => {
      const fieldInfo = fields[apiName];
      return {
        apiName,
        label: fieldInfo.label || apiName,
        dataType: fieldInfo.dataType,
        required: Boolean(fieldInfo.required),
        unique: Boolean(fieldInfo.unique),
        externalId: Boolean(fieldInfo.externalId),
        createable: Boolean(fieldInfo.createable),
        updateable: Boolean(fieldInfo.updateable),
        custom: Boolean(fieldInfo.custom),
        referenceTo: (fieldInfo.referenceToInfos || []).map((info) => info.apiName).join(', ')
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Case-insensitive substring match against a field's label or API name. Blank/whitespace-only
 * search text returns every row unfiltered.
 */
export function filterFieldRows(rows, searchTerm) {
  const term = (searchTerm || '').trim().toLowerCase();
  if (!term) {
    return rows;
  }
  return rows.filter((row) => row.apiName.toLowerCase().includes(term) || row.label.toLowerCase().includes(term));
}

/**
 * Builds the Setup "Object Manager" field detail page URL, by plain object/field API name - the
 * commonly-documented, no-extra-Apex form of this link. The real Salesforce Inspector (Reloaded)
 * extension this app is modeled on resolves a field's actual Tooling API DurableId first (a
 * FieldDefinition query) rather than using the plain API name directly - a more robust form, at the
 * cost of a new Tooling API read dependency this tool deliberately doesn't take on, consistent with
 * this app's general reluctance to add Tooling API surface area given Field Creator's own
 * still-unresolved Tooling API troubles (see that section of the README). If a specific field ever
 * doesn't resolve through this simpler URL, Setup → Object Manager → (object) → Fields &
 * Relationships remains the manual fallback - this is a convenience link, not the only way in.
 */
export function buildFieldSetupUrl(objectApiName, fieldApiName) {
  return `/lightning/setup/ObjectManager/${objectApiName}/FieldsAndRelationships/${fieldApiName}/view`;
}
