<img width="1376" height="768" alt="Gemini_Generated_Image_cr7p8zcr7p8zcr7p" src="https://github.com/user-attachments/assets/37c4f72c-890c-45c7-90b2-311028304c6c" />

# Salesforce Inspector Native

A standalone Lightning app, reached via the App Launcher, bundling admin/developer tools built
around the UI API GraphQL wire adapter (`lightning/graphql`) instead of Apex wherever possible. It
has eleven tabs, grouped into four sections on a vertical nav on the left:

- **Data** - Create Records, Query Records, Data Export
- **Schema** - Schema Explorer, Relationship Map, Field Creator
- **Users & Security** - Permissions and Groups, FLS Matrix, Org Chart, Record Access Inspector
- **Org Info** - Limits and Licenses

The section grouping is a fixed, client-side concept, not admin-configurable; a section with
nothing currently enabled in it doesn't render its header. Which individual tabs show up is
configurable per org - see "Tab visibility" below.

## Fully standalone

Like every other topic in this repo, this package deploys entirely on its own:

```bash
sf project deploy start --source-dir salesforceInspectorNative
```

Nothing here is imported from outside this package - the same "copy what you need in, trimmed to
what's actually used" convention this repo uses everywhere (see the top-level
[`README.md`](../README.md)'s "Why duplication instead of a shared common package" section). Create
Records' bulk create/upsert grid engine (`inspectorNativeRecordEntry`) and its supporting bundles
(CSV import, column/mutation utilities, shared toast/navigation helpers, the mapping dialog, the
form-field renderer) are this package's own self-contained copies, all under its own
`inspectorNative` prefix.

## What's in it

- **Create Records tab** - pick an object from a live, permission-aware list, then a layout
  (Default Layout, a specific Record Type, All Fields, or Required Only). Once both are chosen, the
  bulk create/upsert grid renders directly below the selectors: CSV import with column auto-mapping,
  match-key upserts against existing records, a Field View/Table View toggle, and save-mode options
  like ignoring layout-required fields. Finishing or cancelling resets the selectors; the results
  screen gives clickable links to every saved record.
- **Query Records tab** - type a SOQL query and run it. Results render in the same Field View/Table
  View grid, with a toolbar trimmed to what applies to already-queried records: **Export CSV** (the
  current grid contents, including unsaved edits), **Delete Selected**, and the view toggle. Results
  open **read-only** by default; click **Edit** to make the grid editable, click it again (now
  **View Only**) to discard any unsaved changes and revert to the originally-queried values. Each
  edited row saves as an **update** against the record it was queried from (its own Id, known up
  front - no matching involved).

  Parent relationship traversal is supported, read-only (e.g. `SELECT Id, Name, Account.Name,
  Account.Owner.Name FROM Contact`) - `InspectorNativeSoqlRunner` flattens each queried record's
  populated fields into dot-path keys like `Account.Name`, to arbitrary depth. They render as
  plain read-only text columns. Child-relationship subqueries (e.g. `(SELECT Id FROM Contacts)`)
  are not supported - this grid only ever renders one row per top-level queried record.

  **Delete Selected** bulk-deletes checked rows via an immediate GraphQL mutation, asks for
  confirmation first, and is the only action in this app that writes to the org the moment you
  click it rather than staging a change to review and Save.
- **Field Creator tab** - pick an object, then build a table of fields to create: one row per field
  with Label, API Name, and Type visible. Two per-row buttons cover everything else:
  - **Options** - a modal showing only the inputs relevant to that row's field type (Length,
    Visible Lines, Precision/Scale, picklist values, Description, Help Text, Required, Unique/
    External ID where applicable).
  - **Permissions** - a modal listing your org's permission sets (searchable) with Edit/Read
    checkboxes per row, plus **Apply to All Fields** to copy the current row's selections to every
    other row. Applied automatically after a field is successfully created.

  Use the **clone** icon on a row to duplicate it (including its Options/Permissions selections).
  Modeled on the real [Salesforce Inspector Reloaded](https://tprouvot.github.io/Salesforce-Inspector-reloaded/field-creator/)
  browser extension's Field Creator tool. Supports the twelve standalone field types - Text, Text
  Area (Long), Checkbox, Number, Currency, Percent, Date, Date/Time, Email, Phone, URL, Picklist.
  **Lookup and Master-Detail relationship fields aren't supported** - they need a referenceTo object
  picker, delete-constraint choices, and junction-object rules, a bigger commitment than the rest.

  Each field is deployed via its own synchronous Tooling API callout - one HTTP request per field,
  POSTing to `/services/data/vNN.0/tooling/sobjects/CustomField/` on the org's own domain, with the
  real success/failure (and the actual Tooling API error message on failure) known immediately.
  Authentication is not `UserInfo.getSessionId()` (unreliable for REST/Tooling API use from a
  Lightning-invoked Apex context) - instead `InspectorNativeFieldCreator` renders a tiny internal
  Visualforce page (`InspectorNativeSessionId`, just `{!$Api.Session_ID}`) and reads the session ID
  back via `PageReference.getContent()`.
- **Permissions and Groups tab** - bulk-assign Permission Sets, Permission Set Groups, and Public
  Groups to a set of users in one operation. A 3-step inline flow: pick which items to assign from a
  searchable, type-filterable table; pick which users to assign them to (server-searched by name/
  username/email); review and commit. An optional expiration date applies to Permission Set/
  Permission Set Group grants only - Public Group membership has no expiration concept on the
  platform, so the date input is hidden when only Public Groups are selected.

  Re-running the assignment for a user who already has a selected item updates that assignment's
  expiration date rather than erroring. Every (user × item) combination gets its own result row, so
  a partial failure never hides what did work.
- **Limits and Licenses tab** - two read-only sub-tabs, refreshed on demand:
  - **Limits** - every org limit `System.OrgLimits` reports as applicable to this org, as gauges,
    sorted by usage percentage descending.
  - **Licenses** - User License and Permission Set License usage, as bars with a "used / total"
    count alongside each one.
- **Schema Explorer tab** - pick an object, browse every field it has in one searchable table:
  label, API name, type, required/unique/external ID/createable/updateable, and what a reference
  field points to. Entirely `getObjectInfo`-driven. Each row's pencil icon opens that field's Setup
  detail page in a new tab.
- **Relationship Map tab** - pick an object and see what it looks up to (its lookup/master-detail
  fields) and what looks up to it (its child relationships), as a three-column layout - Parents |
  selected object | Children. Click any node to re-center the map on it. Each column is a
  fixed-height, independently-scrolling list, starting with the first 25 rows and revealing 25 more
  per **Show More** click.
- **Data Export tab** - object + field picker instead of hand-typed SOQL, streaming a full CSV
  export past Query Records' 200-row cap via cursor pagination, looping pages client-side until the
  object is exhausted or a 50,000-row safety cap is hit (an optional "Max rows" input narrows that
  further). Exports raw field values, not locale-formatted display values - meant to be
  re-importable via this app's own Create Records CSV import.
- **FLS Matrix tab** - every field-level-security-eligible field on an object crossed with every
  editable permission set, Read/Edit checkboxes pre-loaded with current access, bulk-saveable in one
  call. Unlike Field Creator's Permissions modal (additive only - it only ever grants a
  newly-created field's permissions), this tool **is** the editor of record for a permission set's
  field access: unchecking a box and clicking Save actually removes that grant. Which fields are
  offered comes from `Schema.DescribeFieldResult.isPermissionable()`.

  A second header row covers the object's own object-level access (Read/Create/Edit/Delete/View
  All/Modify All) per permission set - field-level security is only meaningful alongside at least
  object-level Read. Checking a box enforces the same dependency chain Setup's own UI does (Edit
  implies Read; Delete implies Read+Edit; View All implies Read; Modify All implies
  Read+Edit+Delete), client-side and re-applied server-side on Save. Unlike field grants, an
  `ObjectPermissions` row is only ever upserted, never deleted - unchecking everything zeroes out
  its access flags instead, the same end state Setup's own "Object Settings" page leaves things in.

  Saving a field-level grant for a permission set that doesn't yet have object-level Read on the
  same object auto-grants that Read alongside it, in its own preceding Apex call
  (`ensureObjectReadForFieldGrants`) - Salesforce enforces object-level Read as a prerequisite for
  field-level access, and won't apply it from a DML statement earlier in the same transaction, so it
  has to land as a separately-committed call before the field-level save runs.

  **Select Permission Sets** narrows which permission sets render as matrix columns via a
  dual-listbox picker with a text filter plus Select All/Deselect All - none are shown by default,
  so an org with many permission sets renders a smaller, faster initial table and the empty state
  prompts you straight to the picker. This only changes what's initially displayed, not what the
  initial Apex call fetches.

  Only permission sets with `Type = 'Regular'` are ever offered here (and in Field Creator's
  Permissions modal) - Salesforce also has `Standard`-type permission sets, auto-provisioned
  alongside a Permission Set License (typically from an installed package or platform feature), and
  those are predefined by Salesforce and not editable via any API. Offering them would only ever
  lead to a failed save.
- **Org Chart tab** - browse the User `ManagerId` hierarchy: a "Reports To" node, the currently-
  centered user, and their Direct Reports, in the same one-hop-at-a-time, click-to-recenter
  hub-and-spoke layout Relationship Map uses, applied to people instead of object schema. Opens on
  the current user by default; a search box jumps straight to anyone else. Direct Reports use real
  cursor pagination. Entirely GraphQL - manager traversal via `Manager { Name { value } }`. No Apex
  at all.

  Inspired by, not a code port of,
  [svierk/awesome-lwc-collection's `orgChartViewer`](https://github.com/svierk/awesome-lwc-collection/tree/main/force-app/main/default/lwc/orgChartViewer)
  (MIT licensed) - that component renders a pannable/zoomable chart with PNG export, powered by a
  third-party static resource this repo's no-external-scripts convention doesn't take on; this tab
  is a from-scratch reimplementation in the same spirit (search, click-to-navigate a people
  hierarchy) using this app's own established patterns instead.
- **Record Access Inspector tab** - "why can/can't user X see record Y": pick a user (the same
  server-searched picker Permissions and Groups uses) and paste a record Id, and see their Read/
  Edit/Delete/Transfer access plus overall MaxAccessLevel. Backed by `UserRecordAccess`, the
  platform's own purpose-built object for this - read-only. A meaningful result depends on the
  person running this tool being able to see the record themselves too; an empty/no-access result
  can mean either the target user genuinely has no access, or the record isn't visible to whoever's
  running the check - that ambiguity is called out directly in the tab.

## Where Apex is used

Everything above is UI API/GraphQL except: the object list, running SOQL, field deployment/
permissions, permission/group assignment, org info reads, the FLS matrix, and the record access
read. Each has a narrow, single-purpose Apex class behind it:

- `InspectorNativeObjectPicker` - `getCreatableObjects` (Create Records, Field Creator) and
  `getQueryableObjects` (Schema Explorer, Relationship Map, Data Export, FLS Matrix). Read-only,
  cacheable - `Schema.getGlobalDescribe()` isn't reachable client-side.
- `InspectorNativeSoqlRunner` - runs an arbitrary SOQL query via `Database.query(soql,
  AccessLevel.USER_MODE)`, the modern way to enforce the running user's own CRUD/FLS/sharing on a
  dynamic query. Read-only - `Database.query` can only ever execute a SELECT.
- `InspectorNativeFieldCreator` - builds and POSTs a Tooling API `CustomField` payload per
  requested field. The only class in this app that performs an HTTP callout.
- `InspectorNativeFieldPermissions` / `InspectorNativeFlsMatrix` - grant/revoke field-level and
  object-level access via plain SOQL/DML, no callout needed (`PermissionSet`, `FieldPermissions`,
  and `ObjectPermissions` are all normal queryable/DML-able objects).
- `InspectorNativePermissionAssignment` - lists assignable Permission Sets/Groups/Public Groups,
  searches users, and performs the assignment via `PermissionSetAssignment`/`GroupMember`.
- `InspectorNativeOrgInfo` - reads `UserLicense`/`PermissionSetLicense` and
  `System.OrgLimits.getMap()`. Read-only.
- `InspectorNativeRecordAccess` - reads `UserRecordAccess` for a given user + record Id. Read-only.
  `UserRecordAccess` has real, enforced query constraints: the WHERE clause must filter on a single
  `UserId` and a single `RecordId`, only `RecordId`/the `Has*Access` fields/`MaxAccessLevel` may be
  selected, and `RecordId` must be explicitly in the SELECT list too even though it's already
  pinned in the WHERE clause.

`InspectorNativeObjectPicker`, `InspectorNativeSoqlRunner`, `InspectorNativeOrgInfo`, and
`InspectorNativeRecordAccess` are read-only, low-risk exceptions to the no-Apex convention the rest
of this repo follows. `InspectorNativeFieldCreator`, `InspectorNativeFieldPermissions`,
`InspectorNativePermissionAssignment`, and `InspectorNativeFlsMatrix` write to org schema/security
instead - a created field, a permission grant, or a group assignment all persist until someone
explicitly reverses them, so these are worth granting access to (see "Setting it up") with more
care than the read-only ones.

## Tab visibility

Which tabs show up in the left-hand nav is controlled by `Salesforce_Inspector_Native_Tab__mdt`, a
custom metadata type with one record per tab and a single `Is_Enabled__c` checkbox.
`inspectorNativeApp` reads it via a plain GraphQL query on load - no Apex involved. All eleven tabs
ship enabled by default.

To show or hide a tab: Setup → Custom Metadata Types → **Salesforce Inspector Native Tab** → Manage
Records → open the record for that tab → toggle **Is Enabled** → Save. Takes effect the next time
the app loads - no redeploy needed. The app's own **Tab Settings** nav item links straight there.

A tab whose record doesn't exist, or whose config fails to load for any reason, defaults to
**visible** - a missing record or a failed read should never silently hide a feature nobody meant
to hide.

## Setting it up

1. Deploy this package directory (see above) - this also deploys the bundled **Salesforce Inspector
   Native** permission set.
2. Assign that permission set to whoever should use the app: Setup → Permission Sets →
   "Salesforce Inspector Native" → Manage Assignments → Add Assignment. It grants access to the app,
   its tab, its Apex classes, and the internal Visualforce page - **not** object or field
   permissions for any specific object. This app only ever works against whatever objects/fields the
   assigned user can already create/query/update through their profile or other permission sets.
   - Query Records hands out general-purpose SOQL query access - assign this permission set the
     same way you'd think about giving someone Data Loader or Workbench access, not as casually as a
     single-purpose UI feature.
   - Field Creator (both creating fields and its Permissions modal) additionally needs the running
     user to hold the org-level **"Customize Application"** system permission - a Salesforce
     platform rule for any schema change, which this permission set cannot grant. No Remote Site
     Setting or other manual Setup step is needed for its Tooling API callout - it targets the org's
     own domain, which doesn't require pre-authorization.
   - Permissions and Groups needs **"Assign Permission Sets"** (for the Permission Set/Group half)
     and **"Manage Public Groups"** (for the Public Group half). A user missing one can still use the
     tab for the half they do have rights to.
   - FLS Matrix additionally needs **"Customize Application"** to save changes - the same rule Field
     Creator needs, since field-level security is a schema-adjacent setting.
   - Limits and Licenses, Schema Explorer, Relationship Map, Data Export, Org Chart, and Record
     Access Inspector need nothing beyond the base permission set - all six are read-only.
3. App Launcher → search "Salesforce Inspector Native".

## Package contents

| Component | Role |
|---|---|
| `inspectorNativeApp` | Shell, exposed as the app's Custom Tab (`lightning__Tab`) - vertical nav on the left, active tab's content on the right, About/Tab Settings admin pages. Owns tab-visibility/selected-tab state (reads `Salesforce_Inspector_Native_Tab__mdt` via GraphQL). |
| `Salesforce_Inspector_Native_Tab__mdt` (Custom Metadata Type) | One record per tab, `Is_Enabled__c` checkbox - controls what `inspectorNativeApp` shows. |
| `inspectorNativeCreateRecords` | Create Records tab content: object combobox, layout combobox, and `inspectorNativeRecordEntry` rendered inline once both are chosen. |
| `inspectorNativeQueryRecords` | Query Records tab content: the SOQL textarea, calling `InspectorNativeSoqlRunner`, rendering `inspectorNativeRecordEntry` in `queryMode`. |
| `inspectorNativeFieldCreator` | Field Creator tab content: object picker, field table (add/remove/clone rows), client-side validation, calling `InspectorNativeFieldCreator` then `InspectorNativeFieldPermissions.grantFieldPermissions` for any created field with permissions configured. |
| `inspectorNativeFieldOptions` | "Set Field Options" modal for one Field Creator row. |
| `inspectorNativeFieldPermissions` | "Set Field Permissions" modal for one Field Creator row - lists permission sets via `InspectorNativeFieldPermissions.getAssignablePermissionSets`. |
| `inspectorNativePermissionsGroups` | Permissions and Groups tab content: the 3-step select-items/select-users/results flow, via `InspectorNativePermissionAssignment`. |
| `inspectorNativeLimitsAndLicenses` | Limits and Licenses tab shell, nesting the two sub-tabs below. |
| `inspectorNativeLimits` | Limits sub-tab: org limits as gauges via `InspectorNativeOrgInfo.getOrgLimits`. |
| `inspectorNativeLicenses` | Licenses sub-tab: License usage as bars via `InspectorNativeOrgInfo.getLicenseUsage`. |
| `inspectorNativeRecordEntry` | The grid/CSV/matching/save engine - a plain inline `LightningElement`. Also owns `queryMode` (Query Records' edit-existing-records path). |
| `inspectorNativeSchemaExplorer` | Schema Explorer tab content: object picker + searchable field table, via `inspectorNativeSchemaExplorerUtils`. |
| `inspectorNativeSchemaExplorerUtils` | Pure functions: building/searching the field row list from a `getObjectInfo` response. |
| `inspectorNativeRelationshipMap` | Relationship Map tab content: object picker + the three-column parent/child layout, via `inspectorNativeRelationshipMapUtils`. |
| `inspectorNativeRelationshipMapUtils` | Pure functions: building the parent/child lists and capping how many of each render. |
| `inspectorNativeDataExport` | Data Export tab content: object/field picker, the paginated export loop (via `inspectorNativeQueryBridge`), and the CSV download. |
| `inspectorNativeDataExportUtils` | Pure functions: the field picker's option list, the paginated GraphQL export query, extracting one page's rows. |
| `inspectorNativeFlsMatrix` | FLS Matrix tab content: object picker + the field x permission-set grid + the object-level-access header row, via `inspectorNativeFlsMatrixUtils`. |
| `inspectorNativeFlsMatrixUtils` | Pure functions: merging server state with in-progress unsaved edits, the Edit-implies-Read field checkbox toggle logic, and the object-level-access checkbox toggle/dependency-cascade logic. |
| `inspectorNativeOrgChart` | Org Chart tab content: search box, Reports To/centered-user/Direct Reports layout, via `inspectorNativeOrgChartUtils`. |
| `inspectorNativeOrgChartUtils` | Pure functions: building the user/manager/direct-reports/search GraphQL queries and extracting rows from their responses. |
| `inspectorNativeRecordAccess` | Record Access Inspector tab content: user search (reusing `InspectorNativePermissionAssignment.searchUsers`), record Id input, and the results, via `InspectorNativeRecordAccess`. |
| `InspectorNativeRecordAccess` (Apex) | Read-only `UserRecordAccess` lookup for a given user + record Id. |
| `InspectorNativeObjectPicker` (Apex) | Read-only, cacheable object lists (`getCreatableObjects`, `getQueryableObjects`). |
| `InspectorNativeSoqlRunner` (Apex) | Read-only SOQL execution for Query Records. |
| `InspectorNativeFieldCreator` (Apex) | Builds and POSTs a Tooling API `CustomField` payload per requested field. |
| `InspectorNativeFieldSpec` (Apex) | One field to create - what `deployCustomFields`'s `fieldSpecsJson` parameter deserializes into. |
| `InspectorNativeSessionId` (Visualforce page) | Internal session-ID bridge for Field Creator's Tooling API callout - renders `{!$Api.Session_ID}`, read back via `PageReference.getContent()`. Never navigated to directly. |
| `InspectorNativeFieldPermissions` (Apex) | Lists assignable permission sets (`Type = 'Regular'` only) and grants field-level Read/Edit access - for the Permissions modal, shared by FLS Matrix. |
| `InspectorNativeFieldPermissionGrant` (Apex) | One permission set's Read/Edit selection for a field - a parameter type for `grantFieldPermissions`. |
| `InspectorNativePermissionAssignment` (Apex) | Lists assignable Permission Sets/Groups/Public Groups, searches users, performs bulk assignment. |
| `InspectorNativeOrgInfo` (Apex) | Read-only license usage and org limit reads. |
| `InspectorNativeFlsMatrix` (Apex) | Reads the full field x permission-set matrix plus object-level access, auto-grants object-level Read where a field grant needs it (`ensureObjectReadForFieldGrants`), and bulk-saves both (`saveFieldPermissions`). |
| `InspectorNativeFlsGrant` (Apex) | One (field, permission set) cell's desired Read/Edit state - a parameter type for `saveFieldPermissions`. |
| `InspectorNativeObjectPermissionGrant` (Apex) | One permission set's desired object-level access on the FLS Matrix's object - the other parameter type for `saveFieldPermissions`. |
| Custom Tab / Custom Application (`Salesforce_Inspector_Native`) | App Launcher entry point. |
| Permission Set (`Salesforce_Inspector_Native`) | Grants the app, its tab, all Apex classes, and access to the `InspectorNativeSessionId` Visualforce page - deliberately no object/field permissions, see "Setting it up" above. |
| `inspectorNativeCsvUtils`, `inspectorNativeQueryBridge`, `inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`, `inspectorNativeMapping`, `inspectorNativeFormField` | Supporting bundles for the grid: CSV parsing/mapping, the GraphQL query-to-Promise bridge, column/mutation-building utilities, shared toast/navigation/field-model helpers, the CSV-to-field mapping dialog, and the typed form-field renderer. |
