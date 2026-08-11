import { buildFieldModelFromFieldInfo, buildFieldModels, serializeGqlValue } from 'c/inspectorNativeSharedUtils';
import { gql } from 'lightning/graphql';

function buildSectionColumns(section, objectInfo, picklistData) {
  const columns = [];
  (section.layoutRows || []).forEach((row) => {
    (row.layoutItems || []).forEach((item) => {
      columns.push(...buildFieldModels(item, objectInfo, {}, picklistData, true));
    });
  });
  return columns;
}

/**
 * Builds the section-grouped column definitions for the entry grid. Every row in the
 * grid shares the same columns (label, type, required, editable, options, ...), since new
 * records all use the same create-mode layout and field-level security.
 */
export function buildColumnGroups(layout, objectInfo, picklistData) {
  const sections = layout?.sections ?? [];
  return sections
    .map((section, index) => {
      const columns = buildSectionColumns(section, objectInfo, picklistData);
      return { id: `group-${index}`, heading: section.heading, columnCount: columns.length, columns };
    })
    .filter((group) => group.columnCount > 0);
}

/**
 * Every field's apiName that's a constituent of a compound field (e.g. Salutation, FirstName,
 * LastName all belong to "Name"), keyed by that compound field's apiName.
 */
function groupByCompoundFieldName(fields) {
  const byCompound = new Map();
  Object.keys(fields).forEach((apiName) => {
    const compoundFieldName = fields[apiName]?.compoundFieldName;
    if (!compoundFieldName) return;
    if (!byCompound.has(compoundFieldName)) byCompound.set(compoundFieldName, []);
    byCompound.get(compoundFieldName).push(apiName);
  });
  return byCompound;
}

/**
 * Orders apiNames for display, keeping every compound field's constituents adjacent (in
 * objectInfo's own field order, e.g. Salutation/FirstName/LastName) rather than scattering them
 * wherever their own individual label happens to sort - a plain alphabetical-by-label sort would
 * otherwise separate e.g. "First Name" and "Last Name" from "Salutation" once other fields' labels
 * fall between them. Each compound group is itself sorted into position alphabetically by the
 * compound field's own label (e.g. "Name"); standalone fields sort by their own label.
 */
function sortKeepingCompoundGroupsTogether(apiNames, fields) {
  const groupKeyOf = (apiName) => fields[apiName]?.compoundFieldName || apiName;
  const groupOrder = [];
  const groupMembers = new Map();
  apiNames.forEach((apiName) => {
    const groupKey = groupKeyOf(apiName);
    if (!groupMembers.has(groupKey)) {
      groupMembers.set(groupKey, []);
      groupOrder.push(groupKey);
    }
    groupMembers.get(groupKey).push(apiName);
  });

  return groupOrder
    .map((groupKey) => ({ groupKey, sortLabel: fields[groupKey]?.label || groupKey }))
    .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel))
    .flatMap(({ groupKey }) => groupMembers.get(groupKey));
}

function buildFieldColumns(objectInfo, picklistData, apiNames) {
  const fields = objectInfo.fields || {};
  return sortKeepingCompoundGroupsTogether(apiNames, fields)
    .map((apiName) => buildFieldModelFromFieldInfo(apiName, objectInfo, {}, picklistData))
    .filter((column) => column?.editable);
}

/**
 * Builds a single-group column list from every createable field on the object, ignoring the
 * layout entirely ("All Fields" mode) - for when the admin wants a minimal or unrestricted create
 * form rather than whatever the assigned layout happens to show. Fields the user can't set on
 * create (system/read-only fields like Id, SystemModstamp, ...) are excluded rather than shown
 * disabled, since they'd never be settable in this mode regardless of layout.
 */
export function buildAllFieldsColumnGroups(objectInfo, picklistData) {
  const columns = buildFieldColumns(objectInfo, picklistData, Object.keys(objectInfo.fields || {}));
  if (columns.length === 0) return [];
  return [{ id: 'group-all-fields', heading: 'All Fields', columnCount: columns.length, columns }];
}

/**
 * Builds a single-group column list from every field that's genuinely required by the object
 * itself (apiRequired), ignoring the layout entirely ("Required Only" mode) - the minimal
 * possible create form, for when no layout gives exactly the small field set wanted (e.g. one
 * that was never assigned to any Record Type, so it can't be reached via getRecordCreateDefaults
 * at all - required fields are reachable regardless, since they come straight from objectInfo).
 * If a required field is one piece of a compound field (e.g. LastName, part of Name alongside
 * Salutation and FirstName), every sibling constituent is included too so the compound group
 * renders whole rather than showing just the one required piece in isolation.
 */
export function buildRequiredFieldsColumnGroups(objectInfo, picklistData) {
  const fields = objectInfo.fields || {};
  const requiredApiNames = Object.keys(fields).filter((apiName) => fields[apiName]?.required);
  const siblingsByCompound = groupByCompoundFieldName(fields);

  const apiNamesToShowSet = new Set(requiredApiNames);
  requiredApiNames.forEach((apiName) => {
    const compoundFieldName = fields[apiName]?.compoundFieldName;
    if (!compoundFieldName) return;
    (siblingsByCompound.get(compoundFieldName) || []).forEach((sibling) => apiNamesToShowSet.add(sibling));
  });
  // Preserve objectInfo's own field order (sortKeepingCompoundGroupsTogether relies on it to keep
  // compound constituents adjacent) rather than the Set's insertion order.
  const apiNamesToShow = Object.keys(fields).filter((apiName) => apiNamesToShowSet.has(apiName));

  const columns = buildFieldColumns(objectInfo, picklistData, apiNamesToShow);
  if (columns.length === 0) return [];
  return [{ id: 'group-required-fields', heading: 'Required Fields', columnCount: columns.length, columns }];
}

/**
 * Flattens section-grouped columns into a single ordered list, matching the grid's column order.
 */
export function flattenColumnGroups(columnGroups) {
  return columnGroups.flatMap((group) => group.columns);
}

function buildRowFieldAssignments(columns, rowValues) {
  return columns
    .filter((column) => column.editable)
    .map((column) => `${column.apiName}: ${serializeGqlValue(column.dataType, rowValues[column.apiName])}`)
    .join(', ');
}

/**
 * Builds a single GraphQL mutation that creates or updates every given row via an aliased
 * uiapi.{Object}Create/{Object}Update field per row, so a whole batch is submitted in one
 * request. A row is updated (against matchedIdByClientId's Id) if it was matched to an existing
 * record by resolveMatches/extractMatchedIds, otherwise it's created. Each alias is
 * "row_{clientId}", which GraphQL also uses as the error path segment, letting
 * extractSaveResults correlate failures back to their row.
 */
export function buildUpsertMutation(objectApiName, columns, rows, matchedIdByClientId) {
  const rowMutations = rows
    .map((row) => {
      const fieldStr = buildRowFieldAssignments(columns, row.values);
      const existingId = matchedIdByClientId.get(row.clientId);
      if (existingId) {
        return `row_${row.clientId}: ${objectApiName}Update(input: { Id: "${existingId}", ${objectApiName}: { ${fieldStr} } }) { Record { Id } }`;
      }
      return `row_${row.clientId}: ${objectApiName}Create(input: { ${objectApiName}: { ${fieldStr} } }) { Record { Id } }`;
    })
    .join('\n        ');
  return gql`
    mutation UpsertRecords {
      uiapi {
        ${rowMutations}
      }
    }
  `;
}

/**
 * Correlates an upsert mutation result back to the submitted rows, using the "row_{clientId}"
 * alias as both the data key and the GraphQL error path segment. Each result is tagged with
 * whether it was a create or an update, per matchedIdByClientId (the same map buildUpsertMutation
 * was given), for the post-save results report.
 */
export function extractSaveResults(result, rows, matchedIdByClientId) {
  const data = result?.data?.uiapi ?? {};
  const errors = result?.errors ?? [];
  return rows.map((row) => {
    const alias = `row_${row.clientId}`;
    const operation = matchedIdByClientId?.has(row.clientId) ? 'update' : 'create';
    const recordId = data[alias]?.Record?.Id;
    if (recordId) return { clientId: row.clientId, success: true, recordId, operation };
    const matchedError = errors.find((err) => (err.path || []).includes(alias));
    return {
      clientId: row.clientId,
      success: false,
      errorMessage: matchedError?.message ?? 'Unknown error saving this row',
      operation
    };
  });
}

/**
 * Builds a single GraphQL mutation that deletes every given row via an aliased
 * uiapi.{Object}Delete field per row, so a whole batch is submitted in one request - same
 * multi-alias-per-request shape as buildUpsertMutation, just Delete instead of Create/Update.
 * Every row must already have a known existingRecordId (query mode's queried-record Id) - deleting
 * an unsaved, never-persisted row makes no sense and isn't attempted.
 */
export function buildBulkDeleteMutation(objectApiName, rows) {
  const rowMutations = rows
    .map((row) => `row_${row.clientId}: ${objectApiName}Delete(input: { Id: "${row.existingRecordId}" }) { Id }`)
    .join('\n        ');
  return gql`
    mutation DeleteRecords {
      uiapi {
        ${rowMutations}
      }
    }
  `;
}

/**
 * Correlates a bulk delete mutation result back to the submitted rows, using the same
 * "row_{clientId}" alias/error-path convention as extractSaveResults.
 */
export function extractDeleteResults(result, rows) {
  const data = result?.data?.uiapi ?? {};
  const errors = result?.errors ?? [];
  return rows.map((row) => {
    const alias = `row_${row.clientId}`;
    const deletedId = data[alias]?.Id;
    if (deletedId) return { clientId: row.clientId, success: true, recordId: deletedId };
    const matchedError = errors.find((err) => (err.path || []).includes(alias));
    return { clientId: row.clientId, success: false, errorMessage: matchedError?.message ?? 'Unknown error deleting this row' };
  });
}

function buildRowMatchFilter(matchFieldApiNames, columns, row) {
  const columnsByApiName = new Map(columns.map((c) => [c.apiName, c]));
  const conditions = matchFieldApiNames.map((apiName) => {
    const column = columnsByApiName.get(apiName);
    return `{ ${apiName}: { eq: ${serializeGqlValue(column.dataType, row.values[apiName])} } }`;
  });
  return conditions.length === 1 ? conditions[0] : `{ and: [${conditions.join(', ')}] }`;
}

/**
 * Builds a GraphQL query that finds existing records whose selected match-key field(s) equal
 * any of the given rows' current values, so buildUpsertMutation can decide create vs update
 * per row. Only rows with a value for every match field are included (nothing to match a blank
 * against). Uses eq/and/or combinators only (the only where-clause operators with precedent
 * elsewhere in this codebase, e.g. graphqlDatatable's _buildWhereClause) - not "in", which has
 * no confirmed support.
 */
export function buildMatchQuery(objectApiName, matchFieldApiNames, columns, rows) {
  const matchableRows = rows.filter((row) => matchFieldApiNames.every((f) => row.values[f]));
  if (matchableRows.length === 0) return null;
  const whereParts = matchableRows.map((row) => buildRowMatchFilter(matchFieldApiNames, columns, row));
  const whereClause = whereParts.length === 1 ? whereParts[0] : `{ or: [${whereParts.join(', ')}] }`;
  const fieldNodes = matchFieldApiNames.map((f) => `${f} { value }`).join(' ');
  return gql`
    query MatchExistingRecords {
      uiapi {
        query {
          ${objectApiName}(where: ${whereClause}, first: ${matchableRows.length}) {
            edges {
              node {
                Id
                ${fieldNodes}
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * Builds a clientId -> existing record Id map from a buildMatchQuery result, correlating each
 * returned record back to the rows that share its match-key value(s). If multiple existing
 * records share the same match-key value(s), the first one returned wins.
 */
export function extractMatchedIds(result, objectApiName, matchFieldApiNames, rows) {
  const edges = result?.data?.uiapi?.query?.[objectApiName]?.edges ?? [];
  const idByMatchKey = new Map();
  edges.forEach(({ node }) => {
    const key = matchFieldApiNames.map((f) => node[f]?.value ?? '').join('');
    if (!idByMatchKey.has(key)) idByMatchKey.set(key, node.Id);
  });

  const matchedIdByClientId = new Map();
  rows.forEach((row) => {
    if (!matchFieldApiNames.every((f) => row.values[f])) return;
    const key = matchFieldApiNames.map((f) => row.values[f] ?? '').join('');
    const matchedId = idByMatchKey.get(key);
    if (matchedId) matchedIdByClientId.set(row.clientId, matchedId);
  });
  return matchedIdByClientId;
}

/**
 * Builds a GraphQL query for every active Record Type on the given object, so the caller can
 * decide whether a layout picker is needed (more than one) and, if a
 * layoutDeveloperName was supplied, resolve it to a recordTypeId (getRecordCreateDefaults takes
 * an Id, not a DeveloperName, and the UI API's own objectInfo.recordTypeInfos doesn't expose
 * DeveloperName - only Id and label - so this queries the RecordType object directly instead).
 */
export function buildRecordTypeQuery(objectApiName) {
  return gql`
    query GetActiveRecordTypes {
      uiapi {
        query {
          RecordType(where: { and: [{ SobjectType: { eq: "${objectApiName}" } }, { IsActive: { eq: true } }] }, first: 200) {
            edges {
              node {
                Id
                Name {
                  value
                }
                DeveloperName {
                  value
                }
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * Extracts { id, label, developerName } per active Record Type from a buildRecordTypeQuery result.
 */
export function extractRecordTypes(result) {
  const edges = result?.data?.uiapi?.query?.RecordType?.edges ?? [];
  return edges.map(({ node }) => ({
    id: node.Id,
    label: node.Name?.value ?? node.DeveloperName?.value ?? node.Id,
    developerName: node.DeveloperName?.value ?? null
  }));
}

/**
 * Pure decision logic for what the caller should do once the active Record Types are
 * known: use a directly-given recordTypeId, switch to All Fields / Required Only / (explicitly)
 * Default Layout mode, resolve a layoutDeveloperName to a matching Record Type, or fall back to
 * showing the layout picker. Extracted from the component so this priority order is independently
 * testable without a wire adapter or DOM. recordTypeId takes priority over
 * showAllFields/requiredFieldsOnly/useDefaultLayout/layoutDeveloperName; those four are mutually
 * exclusive and checked in that order.
 * @returns {{mode: 'direct'|'allFields'|'requiredOnly'|'picker', recordTypeId: string|null}}
 */
export function resolveRecordTypeSelection({
  recordTypeId,
  showAllFields,
  requiredFieldsOnly,
  useDefaultLayout,
  layoutDeveloperName,
  availableRecordTypes
}) {
  if (recordTypeId) return { mode: 'direct', recordTypeId };
  if (showAllFields) return { mode: 'allFields', recordTypeId: null };
  if (requiredFieldsOnly) return { mode: 'requiredOnly', recordTypeId: null };
  // Unlike the other three explicit flags, "use the Default Layout" has no ID/value of its own to
  // key off of - recordTypeId: null already means "Default Layout" once resolved, so this flag
  // exists purely to let a caller skip the picker and land on that resolution directly, the same
  // way clicking "Default Layout" in the picker itself does.
  if (useDefaultLayout) return { mode: 'direct', recordTypeId: null };
  const matched = layoutDeveloperName
    ? (availableRecordTypes || []).find((rt) => rt.developerName === layoutDeveloperName)
    : null;
  if (matched) return { mode: 'direct', recordTypeId: matched.id };
  return { mode: 'picker', recordTypeId: null };
}

/**
 * Filters column groups down to the given set of visible apiNames (column management / "hide
 * fields I don't need" - most useful in All Fields mode, where the column count can otherwise be
 * unwieldy). A falsy or empty hiddenApiNames leaves every column visible. Groups that end up with
 * no visible columns are dropped so their header row doesn't render either.
 */
const OBJECT_API_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Whether a string is safe to use as a Salesforce object API name when building GraphQL query/
 * mutation strings (buildRecordTypeQuery, buildUpsertMutation, buildMatchQuery all interpolate it
 * directly, unescaped). objectApiName can come straight from a URL parameter on the Page launcher
 * (lightning__UrlAddressable, so no Setup-side control over what's passed), so it must be checked
 * before it's ever used to build a query - rejecting anything but letters/digits/underscores rules
 * out quotes, braces, and whitespace that could otherwise alter the query's structure.
 */
export function isValidObjectApiName(objectApiName) {
  return typeof objectApiName === 'string' && OBJECT_API_NAME_PATTERN.test(objectApiName);
}

export function filterVisibleColumnGroups(columnGroups, hiddenApiNames) {
  if (!hiddenApiNames || hiddenApiNames.size === 0) return columnGroups;
  return columnGroups
    .map((group) => {
      const columns = group.columns.filter((column) => !hiddenApiNames.has(column.apiName));
      return { ...group, columns, columnCount: columns.length };
    })
    .filter((group) => group.columnCount > 0);
}