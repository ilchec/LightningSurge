# Salesforce Inspector Native

A standalone Lightning app, reached via the App Launcher, meant to grow into a home for more than
one admin/developer tool over time. Today it has five tabs: Create Records, Query Records,
Field Creator, Permissions and Groups, and Limits and Licenses - laid out as a **vertical nav on
the left**, not a horizontal tabset, so there's room to keep adding tabs without running out of
header space. Which tabs actually show up is configurable per org (see "Tab visibility" below) -
**Field Creator ships disabled by default**, since its one write path (the Tooling API field-
creation callout) is still unresolved as of this writing; see its own section below for the full,
increasingly long story.

## Fully standalone

Like every other topic in this repo, this package deploys entirely on its own:

```bash
sf project deploy start --source-dir salesforceInspectorNative
```

Its Create Records tab is built on a self-contained bulk create/upsert grid engine
(`inspectorNativeRecordEntry`) plus six supporting bundles - CSV utils, the query bridge, column/
mutation utils, shared utils, the mapping dialog, and the form-field renderer - every one of them
under this package's own `inspectorNative` prefix (`inspectorNativeCsvUtils`,
`inspectorNativeQueryBridge`, `inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`,
`inspectorNativeMapping`, `inspectorNativeFormField`). Nothing here is imported from outside this
package - the same "copy what you need in, trimmed to what's actually used" convention this repo
uses everywhere (see the top-level [`README.md`](../README.md)'s "Why duplication instead of a
shared common package" section).

> This grid engine was originally forked from a standalone `multiRecordEntry` topic (a bulk
> create/upsert modal opened from a Quick Action or List View button), back when both existed side
> by side in this repo. `multiRecordEntry` has since been retired - its functionality is fully
> covered by this tab now, so keeping a second, separate copy of the same engine around no longer
> served any purpose. `inspectorNativeRecordEntry` is the sole surviving, original copy: a plain
> `LightningElement` (not the `LightningModal` the original was), rendered directly on the page
> below the object/layout selectors rather than opened as a popup - that's what this tab always
> needed, independent of anything else that used to live elsewhere in the repo.

It's since grown a second entry path of its own, `queryMode` (used by Query Records - see below):
instead of resolving a create-mode layout, it seeds the grid with already-queried existing records
and builds columns directly from a given field list, with every touched row saving as an update
against its own known Id rather than a create.

## What's in it

- **Create Records tab** - one row of selectors: pick an object from a live, permission-aware list,
  then pick a layout (Default Layout, a specific Record Type, All Fields, or Required Only) from
  the same row. Once both are chosen, the bulk create/upsert grid - CSV import (with column
  auto-mapping), match-key upserts against existing records, a Field View/Table View toggle (see
  the Query Records bullet below for what each mode is), and save-mode options like ignoring
  layout-required fields - renders directly below the selectors, no modal. Finishing or cancelling
  resets the
  selectors so you're ready to pick another object; the results screen already gives clickable
  links to every saved record, so there's no separate navigation step afterward.
- **Query Records tab** - type a SOQL query and run it. The results render in the same Field
  View/Table View grid, with a toolbar trimmed down to what actually applies to already-queried
  records: **Export CSV** (the current grid contents, including any unsaved edits - not tied to a
  save attempt the way the results screen's own CSV export is), **Delete Selected** (see below),
  and the Field View/Table View toggle. Match Fields, Manage Columns, Download CSV Template, Import
  CSV, and Paste from Excel are all Create-Records-specific concepts that don't apply here (every
  row already has a known record - there's nothing to match, no layout columns to manage, nothing
  to import into an already-populated grid) and aren't shown. The "Ignore layout-required fields"
  checkbox is hidden for the same reason - there's no layout involved in query mode, so it would
  always be a no-op.

  **Results open read-only ("View Only") by default, to prevent accidental edits.** Click **Edit**
  to make the grid editable; click it again (now labeled **View Only**) to switch back - any
  changes you made but didn't explicitly save are discarded at that point, reverting every row to
  its originally-queried values. Rows added manually (Add Row) while in Edit mode are dropped
  entirely on switching back to View, rather than left sitting there half-empty - View mode shows
  exactly what was queried, nothing more. Only rows you actually touch get saved, and each one
  saves as an **update** against the record it was queried from (its own Id, known up front - no
  matching, no risk of accidentally creating a duplicate). Column order is alphabetical (with `Id`
  first) rather than necessarily matching your SELECT clause's written order - Apex's `Map`
  iteration order isn't guaranteed to preserve it, and this wasn't worth parsing SOQL text to solve.

  **Parent relationship traversal is supported, read-only** (e.g. `SELECT Id, Name, Account.Name,
  Account.Owner.Name FROM Contact`) - `InspectorNativeSoqlRunner` flattens each queried record's
  populated fields (`SObject.getPopulatedFieldsAsMap()`, which nests a traversed parent as a related
  SObject rather than a flat key) into dot-path keys like `Account.Name`, to arbitrary depth, so the
  grid can treat them like any other queried field. They render as plain read-only text columns -
  there's no update mutation path back to a related record's field through this object's own row,
  so they're never editable and never included in a save. **Child-relationship subqueries** (e.g.
  `(SELECT Id FROM Contacts)`) are still not supported - a list of related records can't flatten
  into one scalar column, and this grid only ever renders one row per top-level queried record.

  **Delete Selected** bulk-deletes the checked rows via a real, immediate GraphQL mutation (batched
  the same way saves are) - unlike the per-row trash icon next to each row, which only removes it
  from the local grid. Only available in Edit mode (same gating as every other edit here), and
  always asks for confirmation first - deleting a record can't be undone, and this is the only
  action in this whole app that writes to the org the moment you click it rather than staging a
  change for you to review and Save. Deleted rows disappear from the grid immediately and report
  into the same results screen a save would, tagged "Deleted" instead of "Created"/"Updated".
- **Field Creator tab** - pick an object, then build a compact table of fields to create: one row
  per field with just Label, API Name, and Type visible, matching Salesforce Inspector Reloaded's
  own layout. Everything else lives behind two per-row buttons instead of cluttering the row:
  - **Options** - a modal showing only the inputs relevant to that row's field type (Length for
    Text/Text Area/Email/URL, Visible Lines for Text Area, Precision/Scale for Number/Currency/
    Percent, picklist values for Picklist), plus Description, Help Text, Required (not offered for
    Checkbox - it can't be "required" the way other types can), and Unique/External ID (only
    offered for Text/Number/Email - the same types the standard field-creation UI allows them on).
  - **Permissions** - a modal listing your org's permission sets (searchable) with Edit/Read
    checkboxes per row, plus **Apply to All Fields** to copy the current row's selections to every
    other row in the batch. Applied automatically after that field is successfully created - a
    field that fails to create has nothing to grant permissions on, so nothing is attempted for it.

  Use the **clone** icon on a row to duplicate it (including its Options/Permissions selections)
  as a starting point for a similar field, rather than re-entering everything.

  Modeled on the real [Salesforce Inspector Reloaded](https://tprouvot.github.io/Salesforce-Inspector-reloaded/field-creator/)
  browser extension's Field Creator tool. Supports the twelve standalone field types - Text, Text
  Area (Long), Checkbox, Number, Currency, Percent, Date, Date/Time, Email, Phone, URL, Picklist.
  **Lookup and Master-Detail relationship fields aren't supported** - they need a referenceTo object
  picker, delete-constraint choices, and junction-object rules, a bigger data-model commitment than
  the rest; a plausible future addition, not part of this pass.

  Each field is deployed via its own **synchronous Tooling API callout** - one HTTP request per
  field, POSTing to `/services/data/vNN.0/tooling/sobjects/CustomField/` on the org's own domain,
  with the real success/failure (and the actual Tooling API error message on failure) known
  immediately, no polling involved. This was not the original design - the first attempt used
  Apex's built-in `Metadata` namespace (`Metadata.Operations.enqueueDeployment`), which turned out
  not to support arbitrary custom field creation at all (it only covers a narrow set of metadata
  types, mainly Custom Metadata Type *records*) and failed to compile. The Tooling API callout
  replaced it - smaller than the alternative (a large, separately-vendored WSDL-generated
  `MetadataService.cls`), and, as a side benefit, synchronous with real error messages instead of
  needing to guess from polling.

  **This callout needs a one-time manual Setup step that can't be pre-packaged**: a Remote Site
  Setting authorizing a callout back to the org's own domain, which isn't knowable until the
  package is actually deployed to a specific org. See "Setting it up" below for the exact steps.

  **Authentication is not `UserInfo.getSessionId()`** - confirmed directly, a session obtained that
  way from Apex invoked by a Lightning component is frequently not valid for REST/Tooling API use at
  all (independent of org-level settings like API Allowlisting - there's no supported way to get an
  API-capable session ID from Lightning). Instead, `InspectorNativeFieldCreator` renders a tiny
  internal Visualforce page (`InspectorNativeSessionId`, just `{!$Api.Session_ID}`) and reads the
  session ID back via `PageReference.getContent()` - the well-known, Salesforce-discouraged-but-
  functional workaround for this exact gap, and the one deployable option that doesn't require
  manually setting up a Connected App/Auth Provider/Named Credential (the officially-recommended but
  much heavier alternative). Rendered once per deploy call, not once per field.

  **Field Creator is disabled by default (see "Tab visibility" below) because this last piece is
  still broken, unresolved despite several rounds of fixes.** The symptom: `deployFields`'s
  `List<InspectorNativeFieldSpec>` parameter arrives in Apex as a list of the right length, every
  element present, every property on every element `null` - despite the browser's actual outgoing
  network request (verified directly in DevTools, not just client-side logging) being fully and
  correctly populated. Three independent, individually well-motivated fixes were tried and each
  had *zero* effect on the symptom:
  1. Renamed the property from `apiName` to `fieldApiName`, in case it collided with a reserved key
     in Lightning Data Service's own record-metadata format.
  2. Extracted the spec type from a nested inner class of `InspectorNativeFieldCreator` into its
     own top-level class (`InspectorNativeFieldSpec`) - Apex inner classes are confirmed unreliable
     as `List<T>` *parameter* types for LWC-invoked methods in general (they work fine as *return*
     types, which is why every other DTO in this app, all nested, still works), but this wasn't the
     cause here either. `InspectorNativeFieldPermissionGrant` (the Permissions modal's grant type)
     was pulled out the same way anyway, pre-emptively, since it's still a real, separate
     platform quirk worth avoiding even though it didn't explain this bug.
  3. Renamed the method itself (`deployFields` → the current `deployCustomFields`), in case a stale
     server-side action-definition cache, keyed by class+method name, was the culprit.

  None of it moved the needle. Given the raw request body is confirmably correct, the remaining
  candidates are outside this codebase - something in this specific org's environment (a
  proxy/VPN/security policy modifying the request in transit) or a deeper, unconfirmed platform
  quirk specific to `List<T>` parameter deserialization. **This is genuinely unresolved** - if
  you're picking this back up, the two diagnostics still wired in (a `console.log` of the outgoing
  `fieldSpecs` in `inspectorNativeFieldCreator.js`, and `JSON.serialize(spec)` embedded in
  `InspectorNativeFieldCreator`'s "missing required field data" error message) are there to compare
  both ends of the same call again without having to re-add them.
- **Permissions and Groups tab** - bulk-assign Permission Sets, Permission Set Groups, and Public
  Groups to a set of users in one operation. A 3-step inline flow (no modal): pick which Permission
  Sets/Permission Set Groups/Public Groups to assign from one searchable, type-filterable table;
  pick which users to assign them to (server-searched by name/username/email, since loading every
  user up front doesn't scale); review and commit. An optional expiration date applies to Permission
  Set/Permission Set Group grants only - **Public Group membership has no expiration concept on the
  platform at all** (`GroupMember` has no such field), so the date input is hidden when only Public
  Groups are selected, rather than offering something that would silently do nothing.

  Re-running the assignment for a user who already has a selected item **updates that assignment's
  expiration date** rather than erroring or silently skipping it - useful for bulk-extending
  expirations later, not just first-time grants. Public Group membership has no such update path
  (nothing to update); an existing membership is just reported back as already in place. Every
  (user × item) combination gets its own result row on the results screen, success or failure, so a
  partial failure (e.g. one user hitting a validation rule) never hides what did work.
- **Limits and Licenses tab** - two read-only sub-tabs, refreshed on demand (not cached, since these
  numbers are only useful if current):
  - **Limits** - every org limit `System.OrgLimits` reports as applicable to this org (limits with a
    max of 0 - not applicable to this org's edition/features - are filtered out), as gauges, sorted
    by usage percentage descending. Modeled on Salesforce Inspector Reloaded's own Limits page.
  - **Licenses** - User License and Permission Set License usage (mirrors Company Information's own
    licensing sections), as bars with a "used / total" count alongside each one.

The object list (Create Records), the query itself (Query Records), field deployment/permissions
(Field Creator), permission/group assignment (Permissions and Groups), and org info reads (Limits
and Licenses) are the six places in this repo that aren't pure GraphQL:
- Reliably enumerating every object the running user can create records for, with labels, needs
  `Schema.getGlobalDescribe()`, which isn't reachable client-side. `InspectorNativeObjectPicker` is
  a single, narrow, read-only, cacheable (`@AuraEnabled(cacheable=true)`) Apex method.
- Running an arbitrary SOQL query isn't reachable client-side at all. `InspectorNativeSoqlRunner` is
  a single, narrow, read-only Apex method using `Database.query(soql, AccessLevel.USER_MODE)` - the
  modern, Salesforce-recommended way to enforce the running user's own CRUD/FLS/sharing on a
  dynamic query (replaces `WITH SECURITY_ENFORCED`). `Database.query` can only ever execute a
  SELECT, so there's no way to reach DML through this method - this app still does every *data*
  write via GraphQL mutations, same as everywhere else.
- Creating a custom field is a **schema** change, not a data operation, and isn't reachable without
  the Tooling API either. `InspectorNativeFieldCreator` builds the field's JSON payload and POSTs
  it directly - see above for why a callout, not the built-in `Metadata` Apex namespace.
- Granting field-level Read/Edit access on a permission set is also schema, but - unlike field
  creation - genuinely is plain, standard Apex: `PermissionSet` is a normal queryable object and
  `FieldPermissions` is a normal queryable/DML-insertable one, no callout needed for either.
  `InspectorNativeFieldPermissions` lists permission sets and grants access via ordinary SOQL and
  `upsert`.
- Assigning Permission Sets, Permission Set Groups, and Public Group membership is also plain,
  standard Apex - `PermissionSetAssignment` (which takes either `PermissionSetId` or
  `PermissionSetGroupId`, GA since Spring '20) and `GroupMember` are both normal queryable/
  DML-insertable objects, no callout needed. `InspectorNativePermissionAssignment` lists the
  assignable items, searches users, and performs the assignment.
- Reading license usage and org limits needs Apex too - `UserLicense`/`PermissionSetLicense` are
  queryable objects, and `System.OrgLimits.getMap()` is Apex-native (no SOQL involved at all).
  `InspectorNativeOrgInfo` is read-only, same low-risk category as the first two below.

The object list, SOQL runner, and org info reads are read-only and low-risk - accepted exceptions to
the no-Apex convention the rest of this repo follows, each one narrow, nothing more.
**`InspectorNativeFieldCreator`, `InspectorNativeFieldPermissions`, and
`InspectorNativePermissionAssignment` are different in kind**: they write to org schema. A created
field sticks around until someone deletes it in Setup, a permission grant persists until someone
revokes it, and a Permission Set/Group/Public Group assignment persists until someone removes it -
there's no undo the way there is for a bad query or a bad record edit - so it's worth treating these
permissions (see "Setting it up") with real care, not granting them as casually as the read-only
ones.

## Tab visibility

Which tabs show up in the left-hand nav is controlled by **`Salesforce_Inspector_Native_Tab__mdt`**,
a custom metadata type with one record per tab and a single `Is_Enabled__c` checkbox. `inspectorNativeApp`
reads it via a plain GraphQL query (`Salesforce_Inspector_Native_Tab__mdt { DeveloperName
Is_Enabled__c }`) on load - no Apex involved, same as everywhere else in this app that can avoid it.

To show or hide a tab: Setup → Custom Metadata Types → **Salesforce Inspector Native Tab** → Manage
Records → open the record for that tab → toggle **Is Enabled** → Save. Takes effect the next time
the app loads - no redeploy needed. The app's own **Tab Settings** nav item (always shown,
un-toggleable) links straight to the Custom Metadata Types list in Setup, so this doesn't have to
be remembered as a separate bookmark.

A tab whose record doesn't exist, or whose config fails to load for any reason, **defaults to
visible** - a missing record or a failed read should never silently hide a feature nobody meant to
hide. Custom metadata records ship with intentional values instead: every tab enabled except
**Field Creator**, which ships disabled given its currently-unresolved deploy issue (see its own
section above).

## Setting it up

1. Deploy this package directory (see above) - this also deploys the bundled
   **Salesforce Inspector Native** permission set.
2. Assign that permission set to whoever should use the app: Setup → Permission Sets →
   "Salesforce Inspector Native" → Manage Assignments → Add Assignment. It grants access to the app
   itself, its tab, and all six Apex classes - **not** object or field permissions for any
   specific object. This app only ever works against whatever objects/fields the assigned user can
   already create/query/update through their profile or other permission sets, the same as every
   other UI API-based tool in this repo - it doesn't grant or need its own object access, and a
   permission set can't sensibly grant "every object" without defeating the point of
   least-privilege access.
   - Query Records hands out general-purpose SOQL query access (still fully bounded by the
     assigned user's own CRUD/FLS/sharing) - assign this permission set the same way you'd think
     about giving someone Data Loader or Workbench access, not as casually as a single-purpose UI
     feature.
   - Field Creator additionally needs the running user to hold the org-level **"Customize
     Application"** system permission - a Salesforce platform rule for any schema change,
     regardless of which API creates it, which this permission set cannot grant or substitute for.
     Assigning permission sets away from a permission set the running user doesn't already manage
     is also an admin-level action platform-side. In practice this means Field Creator (both
     creating fields and the Permissions modal) only works for users who already have admin-level
     rights; assigning the Salesforce Inspector Native permission set to someone without them still
     lets them use Create Records/Query Records fine, but Field Creator will fail with a clear
     permission error.
   - Field Creator's Tooling API callout authenticates via a small internal Visualforce-based
     session bridge rather than `UserInfo.getSessionId()` (see "What's in it" above for why) - no
     extra system permission needed for this specifically, unlike an earlier version of this app
     that relied on the running user separately holding "Use Any API Client" (that permission turned
     out not to even be grantable through a deployed Permission Set, and isn't relevant to every
     org anyway - it only matters if API Allowlisting is enabled, which isn't universal).
   - Permissions and Groups similarly needs the running user to hold **"Assign Permission Sets"**
     (for the Permission Set/Permission Set Group half) and **"Manage Public Groups"** (for the
     Public Group half) - again real Salesforce platform rules this permission set cannot grant or
     substitute for. A user missing one of these can still use the tab for the half they do have
     rights to; the other half fails with a clear per-row error on the results screen rather than
     silently doing nothing.
   - Limits and Licenses needs nothing beyond the base permission set - both sub-tabs are read-only
     SOQL/Apex-native reads, no special system permission required.
3. **Field Creator only**: add a Remote Site Setting so its Tooling API callout (see "What's in
   it" above for why it's a callout at all) is allowed to reach the org's own domain - this can't
   be pre-packaged, since the domain isn't known until the package is deployed to a specific org.
   Setup → Remote Site Settings → New Remote Site:
   - **Remote Site Name**: anything, e.g. `Self_Tooling_API`
   - **Remote Site URL**: your org's own My Domain URL (Setup → My Domain shows it, or run
     `System.debug(URL.getOrgDomainUrl());` in Setup → Apex → Execute Anonymous and read it from
     the debug log) - looks like `https://your-domain.my.salesforce.com`
   - Leave **Active** checked, save.

   Skip this step if you don't plan to use Field Creator - none of the other tabs need it.
4. App Launcher → search "Salesforce Inspector Native".

## Package contents

| Component | Role |
|---|---|
| `inspectorNativeApp` | Shell, exposed as the app's Custom Tab (`lightning__Tab`) - vertical nav on the left, active tab's content on the right. Owns tab-visibility/selected-tab state (reads `Salesforce_Inspector_Native_Tab__mdt` via GraphQL); each tab's own content is still self-contained. See "Tab visibility" above. |
| `Salesforce_Inspector_Native_Tab__mdt` (Custom Metadata Type) | One record per tab, `Is_Enabled__c` checkbox - controls what `inspectorNativeApp` shows. See "Tab visibility" above. |
| `inspectorNativeCreateRecords` | Create Records tab content: the object combobox, the layout combobox (its own small `buildRecordTypeQuery`/`extractRecordTypes`-backed wire, reusing those pure functions from `inspectorNativeRecordEntryUtils`), and rendering `inspectorNativeRecordEntry` inline once both are chosen. |
| `inspectorNativeQueryRecords` | Query Records tab content: the SOQL textarea, calling `InspectorNativeSoqlRunner` imperatively, truncating to this app's usual row cap, and rendering `inspectorNativeRecordEntry` in `queryMode` once results come back. |
| `inspectorNativeFieldCreator` | Field Creator tab content: the object picker, the compact field table (add/remove/clone rows), client-side validation, calling `InspectorNativeFieldCreator` imperatively (results known immediately, no polling), then `InspectorNativeFieldPermissions.grantFieldPermissions` for any successfully-created field with permission grants configured. |
| `inspectorNativeFieldOptions` | "Set Field Options" modal for one Field Creator row - which inputs it shows is entirely decided by its caller (`inspectorNativeFieldCreator`), based on that row's field type. |
| `inspectorNativeFieldPermissions` | "Set Field Permissions" modal for one Field Creator row - lists permission sets (via `InspectorNativeFieldPermissions.getAssignablePermissionSets`), collects Edit/Read selections, doesn't grant anything itself (that happens after deploy - see above). |
| `inspectorNativePermissionsGroups` | Permissions and Groups tab content: the 3-step select-items/select-users/results flow, calling `InspectorNativePermissionAssignment` for the item list, user search, and the assignment itself. |
| `inspectorNativeLimitsAndLicenses` | Limits and Licenses tab shell - owns no state, just nests the two sub-tabs below, same convention as `inspectorNativeApp`. |
| `inspectorNativeLimits` | Limits sub-tab: org limits as gauges via `InspectorNativeOrgInfo.getOrgLimits`. |
| `inspectorNativeLicenses` | Licenses sub-tab: User/Permission Set License usage as bars via `InspectorNativeOrgInfo.getLicenseUsage`. |
| `inspectorNativeRecordEntry` | The grid/CSV/matching/save engine - a plain inline `LightningElement` (not a `LightningModal`), originally forked from the now-retired `multiRecordEntry` topic, see "Fully standalone" above. Also the only place `queryMode` (Query Records' edit-existing-records path, its trimmed-down toolbar, its View Only/Edit toggle, and CSV export) lives. |
| `InspectorNativeObjectPicker` (Apex) | Read-only, cacheable object list for the Create Records/Field Creator pickers. See "What's in it" above. |
| `InspectorNativeSoqlRunner` (Apex) | Read-only SOQL execution for Query Records. See "What's in it" above. |
| `InspectorNativeFieldCreator` (Apex) | Builds and POSTs a Tooling API `CustomField` payload per requested field, for Field Creator - writes to org schema, and the only Apex class in this app that performs an HTTP callout. See "What's in it" above (and the Remote Site Setting step in "Setting it up"). |
| `InspectorNativeFieldSpec` (Apex) | One field to create - the parameter type for `InspectorNativeFieldCreator.deployFields`. A plain top-level DTO, not nested inside `InspectorNativeFieldCreator` - confirmed directly that Apex inner classes aren't reliable as `List<T>` *parameter* types for LWC-invoked methods (every property silently arrived null despite a correctly-formed client payload); inner classes work fine as *return* types, which is why every other DTO in this app still is one. No separate permission set entry needed - class access security only governs the entry-point method being invoked, not the shape of its parameters. |
| `InspectorNativeSessionId` (Visualforce page) | Internal session-ID bridge for Field Creator's Tooling API callout - just renders `{!$Api.Session_ID}`, read back via `PageReference.getContent()`. Never navigated to directly. See "What's in it" above for why `UserInfo.getSessionId()` isn't used instead. |
| `InspectorNativeFieldPermissions` (Apex) | Lists assignable permission sets and grants field-level Read/Edit access via plain SOQL/DML (no callout) - for the Permissions modal. See "What's in it" above. |
| `InspectorNativeFieldPermissionGrant` (Apex) | One permission set's Read/Edit selection for a field - the parameter type for `InspectorNativeFieldPermissions.grantFieldPermissions`. Same top-level-not-nested reasoning as `InspectorNativeFieldSpec` above, applied proactively before it caused the same bug. |
| `InspectorNativePermissionAssignment` (Apex) | Lists assignable Permission Sets/Groups/Public Groups, searches users, and performs the bulk assignment (with expiration-date updates on re-run) - for the Permissions and Groups tab. See "What's in it" above. |
| `InspectorNativeOrgInfo` (Apex) | Read-only license usage and org limit reads - for the Limits and Licenses tab. See "What's in it" above. |
| Custom Tab / Custom Application (`Salesforce_Inspector_Native`) | App Launcher entry point. |
| Permission Set (`Salesforce_Inspector_Native`) | Grants the app, its tab, all six Apex classes, and access to the `InspectorNativeSessionId` Visualforce page - deliberately no object/field permissions, see "Setting it up" above. |
| `inspectorNativeCsvUtils`, `inspectorNativeQueryBridge`, `inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`, `inspectorNativeMapping`, `inspectorNativeFormField` | Supporting bundles for the grid above: CSV parsing/mapping, the GraphQL query-to-Promise bridge, column/mutation-building utilities, shared toast/navigation/field-model helpers, the CSV-to-field mapping dialog, and the typed form-field renderer. Originally forked from the now-retired `multiRecordEntry` topic (see "Fully standalone" above) - self-contained now, not vendored from or kept in sync with anything outside this package. |
