<img width="1376" height="768" alt="Gemini_Generated_Image_8sao9w8sao9w8sao" src="https://github.com/user-attachments/assets/7d556def-2009-46f7-8eaa-7253f45479e2" />

# Related List Reloaded

A standalone Lightning Record Page component: a drop-in stand-in for the standard Lightning related
list, with the same look and behavior (title, icon, record count, sortable columns, New, per-row
Edit/Delete, click a row to open it), plus two things the standard one doesn't have - an inline
**Expand** toggle and a **filter input per column**.

## Fully standalone

Like every other topic in this repo, this package deploys entirely on its own:

```bash
sf project deploy start --source-dir relatedListReloaded
```

**This is the first topic in this repo with zero Apex.** Everything is a base LWC module or the
`lightning/graphql` UI API wire adapter:

- **Column configuration** comes from `getRelatedListInfo` (`lightning/uiRelatedListApi`) with its
  default `restrictColumnsToLayout: true` - the same page-layout-driven column list the standard
  related list itself renders from, confirmed directly against the
  [official wire adapter reference](https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-get-related-list-info.html).
- **Relationship/field metadata** (which object a relationship points to, the FK field name, the
  child object's icon/label/createable flag/field types) comes from `getObjectInfo`
  (`lightning/uiObjectInfoApi`).
- **Records** are fetched with `lightning/graphql`'s reactive `@wire(graphql, ...)`, querying the
  child object directly with a `where` clause on its parent-FK field (plus one condition per active
  column filter), using cursor pagination (`first`/`after`/`pageInfo`) and `totalCount`/`orderBy` on
  the connection. This query-building logic was originally adapted from a datatable component that
  used to live in this repo's now-retired `force-app` package - copying/adapting the pattern into
  this package's own files (rather than depending on it directly) is what keeps this package
  independently deployable, per this repo's vendoring convention (see the top-level
  [`README.md`](../README.md)'s "Why duplication instead of a shared common package" section).
- **Delete** is a GraphQL mutation (`uiapi.<Object>Delete`).
- **New/Edit** wrap the base `lightning-record-form` with `layout-type="Full"` - the real page
  layout's fields, the same default behavior the standard New/Edit buttons give you, including its
  own built-in Save/Cancel. `lightning-record-form` has no default-field-value mechanism (only the
  lower-level `lightning-record-edit-form` does, at the cost of giving up automatic layout), so the
  parent relationship field isn't pre-filled - it's shown like any other layout field if the layout
  includes it.

**One flagged uncertainty, resolved without depending on it**: the official `getRelatedListInfo` doc
confirms `data.displayColumns` is an array of `{ fieldApiName, label, ... }` but doesn't fully
document every column property (e.g. whether a `sortable` flag exists) or whether the response
carries its own display label/icon. Rather than guess at unconfirmed shape details, this component
gets the related list's own label/icon from `getObjectInfo(childObjectApiName).labelPlural`/
`themeInfo` instead (both confirmed, stable `ObjectInfo` fields), and treats every displayed column
as sortable/filterable by default except `Reference` fields (filtering/sorting through a
relationship isn't attempted - see "What's in it" below).

## What's in it

- **Header** - the child object's icon and `Plural Label (count)`, a **New** button (only shown if
  the child object is createable), and a **View All (N)** / **Show Less** toggle (only shown once
  there are more records than the collapsed view shows).
- **Collapsed view** (default) - `Rows Shown When Collapsed` rows (a component property, default 4),
  no pagination - matches the standard related list's compact preview.
- **Expanded view** - always up to **15 rows**, with Previous/Next pagination once there are more
  than 15 matching records.
- **Sortable columns** - click a column header to sort by it (toggles ascending/descending); not
  offered on `Reference` columns.
- **A filter input under every column** - text/number/date input matched to the field's type
  (a 3-way Any/True/False picker for `Boolean` columns), debounced, combined with `AND` against each
  other and against the fixed parent-record filter. Not offered on `Reference` columns - filtering
  through a relationship (e.g. by the referenced record's Name) isn't attempted in this pass.
- **Row actions** - click a row's first column to navigate to that record; a per-row **Edit**/
  **Delete** icon button pair, on the left of the row. Delete asks for confirmation first
  (`lightning/confirm`) and can't be undone once confirmed - same as deleting a record anywhere
  else in Salesforce.
- **New/Edit** render the object's real page layout (`lightning-record-form`, `layout-type="Full"`)
  - the same fields, sections, and required-ness the standard New/Edit buttons show, not a
  hand-picked field subset.

## Setting it up

Simpler than every other package here, precisely because there's no Apex:

1. Deploy this package directory (see above).
2. Lightning App Builder → open the record page you want it on → drag **Related List Reloaded**
   from the component palette onto the page.
3. Set its **Relationship API Name** property to the child relationship to show - exactly what you'd
   type configuring the standard "Related List - Single" component (e.g. `Contacts`,
   `Opportunities`, or a custom relationship name ending in `__r`). Optionally adjust **Rows Shown
   When Collapsed** (default 4).
4. Save and activate the page.

No permission set, no Remote Site Setting, no extra system permission - every read is a wire
adapter and every write goes through the platform's own `lightning-record-form`/GraphQL mutation,
both already bound by the running user's own FLS/sharing, the same as every other GraphQL-based
piece of this repo.

## Package contents

| Component | Role |
|---|---|
| `reloadedList` | The component itself - drop it on a Lightning Record Page (`lightning__RecordPage` target) and configure `relationshipApiName`. Owns all wiring (`getObjectInfo` x2, `getRelatedListInfo`, `graphql`), query/filter/sort/pagination state, and the header/table/pagination markup. |
| `reloadedListRecordForm` | New/Edit modal (`LightningModal`) - a thin wrapper around `lightning-record-form` (`layout-type="Full"`), parameterized by object and an optional record Id (omitted = create). |
| `reloadedListPagination` | Previous/Next pagination bar for the expanded view - self-contained (no First/Last; not needed at 15 rows/page). |
| `reloadedListUtils` | Pure functions: GraphQL query/where/orderBy/delete-mutation building, filter-type classification (`isFilterableFieldType`/`isSortableFieldType`), record-extraction from a GraphQL node, toast/navigation helpers. Kept as its own bundle so the query-building logic is unit-testable in isolation - see `__tests__/reloadedListUtils.test.js`. |
