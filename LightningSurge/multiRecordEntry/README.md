# Multi Record Entry

Object-agnostic bulk create/upsert for any Salesforce object, in a spreadsheet-style modal.
Field presence, grouping, required-ness, and editability come from the object's actual create-mode
page layout (respecting field-level security) — there's nothing object-specific hardcoded, and
nothing to configure per object beyond picking which layout or Record Type to use.

Everything runs on the UI API GraphQL wire adapter (`lightning/graphql`). **There is no Apex** in
this package, by design — every read and write is a client-side GraphQL query or mutation.

## What it does

- Add any number of blank rows and fill them in directly in a grid, drag-and-drop a CSV file in,
  or paste a range of cells copied from Excel/Google Sheets — all three go through the same
  column-mapping screen, which previews a few rows of the actual data being imported.
- **Upsert, not just create**: pick one or more fields to match rows against existing records by.
  A match updates the existing record; no match creates a new one. Before saving, a preview shows
  how many rows will do which.
- Choose **Partial success** (rows that fail stay in the grid with their error, everything else
  saves) or **All or nothing** (validates everything up front; stops at the first server-side
  failure rather than continuing to submit the rest — see [Save modes](#save-modes) for the exact
  guarantee this does and doesn't give you).
- **Manage Columns** to hide fields you don't need visible, particularly useful in All Fields mode
  where the column count can otherwise be unwieldy.
- Download a CSV template pre-headered with the right field API names, and export a results CSV
  after saving (original field values plus Status/Detail per row).
- Owner defaults to the current user automatically, consistent with standard Salesforce create
  forms.

## Deploying this package

This folder is a self-contained SFDX package directory — it doesn't depend on anything outside
itself. Deploy it on its own:

```bash
sf project deploy start --source-dir multiRecordEntry
```

It's also registered in the repo's `sfdx-project.json`, so `sf project deploy start` (with no
`--source-dir`) picks it up alongside the other package directories too.

## Ways to launch it

The modal itself (`graphqlMultiRecordEntry`) is `isExposed: false` — it's opened programmatically
via `LightningModal.open()`, not dropped onto a page directly. Three thin launcher components wrap
it for the three ways you'd actually want to trigger it:

### 1. Quick Action (`graphqlMultiRecordEntryAction`)

Exposed to `lightning__RecordAction`, `lightning__RecordPage`, `lightning__HomePage`, and
`lightning__AppPage`.

To wire it up as a Quick Action on an object:

1. Setup → Object Manager → *[Object]* → Buttons, Links, and Actions → New Action.
2. Action Type: **Lightning Web Component**. Lightning Web Component: **c:graphqlMultiRecordEntryAction**.
3. Add the action to the object's Lightning Record Page (or Search Layout / list view button
   layout, depending on where you want the entry point).

It figures out the object automatically from the Quick Action's own context, so no configuration
is required in the simple case. If it can't resolve the object, it shows a diagnostics panel
instead of failing silently — useful for confirming exactly what context Salesforce handed it.

### 2. List View custom button (`graphqlMultiRecordEntryPage`)

Salesforce doesn't support launching an LWC directly from a list view button, so this component is
`lightning__UrlAddressable` instead — reachable via a URL, which a custom button can point at.
Unlike a Quick Action, a list view has no single record to infer the object from, so it must be
passed explicitly as a URL parameter.

1. Setup → Object Manager → *[Object]* → Buttons, Links, and Actions → New Button or Link.
2. Display Type: **List Button**. Behavior: **Display in existing window** (either sidebar
   variant — the "without sidebar or header" recommendation from older docs isn't required; both
   work). Content Source: **URL**.
3. Formula:
   ```
   /lightning/cmp/c__graphqlMultiRecordEntryPage?c__objectApiName=Lead
   ```
   (swap `Lead` for the object this button lives on; see [Configuration](#configuration) below
   for the optional parameters).
4. Save, then add the button to the object's List View Button Layout.

Since this is a real page (not an overlay opened from an already-loaded record), it always shows a
visible **Add Records** button rather than relying purely on auto-opening the modal — the very
first paint of a page reached this way doesn't always have the Lightning Overlay Library ready yet,
so auto-open retries once and otherwise leaves something clickable instead of a blank-looking page.
Once the modal closes (saved or cancelled), it navigates to the object's list view.

### 3. Salesforce Inspector Native app (no per-object setup at all)

The [`salesforceInspectorNative`](../salesforceInspectorNative/README.md) package adds a
standalone app (App Launcher → "Salesforce Inspector Native") whose Create Records tab combines a
live object picker with a layout picker in one row — no List View button or Quick Action to
configure per object. Unlike this package's own launchers, that experience is **inline, not a
modal**: it's a fully standalone package that vendors its own copy of this grid's engine, forked
into a plain page component instead of a `LightningModal` (see that package's README for what that
means for keeping the two in sync). Unlike the other launch paths, its object list comes from a
small Apex method (the only Apex in this repo — see that package's README for why).

### 4. Programmatically, from your own LWC

```js
import GraphqlMultiRecordEntry from 'c/graphqlMultiRecordEntry';

const result = await GraphqlMultiRecordEntry.open({
  label: 'Add Records',
  size: 'large',
  objectApiName: 'Contact'
});
// result: { createdRecordIds: [...], updatedRecordIds: [...] } or null if cancelled
```

## Configuration

Both launchers expose the same object/layout options — as `@api` properties on
`graphqlMultiRecordEntryAction` (settable from Setup where the target supports the `<property>`
tag, e.g. `lightning__AppPage`) or as URL parameters on `graphqlMultiRecordEntryPage`.

| Property | URL parameter | Type | Description |
|---|---|---|---|
| `objectApiName` | `c__objectApiName` | string | The object to create/upsert records for. Required for the List View button path; inferred automatically for Quick Actions. |
| `recordTypeId` | `c__recordTypeId` | string | Use this Record Type's layout, skipping the in-modal layout picker. |
| `layoutDeveloperName` | `c__layoutDeveloperName` | string | Resolve to whichever active Record Type has this `DeveloperName`, skipping the picker. Ignored if `recordTypeId` is set. |
| `showAllFields` | `c__showAllFields=true` | boolean | Skip the picker and show every field the user can set on create, regardless of layout. |
| `requiredFieldsOnly` | `c__requiredFieldsOnly=true` | boolean | Skip the picker and show only fields the object itself requires (see [layouts vs. fields](#layouts-vs-record-types-vs-fields) below). |

If none of `recordTypeId`, `showAllFields`, `requiredFieldsOnly`, or a matching
`layoutDeveloperName` is given, the modal always opens with a **layout picker** first, letting the
user choose interactively.

`initialRowCount` (1), `maxRows` (200), and `batchSize` (50) are **not** configurable through
either launcher - they're hard-coded constants shared by both. `graphqlMultiRecordEntryPage` can
only ever be configured via URL parameters (there's no Setup property panel for a
`lightning__UrlAddressable` target), so exposing these as `@api` properties on
`graphqlMultiRecordEntryAction` alone would just be an inconsistency between the two launchers, not
a real capability gained. If a given deployment genuinely needs different values, change the
constants in both `graphqlMultiRecordEntryAction.js` and `graphqlMultiRecordEntryPage.js` (the
modal component itself still accepts them as real `@api` properties, for the programmatic
`.open()` path).

## Layouts vs. Record Types vs. fields

This is the part of the design most worth understanding before you rely on it.

Salesforce's UI API (what this package's GraphQL queries run against) can only resolve a create
layout by going *through* a Record Type — there's no way to fetch an arbitrary Page Layout by name
without Apex/Tooling API access, which this package deliberately doesn't use. That shapes what the
layout picker actually offers:

- **Default Layout** — whatever layout the org resolves for the running user with no Record Type
  specified. This is the closest a client can get to "the layout that isn't tied to a particular
  Record Type" — it is *not* a way to reach a layout that was never assigned to any Record Type at
  all; no such layout is reachable this way.
- **Each active Record Type** — its own assigned layout.
- **All Fields** — every field the user can set on create, ignoring layout entirely. Built from
  object metadata directly, not from any layout.
- **Required Only** — only the fields the object itself requires (independent of any layout's own
  required-field overrides). If a required field is part of a compound field (e.g. `LastName` is
  required, which is one piece of `Name` alongside `Salutation` and `FirstName`), all of its
  siblings are pulled in too so the compound group renders whole.

**If you have a layout that was built specifically for quick data entry but was never assigned to
any Record Type**, it isn't reachable by name — use **Required Only** (or **All Fields**) instead.
Since required fields come straight from object metadata rather than a specific layout, they're
reachable regardless of Record Type assignment.

## Importing data: CSV, or paste from Excel

**Download CSV Template** gives you a file headered with the right field API names. **Import CSV**
and **Paste from Excel** both lead to the same mapping screen (fields whose API name matches a
column/header exactly are pre-mapped) with a preview of the first few rows of whatever you're
importing, so a column can be checked against real data before committing to a mapping. Each field
offers two equivalent ways to map it: a dropdown, or dragging a column chip onto it - use whichever
is more convenient. Paste from Excel expects tab-separated data with a header row - exactly what
you get pasting a copied range of spreadsheet cells - parsed with the same quoted-field handling as
CSV import.

## Matching and upsert

Click **Match Fields** in the toolbar to pick one or more fields to match rows against existing
records by (available both in the CSV mapping screen and the grid). On save, a query finds existing
records whose values match; a hit updates that record, a miss creates a new one. Leave it empty to
always create.

Matching is find-then-decide, not a native platform upsert — it works against **any** field, not
just ones marked External ID/Unique, but two records that happen to share the same match-key
value(s) will only ever resolve to the first one found.

Once match fields are set, clicking Save shows a preview on the Save Options screen ("N will be
created, M will be updated") before anything is actually submitted, using the same lookup save
uses. It's best-effort: if the preview lookup itself fails, saving still proceeds normally without
it - the real match resolution happens again (and can fail loudly) at save time regardless.

## Column management

**Manage Columns** lets you hide fields from the grid without affecting what's actually available -
most useful in All Fields mode, where the column count can otherwise be unwieldy. Hidden fields are
simply not shown or editable; any existing value (like a default) is untouched, and the field
remains fully available in CSV/paste mapping.

## Field View vs. Table View

**Field View** (the default) shows each cell as its own typed input - a checkbox for Boolean
fields, a combobox for picklists, a record picker for lookups, and so on - with native
browser/Lightning format validation on each one.

**Table View** switches every cell to a plain, dense text box instead - closer to editing a raw
CSV, and enough narrower per column that more columns fit on screen at once. Both views edit the
exact same underlying row data, so switching back and forth never loses anything already typed. A
raw cell is parsed the same way a CSV/paste cell is (`true`/`yes`/`1` for a checkbox, a loosely
parseable date for a datetime field, and so on) - type the same kind of value you'd put in a CSV
file. **Table View trades away format validation for density**: it still catches a required field
left blank, but not a malformed value (an invalid email, an out-of-range number) - those are only
caught server-side at save time in Table View, unlike Field View where the input itself refuses an
invalid value as you type.

## Save modes

- **Partial success** — the default. Rows are submitted in batches; whatever succeeds is applied
  as each batch completes, whatever fails stays in the grid with its error so you can fix and
  retry just those rows.
- **All or nothing** — validates every field client-side before submitting anything. If a row still
  fails to save server-side (a validation rule, a duplicate rule, ...), submission stops
  immediately rather than continuing through the remaining batches. **This is not true transactional
  atomicity** — each row is still an independent DML operation under the hood, so rows from earlier
  batches that already succeeded are not rolled back. The results screen says explicitly when this
  happened and how many records were already committed.

True all-or-nothing (zero partial commits, guaranteed) isn't achievable from a GraphQL-only,
no-Apex client — it would need the Composite Graph REST API or an Apex transaction.

Results are recorded as each batch finishes, not only once every batch has been attempted - so if a
later batch fails outright (a network error, a timeout), whatever earlier batches already saved is
still reflected in the results screen instead of being silently lost (which could otherwise leave
already-created rows looking "unsaved" in the grid, risking a duplicate on retry).

## Other things worth knowing

- **Ignore layout-required fields** (checkbox next to Save): when checked, a field can only block
  saving for being genuinely required by the object itself, not because the selected layout marked
  it required for this view.
- **CSV import/export**: uses `;` as the delimiter throughout (template download, CSV import, and
  results export) — chosen because field values (addresses, formatted numbers) commonly contain
  commas but rarely semicolons. Paste from Excel uses tab, matching what a spreadsheet puts on the
  clipboard.
- **Validation errors**: shown inline next to each field, summarized in a list next to Save, and
  raised as a sticky (manually-dismissed) toast so the full "Row N: Field — message" text can be
  copied out before fixing anything.
- **Results screen**: every attempted row's outcome (Created/Updated/Failed), with successful
  record IDs as clickable links to the record. Exportable as CSV.

## Testing

Pure-logic modules (GraphQL query/mutation building, CSV parsing, the record-type-selection
decision logic, the query-wire bridge) have Jest unit tests under each module's own `__tests__/`
folder, using `@salesforce/sfdx-lwc-jest`. From the repo root:

```bash
npm install
npm run test:unit
```

## Package contents

| Component | Role |
|---|---|
| `graphqlMultiRecordEntry` | The modal itself. All the grid/CSV/matching/save orchestration lives here; the record-type-selection decision and the query-wire bridge are delegated to the two modules below. `isExposed: false` — opened via `.open()`, not placed on a page. |
| `graphqlMultiRecordEntryAction` | Quick Action / page-component launcher. |
| `graphqlMultiRecordEntryPage` | `lightning__UrlAddressable` launcher for List View buttons. |
| `graphqlMultiRecordEntryMapping` | CSV/paste-column-to-field mapping screen (dropdown or drag-and-drop, per field). |
| `graphqlMultiRecordEntryUtils` | GraphQL query/mutation string builders (upsert mutation, match query, Record Type query), result extraction, and the pure record-type-selection/column-visibility decision logic. |
| `graphqlMultiRecordEntryCsvUtils` | CSV/tab-separated parsing, template generation, results export, auto-mapping. |
| `graphqlMultiRecordEntryQueryBridge` | Plain JS class bridging the reactive `lightning/graphql` query wire (there's no imperative query executor) to an awaitable Promise. Not a component - kept as its own bundle so it's unit-testable in isolation from any wire/DOM setup. |
| `graphqlMultiRecordEntrySharedUtils` † | Toast/navigation helpers plus field-model-building utilities (layout metadata, FLS, compound fields, GraphQL value serialization). |
| `graphqlRecordFormField` † | Renders one field's input, picking the right base Lightning component per data type. |

† Vendored, not shared: `graphqlRecordFormField` is also used by unrelated LWCs elsewhere in this
repo (`force-app`), so this package keeps its own copy rather than depending on that folder.
`graphqlMultiRecordEntrySharedUtils` is this package's own consolidated replacement for what were
previously two separate vendored copies (`datatableUtils` and `graphqlRecordFormUtils`) — merged
into one file and trimmed to only the functions this package actually calls, since the copies
`force-app`'s `graphqlRecordForm`/`graphqlDatatable` need are broader. If you fix a bug in
`graphqlRecordFormField` (or in the parts of the merged utils that trace back to
`graphqlRecordFormUtils`), check whether `force-app`'s copy needs the same fix.
