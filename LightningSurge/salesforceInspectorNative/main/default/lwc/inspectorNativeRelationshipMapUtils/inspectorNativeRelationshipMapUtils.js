/**
 * Pure functions behind the Relationship Map tab: turns a getObjectInfo response into the two
 * lists the map renders as columns - "objects this object looks up to" (its own Reference fields)
 * and "objects that look up to this one" (its childRelationships). Both fields.*.referenceToInfos
 * and objectInfo.childRelationships are UI API shapes already confirmed working elsewhere in this
 * app (relatedListReloaded's own parent/child relationship resolution uses the same properties).
 */

const REFERENCE_DATA_TYPE = 'Reference';

/**
 * One row per (Reference field, target object) pair - a polymorphic field (e.g. OwnerId: User or
 * Group) yields one row per possible target, since each is a genuinely different relationship to
 * show on the map, not one row with an ambiguous combined label.
 */
export function buildParentRelationships(objectInfo) {
  const fields = objectInfo?.fields || {};
  const rows = [];
  Object.keys(fields).forEach((apiName) => {
    const fieldInfo = fields[apiName];
    if (fieldInfo.dataType !== REFERENCE_DATA_TYPE) {
      return;
    }
    (fieldInfo.referenceToInfos || []).forEach((target) => {
      if (!target?.apiName) {
        return;
      }
      rows.push({
        key: `${apiName}->${target.apiName}`,
        fieldApiName: apiName,
        fieldLabel: fieldInfo.label || apiName,
        targetApiName: target.apiName
      });
    });
  });
  return rows.sort((a, b) => a.fieldLabel.localeCompare(b.fieldLabel));
}

/**
 * One row per child relationship. relationshipName can legitimately be blank for some system
 * relationships that aren't traversable in a SOQL subquery - shown as "(unnamed)" rather than
 * dropped, since the relationship itself (and its child object) is still real and worth showing.
 */
export function buildChildRelationships(objectInfo) {
  const relationships = objectInfo?.childRelationships || [];
  return relationships
    .filter((rel) => rel.childObjectApiName)
    .map((rel) => ({
      key: `${rel.childObjectApiName}-${rel.relationshipName || rel.fieldName}`,
      childObjectApiName: rel.childObjectApiName,
      fieldApiName: rel.fieldName,
      relationshipName: rel.relationshipName || '(unnamed)'
    }))
    .sort((a, b) => a.childObjectApiName.localeCompare(b.childObjectApiName));
}

/**
 * Caps how many rows a map column actually renders - an object with dozens of child relationships
 * (Task/Event/Attachment-style polymorphic children are common on nearly everything) would
 * otherwise make the column unreadably long. Returns how many were hidden so the caller can show a
 * "+N more" note rather than silently truncating.
 */
export function limitRows(rows, maxCount) {
  return {
    visible: rows.slice(0, maxCount),
    hiddenCount: Math.max(0, rows.length - maxCount)
  };
}
