import { gql } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Numeric/date/boolean types filter by exact match (`eq`); everything else (text-ish, and any
// unrecognized type) filters by substring match (`like`). Reference is excluded entirely elsewhere
// - relationship-traversal filtering isn't attempted here.
const EXACT_MATCH_DATA_TYPES = new Set(['Int', 'Double', 'Long', 'Currency', 'Percent', 'Boolean', 'Date', 'DateTime']);
const NUMERIC_DATA_TYPES = new Set(['Int', 'Double', 'Long', 'Currency', 'Percent']);

/**
 * Whether a column's field type supports filtering/sorting in this component. Reference is the
 * only exclusion - filtering/sorting through a relationship isn't attempted (see the package
 * README for why), everything else is fair game.
 */
export function isFilterableFieldType(dataType) {
  return dataType !== 'Reference';
}

export function isSortableFieldType(dataType) {
  return dataType !== 'Reference';
}

/**
 * Escapes SOQL/GraphQL LIKE wildcard characters in user-typed filter text - so a literal "%" or "_"
 * typed by the user is matched literally instead of acting as a wildcard.
 */
export function escapeLikeValue(value) {
  return String(value).replaceAll(/[%_\\]/g, String.raw`\$&`);
}

/**
 * Serializes a raw filter value into the GraphQL literal for the given field type: a quoted,
 * escaped string for text-ish/date types, a raw number for numeric types, a raw true/false for
 * Boolean.
 */
function serializeGqlLiteral(value, dataType) {
  if (dataType === 'Boolean') {
    return String(value) === 'true' ? 'true' : 'false';
  }
  if (NUMERIC_DATA_TYPES.has(dataType)) {
    return String(Number(value));
  }
  const escaped = String(value)
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

/**
 * Builds one `{ Field: { like: "..." } }` / `{ Field: { eq: ... } }` GraphQL condition fragment for
 * a single column filter, or null if the field isn't filterable or the value is blank/unusable.
 */
export function buildFieldFilterCondition(fieldApiName, dataType, rawValue) {
  if (!isFilterableFieldType(dataType) || rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return null;
  }
  if (EXACT_MATCH_DATA_TYPES.has(dataType)) {
    if (NUMERIC_DATA_TYPES.has(dataType) && Number.isNaN(Number(rawValue))) {
      return null;
    }
    return `{ ${fieldApiName}: { eq: ${serializeGqlLiteral(rawValue, dataType)} } }`;
  }
  return `{ ${fieldApiName}: { like: ${serializeGqlLiteral(`%${escapeLikeValue(rawValue)}%`, 'String')} } }`;
}

/**
 * Builds the full `where` clause content (no leading "where:") for the related list's query: the
 * fixed parent-FK equality condition, AND'd with one condition per active column filter. Always at
 * least the parent condition - the parent-scoping filter is never optional.
 * @param {string} parentFieldApiName - the FK field on the child object pointing back at the parent
 * @param {string} parentRecordId
 * @param {Array<{fieldApiName: string, dataType: string, value: string}>} columnFilters
 */
export function buildWhereClause(parentFieldApiName, parentRecordId, columnFilters) {
  const conditions = [`{ ${parentFieldApiName}: { eq: "${parentRecordId}" } }`];
  (columnFilters || []).forEach(({ fieldApiName, dataType, value }) => {
    const condition = buildFieldFilterCondition(fieldApiName, dataType, value);
    if (condition) {
      conditions.push(condition);
    }
  });
  return conditions.length === 1 ? conditions[0] : `{ and: [${conditions.join(', ')}] }`;
}

/**
 * Builds an `orderBy: { Field: { order: ASC|DESC } }` fragment, or an empty string when nothing is
 * sorted.
 */
export function buildOrderByClause(fieldApiName, direction) {
  if (!fieldApiName) {
    return '';
  }
  return `, orderBy: { ${fieldApiName}: { order: ${String(direction).toUpperCase()} } }`;
}

/**
 * Builds the full GraphQL query for one page of the related list: an `edges { node { ... } }
 * totalCount pageInfo { hasNextPage endCursor }` connection query against the child object,
 * filtered to the parent record plus any active column filters.
 * @param {Object} params
 * @param {string} params.childObjectApiName
 * @param {string} params.parentFieldApiName
 * @param {string} params.parentRecordId
 * @param {string[]} params.fieldApiNames - columns to select, in display order (Id is always added)
 * @param {Array<{fieldApiName: string, dataType: string, value: string}>} params.columnFilters
 * @param {string} [params.sortField]
 * @param {string} [params.sortDirection] - 'asc' | 'desc'
 * @param {number} params.pageSize
 * @param {string} [params.afterCursor]
 */
export function buildListQuery({
  childObjectApiName,
  parentFieldApiName,
  parentRecordId,
  fieldApiNames,
  columnFilters,
  sortField,
  sortDirection,
  pageSize,
  afterCursor
}) {
  const fieldNodes = fieldApiNames.map((field) => `${field} { value displayValue }`).join('\n              ');
  const whereClause = buildWhereClause(parentFieldApiName, parentRecordId, columnFilters);
  const orderByClause = buildOrderByClause(sortField, sortDirection);
  const afterParam = afterCursor ? `, after: "${afterCursor}"` : '';
  const queryString = `query {
    uiapi {
      query {
        ${childObjectApiName}(first: ${pageSize}${afterParam}, where: ${whereClause}${orderByClause}) {
          edges {
            node {
              Id
              ${fieldNodes}
            }
          }
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }`;
  return gql`
    ${queryString}
  `;
}

/**
 * Builds the delete mutation for one record.
 */
export function buildDeleteMutation(objectApiName, recordId) {
  const mutationString = `mutation DeleteRecord {
    uiapi {
      ${objectApiName}Delete(input: { Id: "${recordId}" }) {
        Id
      }
    }
  }`;
  return gql`
    ${mutationString}
  `;
}

/**
 * Extracts { Id, field1, field2, ... } from one GraphQL connection edge's node, for read-only
 * display (this table is never inline-edited - New/Edit go through their own record form). Prefers
 * the UI API's own formatted `displayValue` (locale-aware dates, currency symbols, thousands
 * separators, and so on) over the raw `value`, so cells look the same as the standard related list.
 * Boolean is the one exception - its raw true/false is kept as-is so the caller can render a
 * checkbox/cross icon instead of text.
 */
export function extractRecordFromNode(node, fieldApiNames, fieldDataTypes) {
  const record = { Id: node.Id };
  fieldApiNames.forEach((field) => {
    record[field] =
      fieldDataTypes[field] === 'Boolean' ? (node[field]?.value ?? false) : (node[field]?.displayValue ?? node[field]?.value);
  });
  return record;
}

export function showToast(component, title, message, variant, mode) {
  component.dispatchEvent(new ShowToastEvent({ title, message, variant, mode }));
}

export function navigateToRecord(component, recordId, actionName) {
  component[NavigationMixin.Navigate]({
    type: 'standard__recordPage',
    attributes: { recordId, actionName }
  });
}
