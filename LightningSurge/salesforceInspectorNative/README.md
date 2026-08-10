# Salesforce Inspector Native

A standalone Lightning app, reached via the App Launcher, meant to grow into a home for more than
one admin/developer tool over time. Today it has one tab.

## Requires `multiRecordEntry` to also be deployed

This package is **not** independently deployable the way every other topic in this repo is. Its
Create Records tab opens `graphqlMultiRecordEntry` directly (`import GraphqlMultiRecordEntry from
'c/graphqlMultiRecordEntry'`) rather than vendoring a copy of it - that component is a ~9-bundle
subsystem (the modal plus its CSV/mapping/utils/query-bridge/record-form-field dependencies), and
duplicating all of that doesn't fit this repo's usual vendoring philosophy of trimming small,
genuinely shared pieces (see `multiRecordEntrySharedUtils`'s own doc comment for that philosophy,
in `multiRecordEntry/README.md`). Deploy both:

```bash
sf project deploy start --source-dir multiRecordEntry --source-dir salesforceInspectorNative
```

## What's in it

- **Create Records tab** - pick any object you can create records for from a live, permission-aware
  list, and it opens the same bulk create/upsert modal documented in
  [`multiRecordEntry/README.md`](../multiRecordEntry/README.md). After the modal closes, you land
  on that object's list view.

The object list is the one place in this repo that isn't pure GraphQL: reliably enumerating every
object the running user can create records for, with labels, needs `Schema.getGlobalDescribe()`,
which isn't reachable client-side. `SalesforceInspectorNativeObjectPickerController` is a single,
narrow, read-only, cacheable (`@AuraEnabled(cacheable=true)`) Apex method - a deliberate, accepted
exception to the no-Apex convention the rest of this repo follows, not a departure from it.

## Setting it up

1. Deploy both package directories (see above).
2. The Custom Tab and Custom Application are metadata-only - like any new tab, they aren't visible
   to anyone until a profile or permission set grants tab visibility. Setup → Profiles (or
   Permission Sets) → find "Salesforce Inspector Native" under Tab Settings → set to Default On (or
   assign a permission set that does).
3. App Launcher → search "Salesforce Inspector Native".

## Package contents

| Component | Role |
|---|---|
| `salesforceInspectorNativeApp` | Shell/tabset, exposed as the app's Custom Tab (`lightning__Tab`). Owns no feature state - each tab is self-contained. |
| `salesforceInspectorNativeCreateRecords` | Create Records tab content: the object picker and the `graphqlMultiRecordEntry` launch logic. |
| `SalesforceInspectorNativeObjectPickerController` (Apex) | Read-only, cacheable object list for the picker. The only Apex in this repo - see above. |
| Custom Tab / Custom Application (`Salesforce_Inspector_Native`) | App Launcher entry point. |
