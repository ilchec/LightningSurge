import { gql } from 'lightning/graphql';

/**
 * Pure functions behind the Data Export tab: the field picker's option list, the paginated GraphQL
 * query itself, and turning one page's response into flat export rows.
 */

/**
 * Field options for the export field picker, excluding top-level compound fields (e.g. Name on
 * Contact/Lead) - fields.*.compound is a confirmed real FieldInfo property (see
 * ui_api_responses_field.htm), and whether a compound field is itself directly queryable through
 * this GraphQL API hasn't been confirmed anywhere in this app, unlike its individual constituent
 * fields (FirstName, LastName, ...), which already are (every other GraphQL query in this app
 * queries plain scalar fields only). Excluding compound fields here avoids depending on that
 * unconfirmed behavior at all - every constituent field is still independently offered.
 */
export function buildExportableFieldOptions(objectInfo) {
  const fields = objectInfo?.fields || {};
  return Object.keys(fields)
    .filter((apiName) => !fields[apiName].compound)
    .map((apiName) => ({ label: fields[apiName].label || apiName, value: apiName }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Builds one page of the export query. Id is always queried as a bare field (the same convention
 * every other GraphQL query in this app follows - see buildMatchQuery/buildListQuery elsewhere in
 * this repo) regardless of whether the caller's fieldApiNames also includes "Id" - querying it a
 * second time via "Id { value }" in the same selection set would conflict with the bare "Id"
 * selection and fail. orderBy: Id ASC keeps page-to-page ordering stable across the export loop,
 * independent of whatever fields were actually selected for export.
 */
export function buildExportQuery({ objectApiName, fieldApiNames, pageSize, afterCursor }) {
  const nonIdFields = (fieldApiNames || []).filter((field) => field !== 'Id');
  const fieldNodes = nonIdFields.map((field) => `${field} { value }`).join('\n              ');
  const afterParam = afterCursor ? `, after: "${afterCursor}"` : '';
  const queryString = `query {
    uiapi {
      query {
        ${objectApiName}(first: ${pageSize}${afterParam}, orderBy: { Id: { order: ASC } }) {
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
 * Extracts { rows, totalCount, pageInfo } from one page's GraphQL response. Every row always
 * carries Id (fetched unconditionally - see buildExportQuery) plus every other requested field's
 * raw value (not displayValue - an export is meant to be re-importable, e.g. via this app's own
 * Create Records CSV import, so unformatted values - ISO dates, unformatted numbers - are more
 * useful here than locale-formatted display strings).
 */
export function extractExportRows(data, objectApiName, fieldApiNames) {
  const result = data?.uiapi?.query?.[objectApiName];
  const edges = result?.edges ?? [];
  const nonIdFields = (fieldApiNames || []).filter((field) => field !== 'Id');
  const rows = edges.map(({ node }) => {
    const values = { Id: node.Id };
    nonIdFields.forEach((field) => {
      values[field] = node[field]?.value ?? null;
    });
    return values;
  });
  return {
    rows,
    totalCount: result?.totalCount ?? 0,
    pageInfo: result?.pageInfo ?? { hasNextPage: false, endCursor: null }
  };
}
