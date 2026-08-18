<img width="1376" height="768" alt="Gemini_Generated_Image_cr7p8zcr7p8zcr7p" src="https://github.com/user-attachments/assets/37c4f72c-890c-45c7-90b2-311028304c6c" />

# Salesforce Inspector Native

A standalone Lightning app, reached via the App Launcher, bundling admin/developer tools built
around the UI API GraphQL wire adapter (`lightning/graphql`) instead of Apex wherever possible. It
has sixteen tabs, grouped into four sections on a vertical nav on the left:

- **Data** - Create Records, Query Records, Data Export, Data Masking
- **Schema** - Schema Explorer, Relationship Map, Field Creator, Picklist Manager, Impact Analysis,
  Translation Finder
- **Users & Security** - Permissions and Groups, FLS Matrix, Org Chart, Record Access Inspector, User
  Comparison
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
- **Picklist Manager tab** - pick an object, then a custom picklist field on it, and view every
  value (active and inactive), add new ones, activate/deactivate existing ones, rename them, and
  reorder them (Move Up/Down, one adjacent swap at a time - not free drag-and-drop) - instead of
  hunting through Setup's per-object Field-Level detail page. Same Tooling API callout shape as
  Field Creator (GET the field's full metadata, PATCH the whole definition back - the Tooling API
  doesn't support a partial update); reordering has no server-side concept of its own, since Save
  already always sends the complete value list in whatever order it's currently in. Scoped to custom
  picklist fields only - a standard field's picklist, or a custom field built on a shared Global
  Value Set, lives in a differently-shaped Tooling object this tool doesn't support yet, and
  surfaces as a clear error rather than a confusing parse failure. A value's "default" flag is shown
  but not editable here - changing which value defaults is a more consequential, separate action.

  **"Rename" edits a value's Label only - the Value column itself is never editable once a row
  exists.** Confirmed via research that this is the real, safe distinction Salesforce itself draws:
  renaming (the label) leaves every existing record pointing at the same underlying value,
  unaffected - only what's displayed changes. Changing the underlying value itself is a different,
  much riskier operation the API doesn't auto-migrate existing records for (unlike Setup's own
  "Replace" flow, which runs as a background job specifically to handle that migration) - not
  offered here, on either new or existing rows, to keep the mental model simple and avoid two
  different code paths for "how a value gets its Value."

  **Saving (any edit, first confirmed on a reorder) could fail with "Cannot deserialize instance of
  complexvalue from VALUE_NULL..." - confirmed live and fixed.** Saving works by re-fetching a
  field's full Tooling API metadata and PATCHing the whole thing back with only the value list
  swapped out (see below) - but a GET response routinely includes fields with an explicit JSON
  `null` for anything not applicable to a plain Picklist field (length, precision, scale, and the
  like), and the PATCH deserializer rejects an explicit null for at least one of those same fields
  rather than accepting it back the way GET produced it. This is a known category of Tooling API
  round-trip gotcha (a similar case is documented elsewhere: a value set's own `valueSettings` needs
  an explicit `[]` instead of `null` on PATCH) - the fix recursively drops every null-valued key
  from the metadata before sending it, the general-purpose version of that same fix, rather than
  chasing down and special-casing the one specific field that happened to trigger this error.

  **No "Delete Value" action, in-tool or link-out** - confirmed via research that the Tooling/
  Metadata API can't actually delete a picklist value at all, only deactivate one (already offered
  via the Active toggle above). A real delete, optionally migrating existing records to a
  replacement value, is a Setup-UI-only action that runs as an async background job with an email
  notification when it finishes - nothing about that flow is exposed through the API. A link-out to
  Setup's own field page was tried as a middle ground, but confirmed live not to work reliably
  either, and was removed rather than kept as a broken button. Deactivating a value remains the
  supported way to stop it from being selected going forward.

  **A live report showed the Value/Label column blank for every row, while Active correctly
  reflected each row's real state - confirmed and fixed.** `isActive`/`default` were the right JSON
  keys coming back from the Tooling API's GET response, but `fullName`/`label` (the key names
  documented for the Metadata API's *create*-payload `CustomValue` type, e.g. what
  `InspectorNativeFieldCreator` itself uses when creating a new picklist field) weren't - a
  temporary diagnostic confirmed the real key is `valueName`. The Tooling API's own JSON wire format
  for a CustomField's inline value set genuinely differs from the Metadata API's create-payload
  field names; it isn't the same schema reused both ways, as originally assumed. Also confirmed
  live: a value's `isActive` can come back as JSON `null` rather than an explicit `true`/`false`
  (matching `CustomValue`'s own documented default of active-unless-said-otherwise) - handled by
  treating a null the same as active, not failing closed.
- **Impact Analysis tab** - "what references this custom field/object" - Flows, Apex classes,
  layouts, and more, via Salesforce's own Dependency API. Pick an object, then either a custom field
  or toggle to analyze the whole object, and see every referencing component grouped by type.
  Results are real but not exhaustive, always shown with a persistent caveat banner: Reports aren't
  included at all, results are capped at 2,000 references, and Flow references are shown less
  completely than Apex/formula references - an empty result means nothing was *found*, not a
  guarantee that nothing depends on it. Scoped to custom fields/objects only, same reasoning as
  Picklist Manager above. Read-only (no DML anywhere in this tool), but still needs a Tooling API
  callout to work at all - `MetadataComponentDependency` isn't queryable through plain Apex SOQL,
  confirmed via research before building this, so it's a different risk tier than this app's other
  read-only tools even though nothing here ever writes anything.
- **Translation Finder tab** - type text and see every place in the org's metadata it could be,
  grouped by type: Custom Label, Object, Field (label *or* help text - shown as separate matches so
  it's clear which one matched), and Picklist Value. Solves a specific Translation Workbench
  annoyance: that tool makes you already know exactly what you're translating (Setup Component =
  Custom Label, or Custom Field, or Picklist Value, etc.) before it'll show you anything - this tab
  is the opposite, a free-text lookup so you can tell it a piece of text and see what it might be, no
  prior knowledge needed. Object and Field matches are scoped to custom (`__c`) API names only -
  Translation Workbench only lets you translate custom object labels and custom field labels/help
  text, not standard ones (Salesforce ships those translations itself). **Picklist Value matches are
  not scoped to custom fields** - Translation Workbench also lets you translate picklist values on
  standard fields (e.g. `Opportunity.StageName`'s own values), a different scope than Picklist
  Manager's own edit-scope above (that one is about what the Tooling API can safely PATCH, not what
  Translation Workbench can translate).

  Each result links somewhere useful, though not identically - there's no way to deep-link straight
  into a specific item's own Translation Workbench entry (it's a picker-based Setup UI: you land on
  the screen, then pick Setup Component/object/field/language yourself). **Custom Label** results
  link to that label's own Setup detail page via its raw record Id (`/{id}`, universal Salesforce
  record routing, not a guessed page name) - that page has its own per-language **Override** related
  list, so a translation goes in right there, no separate wizard needed. **Object** results link to
  that object's own Setup detail page, the same link-out Schema Explorer already offers.
  **Field/Picklist Value** results link straight to Translation Workbench's **Translate** screen
  (`/lightning/setup/LabelWorkbenchTranslate/home`) rather than the field's Setup detail page, since
  Setup detail pages don't have anything translation-related on them at all - not deep-linked to that
  specific field, but the right screen instead of making you hunt for it via Setup's own Quick Find.

  Custom Labels are found via the same Tooling API `ExternalString` HTTP callout shape Field
  Creator/Picklist Manager/Impact Analysis already use (own-domain, `InspectorNativeSessionId`
  session bridge, no Remote Site Setting) - they're the one thing here not reachable through a plain
  Schema describe. Everything else (Object/Field/Picklist Value matches) comes from a live
  `Schema.getGlobalDescribe()` scan with no callout at all, the same mechanism
  `InspectorNativeObjectPicker` already uses to list objects. That scan runs across every custom
  object/field in the org on every search - real but not necessarily fast in a very large org with
  several managed packages installed, called out with a persistent caveat banner. **Results are
  capped at 100**, with the scan exiting as soon as the cap is hit. Requires at least 2 characters
  before searching at all.
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
- **Data Masking tab** - overwrite a small, fixed set of built-in fake values (name/email/phone/
  generic text) across a chosen object's records - for scrubbing a sandbox before handing it to a
  vendor or QA, without Data Loader. No new Apex at all: reuses `InspectorNativeSoqlRunner` (the
  same read path Query Records already uses) for the read, and this app's existing GraphQL mutation
  builders (the same ones Query Records already trusts to save edited rows) for the write. **Preview-
  then-apply, not a silent overwrite** - Preview runs the read and generates the replacement values
  without touching anything; Apply is the only step that writes, and shows exactly what changed per
  record afterward. Field picker is restricted to updateable text/email/phone fields - a formula,
  picklist, or system field either can't be written to or would need a type-appropriate generator
  this tool doesn't offer, so neither is ever offered as a masking target. Row count is capped at
  200 - a write operation, not a read one, kept deliberately more modest than Data Export's much
  higher read-only cap.

  **An optional filter narrows which records get read (and therefore masked) in the first place** -
  pick any field on the object (not just the ones being masked - the point is usually to scope by
  something you're *not* masking, e.g. an environment/status flag), an operator ("Equals," or
  "Contains" for text-ish types only), and a value; multiple filters are ANDed together, no OR or
  grouping. This is the first place in this package that builds raw SOQL text with a *user-typed*
  value interpolated into it, rather than only field/object API names off constrained dropdowns -
  a real SOQL-injection-relevant spot, handled with proper single-quote/backslash escaping (and,
  for "Contains," escaping LIKE's own `%`/`_` wildcards too so a literal percent sign or underscore
  in the search text is matched literally). Boolean/numeric/Date values are formatted as unquoted
  SOQL literals per their type, not quoted strings, since SOQL requires that distinction - and since
  an unquoted literal can't lean on the same quote-escaping every other type gets, a Date value is
  independently re-validated against a strict `YYYY-MM-DD` shape (falling back to the always-safe
  `null` literal otherwise) rather than trusted just because the date picker UI normally produces
  that shape. A handful of field types (DateTime, compound types like Address/Location, encrypted
  fields, multi-select picklists) aren't offered as filter fields at all - this tool doesn't have a
  correct SOQL literal form for them.
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
- **User Comparison tab** - pick two users (the same server-searched picker Permissions and Groups/
  Record Access Inspector use) and see them side by side, grouped into six categories: Basic
  Settings (Username, Email, Alias, Title, Department, Division, Active, User Type, Time Zone,
  Locale, Language), Profile & Role (Profile, Role, Manager), Permission Sets, Permission Set Groups,
  Public Groups, and Queues. Basic Settings/Profile & Role show each user's actual value side by
  side; the other four instead render one row per distinct item across both users with a checkbox
  per side (checked = that user has it) - a checkbox column instead of repeating the item's own
  name, which is already the row's label, left-aligned under its header the same way FLS Matrix's
  own per-cell checkboxes are (not centered - a checkbox is far narrower than the column its header
  name drives, so centering it drifts it away from that header once the column is wider than either
  needs). Either way, a row where the two sides differ is visually highlighted. Every category's
  table shares the same minimum column widths, so the Item/User A/User B columns line up at the same
  position from one category's table to the next, not just within a single one. A **Show All / Show
  Only Different** toggle controls the view - defaults to different only, per category (a category
  that's fully identical simply doesn't render at all while "different only" is selected).

  Basic Settings/Profile & Role come from two independent, single-`eq`-match GraphQL queries (one per
  selected user), the same query shape Org Chart's `Manager { Name { value } }` traversal already
  proved out - `Profile { Name { value } }`/`UserRole { Name { value } }` traversal is a reasonable,
  low-risk extension of that same proven mechanism, but hasn't been used anywhere else in this repo
  before, so it's the one piece of this tab most worth confirming on first live use. Permission Sets/
  Permission Set Groups/Public Groups/Queues come from `InspectorNativeUserComparison.
  getUserAssignments` (Apex, read-only, no DML) - this repo has only ever queried
  `PermissionSetAssignment`/`GroupMember` via plain Apex SOQL (never GraphQL), so that's the path
  reused here too rather than an unverified GraphQL-exposure gamble. Public Group/Queue membership
  both come from the same `GroupMember` query, split by `Group.Type` (`Regular` vs `Queue`) - the
  same scoping Permissions and Groups' own assignable-items list already uses for Public Groups.
  Role-type groups are excluded since Role already has its own dedicated comparison row. Unlike FLS
  Matrix/Picklist Manager (editors, which only ever offer `Type = 'Regular'` permission sets - the
  only ones actually editable), this is read-only reporting: every permission set a user directly
  has is shown, Standard/package-provided ones included, since the point is visibility into
  everything assigned, not what's safe to edit.

## Where Apex is used

Everything above is UI API/GraphQL except: the object list, running SOQL, field deployment/
permissions, permission/group assignment, org info reads, the FLS matrix, the record access read,
picklist value management, dependency analysis, the User Comparison tab's Permission Set/Group/
Public Group/Queue reads, and the Translation Finder search. Each has a narrow, single-purpose Apex
class behind it:

- `InspectorNativeObjectPicker` - `getCreatableObjects` (Create Records, Field Creator) and
  `getQueryableObjects` (Schema Explorer, Relationship Map, Data Export, Data Masking, FLS Matrix,
  Picklist Manager, Impact Analysis). Read-only, cacheable - `Schema.getGlobalDescribe()` isn't
  reachable client-side.
- `InspectorNativeSoqlRunner` - runs an arbitrary SOQL query via `Database.query(soql,
  AccessLevel.USER_MODE)`, the modern way to enforce the running user's own CRUD/FLS/sharing on a
  dynamic query. Read-only - `Database.query` can only ever execute a SELECT. Used directly by Query
  Records, and reused as-is by Data Masking's own read step (a plain `SELECT` it builds client-side).
- `InspectorNativeFieldCreator` - builds and POSTs a Tooling API `CustomField` payload per
  requested field.
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
- `InspectorNativePicklistManager` - GETs then PATCHes a custom picklist field's full Tooling API
  metadata to add/activate/deactivate its values. Same own-domain HTTP callout shape as
  `InspectorNativeFieldCreator`.
- `InspectorNativeDependencyAnalysis` - queries the Tooling API's Dependency API
  (`MetadataComponentDependency`) for what references a custom field/object. Read-only (no DML
  anywhere in this class), but still needs the same Tooling API HTTP callout as the two classes
  above - confirmed via research that `MetadataComponentDependency` isn't queryable through plain
  Apex SOQL at all, only through the Tooling API's own REST query endpoint.
- `InspectorNativeUserComparison` - reads a user's directly-assigned Permission Sets, Permission Set
  Groups, Public Group membership, and Queue membership (`PermissionSetAssignment`/`GroupMember`,
  plain SOQL) for the User Comparison tab. Read-only, `with sharing`, no DML anywhere - same
  low-risk tier as `InspectorNativeOrgInfo`/`InspectorNativeRecordAccess`.
- `InspectorNativeTranslationSearch` - `search` for the Translation Finder tab. Custom Label matches
  come from the Tooling API's `ExternalString` object over the same HTTP callout shape as
  `InspectorNativeDependencyAnalysis`; Object/Field/Picklist Value matches come from a live
  `Schema.getGlobalDescribe()` scan needing no callout at all, the same mechanism
  `InspectorNativeObjectPicker` uses. Read-only, no DML anywhere - but the Custom Label half's
  callout puts the whole class in the callout risk tier below, not the zero-callout one.

Four classes here genuinely need the Tooling API callout (`InspectorNativeFieldCreator`,
`InspectorNativePicklistManager`, `InspectorNativeDependencyAnalysis`,
`InspectorNativeTranslationSearch`) - all reuse the same `InspectorNativeSessionId` Visualforce
session bridge and own-domain endpoint, no Remote Site Setting needed for any of them.
`InspectorNativeObjectPicker`, `InspectorNativeSoqlRunner`, `InspectorNativeOrgInfo`,
`InspectorNativeRecordAccess`, and `InspectorNativeUserComparison` are read-only, low-risk
exceptions to the no-Apex convention the rest of this repo follows.
`InspectorNativeDependencyAnalysis`/`InspectorNativeTranslationSearch` are also read-only (no DML),
but not the same zero-callout risk tier as those five - they make a real HTTP callout, even though
neither ever writes anything. `InspectorNativeFieldCreator`,
`InspectorNativeFieldPermissions`, `InspectorNativePermissionAssignment`, `InspectorNativeFlsMatrix`,
and `InspectorNativePicklistManager` write to org schema/security instead - a created field, a
permission grant, a group assignment, or an edited picklist value list all persist until someone
explicitly reverses them, so these are worth granting access to (see "Setting it up") with more
care than the read-only ones.

## Tab visibility

Which tabs show up in the left-hand nav is controlled by `Salesforce_Inspector_Native_Tab__mdt`, a
custom metadata type with one record per tab and a single `Is_Enabled__c` checkbox.
`inspectorNativeApp` reads it via a plain GraphQL query on load - no Apex involved. All sixteen
tabs ship enabled by default.

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
     single-purpose UI feature. Data Masking's own read step reuses that same access (it builds a
     plain `SELECT` against whatever object/fields you pick), and its write step needs nothing beyond
     the target fields' own Edit/FLS access the assigned user already has - same as any other data
     write in this app, no extra system permission.
   - Field Creator (both creating fields and its Permissions modal) and Picklist Manager both
     additionally need the running user to hold the org-level **"Customize Application"** system
     permission - a Salesforce platform rule for any schema change, which this permission set cannot
     grant. No Remote Site Setting or other manual Setup step is needed for either one's Tooling API
     callout - both target the org's own domain, which doesn't require pre-authorization.
   - Permissions and Groups needs **"Assign Permission Sets"** (for the Permission Set/Group half)
     and **"Manage Public Groups"** (for the Public Group half). A user missing one can still use the
     tab for the half they do have rights to.
   - FLS Matrix additionally needs **"Customize Application"** to save changes - the same rule Field
     Creator/Picklist Manager need, since field-level security is a schema-adjacent setting.
   - Limits and Licenses, Schema Explorer, Relationship Map, Data Export, Org Chart, Record Access
     Inspector, User Comparison, Impact Analysis, and Translation Finder need nothing beyond the base
     permission set - all nine are read-only. Impact Analysis and Translation Finder both make a
     Tooling API callout like Field Creator/Picklist Manager do, but since neither ever writes
     anything, the "Customize Application" rule above doesn't apply to either.
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
| `inspectorNativeUserComparison` | User Comparison tab content: two user pickers (reusing `InspectorNativePermissionAssignment.searchUsers`) + the Show All/Different Only toggle + one table per category, via `inspectorNativeUserComparisonUtils` and `InspectorNativeUserComparison` (Apex). |
| `inspectorNativeUserComparisonUtils` | Pure functions: building each user's GraphQL comparison query, flattening its response, building field-diff and set-diff rows, and filtering to differences only. |
| `inspectorNativeDataMasking` | Data Masking tab content: object/field picker + optional filter builder + preview-then-apply flow, via `inspectorNativeDataMaskingUtils`. Calls `InspectorNativeSoqlRunner` (read) and `inspectorNativeRecordEntryUtils`'s mutation builders (write) directly - no Apex class of its own. |
| `inspectorNativeDataMaskingUtils` | Pure functions: eligible-field filtering, the masking read query, the fake-value generators, and building the preview/mutation row shapes `inspectorNativeRecordEntryUtils`'s mutation builders expect. |
| `inspectorNativePicklistManager` | Picklist Manager tab content: object/picklist-field picker + the value table (view/add/activate/deactivate/rename/reorder), via `inspectorNativePicklistManagerUtils`, calling `InspectorNativePicklistManager` (Apex) for the Tooling API read and save. |
| `inspectorNativePicklistManagerUtils` | Pure functions: filtering custom picklist fields, duplicate-value checks, and value list edits (toggle active, append new). |
| `inspectorNativeDependencyAnalysis` | Impact Analysis tab content: object/field picker + whole-object toggle + grouped dependency results, via `inspectorNativeDependencyAnalysisUtils`, calling `InspectorNativeDependencyAnalysis` (Apex) for the Tooling API Dependency API read. |
| `inspectorNativeDependencyAnalysisUtils` | Pure functions: filtering custom fields and grouping dependency results by referencing component type. |
| `inspectorNativeTranslationSearch` | Translation Finder tab content: a single search box + grouped results, via `inspectorNativeTranslationSearchUtils`, calling `InspectorNativeTranslationSearch` (Apex) for the Custom Label Tooling API callout and the describe-based Object/Field/Picklist Value scan. |
| `inspectorNativeTranslationSearchUtils` | Pure functions: grouping search results by item type and building each result's View in Setup link. |
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
| `InspectorNativePicklistManager` (Apex) | GETs then PATCHes a custom picklist field's full Tooling API metadata to add/activate/deactivate its values (`getPicklistValues`, `savePicklistValues`) - for the Picklist Manager tab. Same Tooling API callout shape as `InspectorNativeFieldCreator`, reusing the same `InspectorNativeSessionId` session bridge. |
| `InspectorNativeDependencyAnalysis` (Apex) | Queries the Tooling API's Dependency API for what references a custom field/object (`getFieldReferences`, `getObjectReferences`) - for the Impact Analysis tab. Read-only, but still needs the Tooling API callout - `MetadataComponentDependency` isn't queryable through plain Apex SOQL. |
| `InspectorNativeTranslationSearch` (Apex) | Free-text lookup across Custom Labels (Tooling API `ExternalString` callout), and Objects/Fields/Picklist Values (`Schema.getGlobalDescribe()` scan, no callout) (`search`) - for the Translation Finder tab. Read-only, results capped at 100. |
| `InspectorNativeUserComparison` (Apex) | Reads a user's directly-assigned Permission Sets, Permission Set Groups, Public Group membership, and Queue membership (`getUserAssignments`) - for the User Comparison tab. Read-only, no DML. |
| Custom Tab / Custom Application (`Salesforce_Inspector_Native`) | App Launcher entry point. |
| Permission Set (`Salesforce_Inspector_Native`) | Grants the app, its tab, all Apex classes, and access to the `InspectorNativeSessionId` Visualforce page - deliberately no object/field permissions, see "Setting it up" above. |
| `inspectorNativeCsvUtils`, `inspectorNativeQueryBridge`, `inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`, `inspectorNativeMapping`, `inspectorNativeFormField` | Supporting bundles for the grid: CSV parsing/mapping, the GraphQL query-to-Promise bridge, column/mutation-building utilities, shared toast/navigation/field-model helpers, the CSV-to-field mapping dialog, and the typed form-field renderer. |
