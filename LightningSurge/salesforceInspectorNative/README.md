# Salesforce Inspector Native

A standalone Lightning app, reached via the App Launcher, meant to grow into a home for more than
one admin/developer tool over time. Today it has eleven tabs, grouped into four sections on its
**vertical nav on the left** (not a horizontal tabset, and not one flat list either - eleven tabs
spanning record data, object structure, and user/permission administration had become a mixture
that was hard to scan as a single list):

- **Data** - Create Records, Query Records, Data Export
- **Schema** - Schema Explorer, Relationship Map, Field Creator
- **Users & Security** - Permissions and Groups, FLS Matrix, Org Chart, Record Access Inspector
- **Org Info** - Limits and Licenses

Which tabs actually show up is configurable per org (see "Tab visibility" below) - the section
grouping itself is a fixed, hardcoded client-side concept (not admin-configurable the way
`Is_Enabled__c` is); a section with nothing currently enabled in it simply doesn't render its
header. **Field Creator now ships enabled by default again, and the fix is confirmed working** - it
shipped disabled for a long stretch while its one write path (the Tooling API field-creation
callout) had an unresolved missing-field-data bug; the fix (sending the field spec list as a JSON
string instead of a typed `List<T>` Apex-action parameter, parsed with `JSON.deserialize()` inside
the method) was applied after the same failure shape was independently confirmed live for a
different tab (FLS Matrix, see its own section below), and has since been confirmed live for Field
Creator itself too. See its own section for the full story and the diagnostics still wired in.

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

  **Field Creator shipped disabled by default for a long stretch because this last piece was
  broken, unresolved despite several rounds of fixes - it's re-enabled now, and the fix is
  confirmed working live.** The symptom:
  `deployFields`'s `List<InspectorNativeFieldSpec>` parameter arrived in Apex as a list of the
  right length, every element present, every property on every element `null` - despite the
  browser's actual outgoing network request (verified directly in DevTools, not just client-side
  logging) being fully and correctly populated. Four independent, individually well-motivated
  fixes were tried; the first three had *zero* effect on the symptom:
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
  4. **`deployCustomFields` now takes a plain `String` (`fieldSpecsJson`), not a typed
     `List<InspectorNativeFieldSpec>` parameter, and parses it itself with `JSON.deserialize()`** -
     bypassing whatever the automatic `List<T>` Apex-action parameter binding was doing wrong,
     rather than working around it. **This fixed it, confirmed live** - the same fix independently
     confirmed to address the *exact* same failure shape on a different tab entirely (FLS Matrix's
     `saveFieldPermissions`, see that section below), then confirmed here too once actually
     retested.

  Both diagnostics used to reach this fix stay wired in rather than being removed now that it's
  fixed - a `console.log` of the outgoing `fieldSpecs` in
  `inspectorNativeFieldCreator.js`, and `JSON.serialize(spec)` embedded in
  `InspectorNativeFieldCreator`'s "missing required field data" error message - both there to
  compare both ends of the same call again, immediately, if this resurfaces.
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
- **Schema Explorer tab** - pick an object, browse every field it has in one searchable table:
  label, API name, type, required/unique/external ID/createable/updateable, and what a reference
  field points to. Entirely `getObjectInfo`-driven (the same wire every other tab already uses for
  field metadata) - every column comes from a confirmed real UI API `FieldInfo` property, verified
  directly against the official reference rather than assumed, given how costly an unverified
  metadata-shape assumption turned out to be for Field Creator (see that section above). Picklist
  values themselves aren't listed inline - that would need a second wire
  (`getPicklistValuesByRecordType`) per object this tool doesn't fetch, to stay a lightweight
  describe-only browser rather than a heavier field-inspector. Each row's pencil icon opens that
  field's Setup detail page (`/lightning/setup/ObjectManager/.../FieldsAndRelationships/.../view`)
  in a new tab - the commonly-documented, plain-API-name form of that URL, not the more robust
  Tooling-API-`DurableId`-resolved form the real Salesforce Inspector (Reloaded) extension this app
  is modeled on uses, since that would mean taking on a new Tooling API read dependency this tool
  deliberately doesn't (see `inspectorNativeSchemaExplorerUtils.buildFieldSetupUrl`'s own doc
  comment). If a specific field doesn't resolve through it, Object Manager itself is still one click
  away.
- **Relationship Map tab** - pick an object and see what it looks up to (its own lookup/master-
  detail fields) and what looks up to it (its child relationships), as a three-column layout -
  Parents | selected object | Children - not a force-directed graph. That's a deliberate scope
  choice: precise node-to-node line drawing needs either a charting library (this repo loads no
  external scripts - see the top-level README) or runtime DOM measurement, neither of which is
  practical without a live org to verify the result in. Click any node to re-center the map on it,
  so a whole object graph is still explorable one hop at a time. Each column is a fixed-height,
  independently-scrolling list rather than growing the whole page - it starts with the first 25 rows
  and reveals 25 more per **Show More** click, so an object with dozens of polymorphic children
  (Task/Event-style) never renders an unreadably long list all at once, but every relationship is
  still reachable - repeated clicks exhaust the full list rather than capping it.
- **Data Export tab** - object + field picker instead of hand-typed SOQL (Query Records already
  covers the filtered/SOQL case), streaming a full CSV export past Query Records' 200-row cap via
  the same cursor-pagination pattern `relatedListReloaded`'s own query building uses, looping pages
  client-side until the object is exhausted or a 50,000-row hard safety cap is hit (an optional,
  lower "Max rows" input narrows that further). Exports raw field values, not locale-formatted
  display values - meant to be re-importable (e.g. via this app's own Create Records CSV import),
  where an unformatted ISO date or number is more useful than a formatted display string. No
  filtering/WHERE clause in this pass - deliberately scoped to "export everything of this object
  with these fields".
- **FLS Matrix tab** - every field-level-security-eligible field on an object crossed with every
  assignable permission set, Read/Edit checkboxes pre-loaded with current access, bulk-saveable in
  one call. Unlike Field Creator's Permissions modal (`InspectorNativeFieldPermissions`, additive
  only - it only ever grants a newly-created field's permissions, never revokes anything), this tool
  **is** the editor of record for a permission set's field access on an object: unchecking a box and
  clicking Save actually removes that grant (the underlying `FieldPermissions` row is deleted
  outright once both Read and Edit are off, rather than left behind with everything set to false).
  Backed by `InspectorNativeFlsMatrix` - same low-risk shape as `InspectorNativeFieldPermissions`
  (plain, standard SOQL/DML, no callout), just scaled from "one field's grants" up to "every field's
  grants on this object at once". Which fields are offered comes from
  `Schema.DescribeFieldResult.isPermissionable()` - the platform's own authority on whether a field
  supports FLS at all, so nothing offered here is ever a dead-end selection that would fail on Save.

  **A second header row covers the object's own object-level access** (Read/Create/Edit/Delete/
  View All/Modify All, via `ObjectPermissions`) per permission set - field-level security is only
  meaningful alongside at least object-level Read, so a tool that only handled one half would leave
  a real gap. Unlike field grants, an `ObjectPermissions` row is only ever upserted, never deleted,
  even with every box unchecked - whether that row can be deleted via DML at all wasn't confirmed,
  so unchecking everything just zeroes out its access flags instead, the same end state Setup's own
  "Object Settings" page leaves things in. Checking a box enforces the same dependency chain Setup's
  own UI does (Edit implies Read; Delete implies Read+Edit; View All implies Read; Modify All
  implies Read+Edit+Delete) - client-side immediately, and re-applied server-side on Save too, so a
  stale payload can never leave an inconsistent combination saved.

  **Select Permission Sets** narrows which permission sets render as matrix columns via a
  dual-listbox picker with a text filter plus Select All/Deselect All - **none are shown by
  default** (a deliberate change from this tab's first pass, which showed every assignable
  permission set immediately) - an org with many permission sets renders a much smaller, faster
  initial table, and the empty state prompts you straight to the picker instead of an overwhelming
  wall of columns. This only changes what's initially *displayed*, not what the initial Apex call
  *fetches* - `getFieldPermissionMatrix` still reads every assignable permission set's grants in
  one shot regardless of what's shown, so this is a real rendering-time win, not a network-payload
  one. The text filter narrows the picker's own list, and Select All/Deselect All are scoped to
  whatever it currently shows - type "Sales" then Select All to show just the Sales-related
  permission sets as columns, for example. Purely a display filter either way - it never affects
  what Save submits, only which columns are currently visible to edit.

  **A save reported "Success" while changing nothing in the database - confirmed live, not just
  theorized**, using the two temporary diagnostics wired in for exactly this: the browser console
  log of the outgoing `saveFieldPermissions` payload (in `inspectorNativeFlsMatrix.js`'s
  `handleSaveClick`) showed a fully correct, well-formed grant list, while
  `InspectorNativeFlsMatrix.saveFieldPermissions`'s own loud error (thrown instead of silently
  skipping, echoing back the raw JSON Apex actually received) showed every grant arriving with an
  unusable `permissionSetId` - the exact same shape as Field Creator's own deploy bug (see that
  section above). `saveFieldPermissions` now takes `grantsJson`/`objectGrantsJson` as plain
  `String` parameters and parses them itself with `JSON.deserialize()`, bypassing whatever the
  automatic `List<T>` action-parameter binding was doing wrong - **confirmed fixed**: the same
  change fixed Field Creator's `deployCustomFields` outright, and for FLS Matrix it fixed the
  deserialization (the console log now shows a correct payload reaching the point of use), though
  it exposed a second, previously-hidden issue described next.

  **With the deserialization bug fixed, saves started failing loudly instead of silently - with no
  usable error message.** The `upsert`/`delete` DML for field grants wasn't wrapped in a try/catch,
  so an uncaught `DmlException` there was masked to a generic "Unknown error" by Salesforce's
  default handling of non-`AuraHandledException` exceptions from `@AuraEnabled` methods - the same
  masking behavior documented (and worked around) for `InspectorNativeRecordAccess`'s own invalid-
  record-Id case above. Now caught and re-thrown as an `AuraHandledException` carrying the real
  `DmlException` message, so whatever Salesforce is actually rejecting is visible instead of a dead
  end.

  **The real error, once visible, was `INVALID_CROSS_REFERENCE_KEY, invalid cross reference id: []`
  on the `FieldPermissions` upsert - and three successive theories about it turned out wrong before
  the actual cause surfaced.** First theory: the permission set lacked object-level Read on the same
  object (matching the user's own original hypothesis, and a real, documented Salesforce dependency
  in general) - `saveFieldPermissions` was changed to auto-grant it inline, before the field-level
  DML, in the same method. Confirmed live NOT to fix it: splitting one shared `try`/`catch` into two
  (so a failure says which statement actually threw, and echoes back the row it was trying to write)
  proved the object-level upsert succeeded every time, yet the field-level upsert immediately after
  it, in the same transaction, still failed identically. Second theory: the dependency check reads
  only already-committed state, so the object-level grant needed a genuinely separate, already-
  committed Apex transaction - the auto-grant was moved into its own `@AuraEnabled` method,
  `ensureObjectReadForFieldGrants`, called and awaited by the client *before* `saveFieldPermissions`.
  Also confirmed live NOT to fix it: the identical error persisted even with the object-level Read
  grant genuinely committed via a separate round-trip beforehand.

  **The actual cause, confirmed live via a third diagnostic** (echoing the target `PermissionSet`
  record's own `Type`/`IsOwnedByProfile`/`Label` in the error message): the permission set in
  question had `Type: "Standard"` - not `"Regular"`. Standard-type permission sets are the ones
  Salesforce auto-provisions alongside a Permission Set License (typically from an installed package
  or platform feature, e.g. an industry-cloud "persona" permission set); they're predefined by
  Salesforce and **not editable by the org at all**, via any API - not a dependency this app could
  ever satisfy or work around, however the object-level-Read grant was sequenced. `getAssignablePermissionSets`
  (`InspectorNativeFieldPermissions`, shared by FLS Matrix and Field Creator's Permissions modal)
  only ever filtered on `IsOwnedByProfile`, never on `Type`, so a Standard permission set was offered
  right alongside genuinely editable ones with no way to tell them apart until Save failed. **The
  actual fix**: that query now also filters `Type = 'Regular'`, so only permission sets this app can
  genuinely edit are ever offered in the first place - the two auto-grant methods above stay in place
  (real, working logic for a Regular permission set that genuinely lacks object-level Read yet), they
  just were never what this specific failure needed.
- **Org Chart tab** - browse the User `ManagerId` hierarchy: a "Reports To" node, the currently-
  centered user, and their Direct Reports, in the same one-hop-at-a-time, click-to-recenter
  hub-and-spoke layout Relationship Map already established in this app - applied to people instead
  of object schema. Opens on the current user by default; a search box jumps straight to anyone
  else. Direct Reports use real cursor pagination (not a client-side cap) - a manager can plausibly
  have far more direct reports than are worth fetching in one request, unlike Relationship Map's
  schema-only lists (already fully in memory either way). Entirely GraphQL - manager traversal via
  `Manager { Name { value } }` is confirmed real UI API GraphQL behavior (each parent relationship
  has a corresponding field on the GraphQL type, named after the relationship), verified directly
  against the official GraphQL API reference rather than assumed. No Apex at all - not even an
  object picker, since User is the only object this tab ever queries.

  **Inspired by, not a code port of,**
  [svierk/awesome-lwc-collection's `orgChartViewer`](https://github.com/svierk/awesome-lwc-collection/tree/main/force-app/main/default/lwc/orgChartViewer)
  (MIT licensed). That component renders a genuinely interactive, pannable/zoomable chart with PNG
  export, powered by a ~324 KB third-party static resource (d3 v7 + d3-flextree + d3-org-chart)
  loaded at runtime via `lightning/platformResourceLoader`. This repo's own convention (see the
  top-level README's "no external scripts, fully self-contained" stance) is a real fork from that -
  rather than vendor that static resource and take on this repo's first non-trivial third-party JS
  dependency, this tab is a from-scratch reimplementation in the same spirit (search, click-to-
  navigate a people hierarchy) using this app's own established patterns instead. It doesn't
  replicate the original's pan/zoom/expand-collapse canvas or PNG export - if you want that fuller
  experience, the original component is a better fit for a page that doesn't share this repo's
  no-external-scripts constraint.
- **Record Access Inspector tab** - "why can/can't user X see record Y": pick a user (the same
  server-searched picker Permissions and Groups already uses) and paste a record Id, and see their
  Read/Edit/Delete/Transfer access plus overall MaxAccessLevel. Backed by `UserRecordAccess`, the
  platform's own purpose-built object for exactly this question - read-only, with real, enforced
  query constraints: the WHERE clause must filter on a single `UserId` and a single `RecordId`, only
  `RecordId`/the `Has*Access` fields/`MaxAccessLevel` can be selected, and - confirmed the hard way,
  not documented anywhere checked beforehand - `RecordId` must be explicitly in the SELECT list too,
  even though it's already pinned to one value in the WHERE clause; leaving it out fails the whole
  query at deploy time. **A meaningful result depends on the person running this tool being able to
  see the record themselves too** - `UserRecordAccess` only reports on records visible to the
  querying context, same `with sharing` enforcement as everywhere else in this app. An empty/no-
  access result can mean either the target user genuinely has no access, or the record isn't
  visible to whoever's running the check - there's no way to tell the two apart from this object
  alone, so that ambiguity is called out directly in the tab itself rather than left as a silent gap.

The object list (Create Records, Field Creator, Schema Explorer, Relationship Map, Data Export, FLS
Matrix), the query itself (Query Records), field deployment/permissions (Field Creator), permission/
group assignment (Permissions and Groups), org info reads (Limits and Licenses), the FLS matrix bulk
read/save (FLS Matrix), and the record access read (Record Access Inspector) are the places in this
repo that aren't pure GraphQL:
- Reliably enumerating every object the running user can create records for (or, for the four
  read-oriented tabs below, every object they can query at all), with labels, needs
  `Schema.getGlobalDescribe()`, which isn't reachable client-side. `InspectorNativeObjectPicker` has
  two single, narrow, read-only, cacheable (`@AuraEnabled(cacheable=true)`) Apex methods:
  `getCreatableObjects` (Create Records, Field Creator - scoped to `isCreateable()`) and the broader
  `getQueryableObjects` (Schema Explorer, Relationship Map, Data Export, FLS Matrix - scoped to
  `isQueryable()`, since none of those four have anything to do with creating records and a
  createable-only filter would wrongly hide plenty of legitimate objects).
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
  `InspectorNativeFieldPermissions` (Field Creator's Permissions modal, additive-only) and
  `InspectorNativeFlsMatrix` (the FLS Matrix tab, the full bulk editor - can revoke, not just grant)
  both list permission sets and read/write access via ordinary SOQL and `upsert`/`delete`. Which
  fields `InspectorNativeFlsMatrix` offers comes from `Schema.DescribeFieldResult.isPermissionable()`
  - the platform's own authority on whether a field supports FLS at all.
- Assigning Permission Sets, Permission Set Groups, and Public Group membership is also plain,
  standard Apex - `PermissionSetAssignment` (which takes either `PermissionSetId` or
  `PermissionSetGroupId`, GA since Spring '20) and `GroupMember` are both normal queryable/
  DML-insertable objects, no callout needed. `InspectorNativePermissionAssignment` lists the
  assignable items, searches users, and performs the assignment.
- Reading license usage and org limits needs Apex too - `UserLicense`/`PermissionSetLicense` are
  queryable objects, and `System.OrgLimits.getMap()` is Apex-native (no SOQL involved at all).
  `InspectorNativeOrgInfo` is read-only, same low-risk category as the object list and SOQL runner.
- Reading a user's access to a specific record needs Apex too - `UserRecordAccess` isn't exposed via
  the UI API GraphQL schema, and has its own real query constraints (see "What's in it" above).
  `InspectorNativeRecordAccess` is read-only, same low-risk category as the three above.

`InspectorNativeObjectPicker`, `InspectorNativeSoqlRunner`, `InspectorNativeOrgInfo`, and
`InspectorNativeRecordAccess` are read-only and low-risk - accepted exceptions to the no-Apex
convention the rest of this repo follows, each one narrow, nothing more.
**`InspectorNativeFieldCreator`, `InspectorNativeFieldPermissions`, `InspectorNativePermissionAssignment`,
and `InspectorNativeFlsMatrix` are different in kind**: they write to org schema/security. A created
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
hide. Custom metadata records ship with every tab enabled, including **Field Creator** - it shipped
disabled for a long stretch given its then-unresolved deploy issue, and is enabled again now on a
fix believed to address it (see its own section above for the full, still slightly open story).

## Setting it up

1. Deploy this package directory (see above) - this also deploys the bundled
   **Salesforce Inspector Native** permission set.
2. Assign that permission set to whoever should use the app: Setup → Permission Sets →
   "Salesforce Inspector Native" → Manage Assignments → Add Assignment. It grants access to the app
   itself, its tab, and all eight Apex classes - **not** object or field permissions for any
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
   - Limits and Licenses, Schema Explorer, Relationship Map, Data Export, Org Chart, and Record
     Access Inspector need nothing beyond the base permission set - all six are read-only reads
     (SOQL/Apex-native for Limits and Licenses and Record Access Inspector, UI API/GraphQL for the
     other four), no special system permission required. Org Chart specifically shows whatever User
     records/fields (Name, Title, ManagerId) the running user's own FLS and sharing already lets
     them see - same as every other GraphQL-based tab in this app. Record Access Inspector's results
     are similarly bounded by the running user's own visibility into the record being checked - see
     "What's in it" above for what that means for an empty/no-access result.
   - FLS Matrix additionally needs the running user to hold **"Customize Application"** to actually
     save changes, the same platform rule Field Creator needs and for the same reason - field-level
     security is a schema-adjacent setting, consistent with why Setup's own Field-Level Security
     page itself requires admin-level access. If a user without it can't save, that's the expected
     behavior, not a bug; Save fails with a clear error rather than silently doing nothing.
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
| `inspectorNativeSchemaExplorer` | Schema Explorer tab content: object picker + a searchable field table, built from `getObjectInfo` via the pure `inspectorNativeSchemaExplorerUtils`. |
| `inspectorNativeSchemaExplorerUtils` | Pure functions: building/searching the field row list from a `getObjectInfo` response. |
| `inspectorNativeRelationshipMap` | Relationship Map tab content: object picker + the three-column parent/child relationship layout, click-to-recenter, built from `getObjectInfo` via the pure `inspectorNativeRelationshipMapUtils`. |
| `inspectorNativeRelationshipMapUtils` | Pure functions: building the parent (Reference fields)/child (`childRelationships`) lists and capping how many of each render. |
| `inspectorNativeDataExport` | Data Export tab content: object/field picker, the paginated export loop (via `inspectorNativeQueryBridge`, the same reactive-wire-to-Promise bridge `inspectorNativeRecordEntry` uses), and the CSV download. |
| `inspectorNativeDataExportUtils` | Pure functions: the field picker's option list (compound fields excluded), the paginated GraphQL export query, and extracting one page's rows. |
| `inspectorNativeFlsMatrix` | FLS Matrix tab content: object picker + the field x permission-set grid + the object-level-access header row, calling `InspectorNativeFlsMatrix` (Apex) for the initial read and the bulk save, via the pure `inspectorNativeFlsMatrixUtils`. |
| `inspectorNativeFlsMatrixUtils` | Pure functions: merging server state with in-progress unsaved edits into a renderable grid, the Edit-implies-Read field checkbox toggle logic, and the object-level-access checkbox toggle/dependency-cascade logic. |
| `inspectorNativeOrgChart` | Org Chart tab content: the search box, the Reports To/centered-user/Direct Reports hub-and-spoke layout, click-to-recenter, all built from `inspectorNativeOrgChartUtils`. Inspired by (not a port of) svierk/awesome-lwc-collection's `orgChartViewer` - see "What's in it" above. |
| `inspectorNativeOrgChartUtils` | Pure functions: building the user/manager/direct-reports/search GraphQL queries (including the escaped LIKE-search literal) and extracting rows from their responses. |
| `inspectorNativeRecordAccess` | Record Access Inspector tab content: the user search box (reusing `InspectorNativePermissionAssignment.searchUsers`), the record Id input, and the Read/Edit/Delete/Transfer + MaxAccessLevel results, via `InspectorNativeRecordAccess` (Apex). |
| `InspectorNativeRecordAccess` (Apex) | Read-only `UserRecordAccess` lookup for a given user + record Id - for the Record Access Inspector tab. See "What's in it" above for the real query constraints this had to work around. |
| `InspectorNativeObjectPicker` (Apex) | Read-only, cacheable object lists: `getCreatableObjects` (Create Records/Field Creator) and the broader `getQueryableObjects` (Schema Explorer/Relationship Map/Data Export/FLS Matrix). See "What's in it" above. |
| `InspectorNativeSoqlRunner` (Apex) | Read-only SOQL execution for Query Records. See "What's in it" above. |
| `InspectorNativeFieldCreator` (Apex) | Builds and POSTs a Tooling API `CustomField` payload per requested field, for Field Creator - writes to org schema, and the only Apex class in this app that performs an HTTP callout. See "What's in it" above (and the Remote Site Setting step in "Setting it up"). |
| `InspectorNativeFieldSpec` (Apex) | One field to create - what `InspectorNativeFieldCreator.deployCustomFields`'s `fieldSpecsJson` parameter deserializes into via `JSON.deserialize()`. A plain top-level DTO, not nested inside `InspectorNativeFieldCreator` - extracting it out of a nested inner class was one of several fixes tried for the missing-field-data bug (confirmed real in general - Apex inner classes aren't reliable as `List<T>` *parameter* types for LWC-invoked methods - but not what fixed this specific bug; see "What's in it" above for what did). No separate permission set entry needed - class access security only governs the entry-point method being invoked, not the shape of its parameters. |
| `InspectorNativeSessionId` (Visualforce page) | Internal session-ID bridge for Field Creator's Tooling API callout - just renders `{!$Api.Session_ID}`, read back via `PageReference.getContent()`. Never navigated to directly. See "What's in it" above for why `UserInfo.getSessionId()` isn't used instead. |
| `InspectorNativeFieldPermissions` (Apex) | Lists assignable permission sets (`Type = 'Regular'` only - see the FLS Matrix section above for why) and grants field-level Read/Edit access via plain SOQL/DML (no callout) - for the Permissions modal, and shared by the FLS Matrix tab too. |
| `InspectorNativeFieldPermissionGrant` (Apex) | One permission set's Read/Edit selection for a field - the parameter type for `InspectorNativeFieldPermissions.grantFieldPermissions`. Same top-level-not-nested reasoning as `InspectorNativeFieldSpec` above, applied proactively before it caused the same bug. |
| `InspectorNativePermissionAssignment` (Apex) | Lists assignable Permission Sets/Groups/Public Groups, searches users, and performs the bulk assignment (with expiration-date updates on re-run) - for the Permissions and Groups tab. See "What's in it" above. |
| `InspectorNativeOrgInfo` (Apex) | Read-only license usage and org limit reads - for the Limits and Licenses tab. See "What's in it" above. |
| `InspectorNativeFlsMatrix` (Apex) | Reads the full field x permission-set matrix plus object-level access (`getFieldPermissionMatrix`, fields filtered to `isPermissionable()`), auto-grants object-level Read where a field grant needs it and doesn't already have it (`ensureObjectReadForFieldGrants` - its own Apex transaction, called and awaited before the save below) and bulk-saves both (`saveFieldPermissions` - upserts/deletes field grants, upserts explicit object-level grants) - for the FLS Matrix tab. See "What's in it" above for the deserialization bug, the "Unknown error" masking fix, and the full misdiagnosis-then-correction story behind `INVALID_CROSS_REFERENCE_KEY` (it was never about object-level Read - it was Standard-type permission sets, now filtered out at the source in `InspectorNativeFieldPermissions`). |
| `InspectorNativeFlsGrant` (Apex) | One (field, permission set) cell's desired Read/Edit state - a parameter type for `InspectorNativeFlsMatrix.saveFieldPermissions`. Same top-level-not-nested reasoning as `InspectorNativeFieldSpec`/`InspectorNativeFieldPermissionGrant` above. |
| `InspectorNativeObjectPermissionGrant` (Apex) | One permission set's desired object-level access (Read/Create/Edit/Delete/View All/Modify All) on the FLS Matrix's object - the other parameter type for `InspectorNativeFlsMatrix.saveFieldPermissions`. Same top-level-not-nested reasoning as `InspectorNativeFlsGrant`. |
| Custom Tab / Custom Application (`Salesforce_Inspector_Native`) | App Launcher entry point. |
| Permission Set (`Salesforce_Inspector_Native`) | Grants the app, its tab, all eight Apex classes, and access to the `InspectorNativeSessionId` Visualforce page - deliberately no object/field permissions, see "Setting it up" above. |
| `inspectorNativeCsvUtils`, `inspectorNativeQueryBridge`, `inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`, `inspectorNativeMapping`, `inspectorNativeFormField` | Supporting bundles for the grid above: CSV parsing/mapping, the GraphQL query-to-Promise bridge, column/mutation-building utilities, shared toast/navigation/field-model helpers, the CSV-to-field mapping dialog, and the typed form-field renderer. Originally forked from the now-retired `multiRecordEntry` topic (see "Fully standalone" above) - self-contained now, not vendored from or kept in sync with anything outside this package. |
