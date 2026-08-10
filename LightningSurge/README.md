# Lightning Surge

A collection of independent Lightning Web Component packages for Salesforce, built around the UI
API GraphQL wire adapter (`lightning/graphql`) instead of Apex wherever possible.

Each topic — a feature or component family — lives in its own top-level folder and is
independently deployable: no topic depends on another topic's folder. That's a deliberate
constraint, not an accident: `sf project deploy start --source-dir <topic>` should always work on
its own, without pulling in unrelated components.

## Repo structure

This is a standard SFDX project (`sfdx-project.json`) with one **package directory per topic**,
each mirroring the usual `<topic>/main/default/...` metadata layout:

```
multiRecordEntry/          → main/default/lwc/...   (see multiRecordEntry/README.md)
salesforceInspectorNative/ → main/default/lwc/...   (see salesforceInspectorNative/README.md)
force-app/                  → main/default/lwc/...   (everything not yet split into its own topic)
```

### Topics

| Topic | What it is |
|---|---|
| [`multiRecordEntry`](multiRecordEntry/README.md) | Bulk create/upsert any object's records in a spreadsheet-style modal, with CSV import/export, match-key upserts, and a layout/Record Type picker. |
| [`salesforceInspectorNative`](salesforceInspectorNative/README.md) | Standalone Lightning app (App Launcher entry point), meant to grow into a home for more than one tool over time. Today it has three tabs — Create Records (a row of object/layout selectors with a forked, inline, not modal, copy of `multiRecordEntry`'s record-entry grid rendered below them, see below), Query Records, and Field Creator — independently deployable like every other topic. |

`force-app` is the original, not-yet-split package directory. It currently holds:

| Component | What it is |
|---|---|
| `graphqlDatatable` | A datatable powered by GraphQL instead of Apex, with optional search, sort, pagination, and inline editing. |
| `graphqlRecordForm` | Drop-in replacement for the standard new/edit record form, powered by GraphQL. |
| `graphqlRecordFormBody`, `graphqlRecordFormField`, `graphqlRecordFormUtils` | Internal helpers shared by `graphqlRecordForm` (`graphqlRecordFormField` is also vendored into `multiRecordEntry` — see below). |
| `graphqlMapView` | Configurable map component that plots record locations via the Google Maps API. |
| `datatableUtils` | Toast and record-navigation helpers shared across the datatable-family components. |
| `datatableExtension`, `datatableLookup`, `datatablePagination` | Supporting pieces for the datatable components (custom lookup cell type, pagination bar). |
| `dragAndDrop` | HTML Drag and Drop API usage example. |

These haven't been split into their own topic folders yet. When one of them becomes the focus of
new work, the pattern to follow is the same one `multiRecordEntry` already demonstrates (see next
section).

## Why duplication instead of a shared common package

`graphqlRecordFormField` is used by both a `force-app` component (`graphqlRecordForm`) and by
`multiRecordEntry`. Rather than factor it into a third, shared package directory that every topic
would then depend on, `multiRecordEntry` keeps its own vendored copy. That keeps every topic
deployable in complete isolation, at the cost of some duplication: a bug fix in a vendored file
needs to be applied in both places if both are still in use. The vendored copy says so in its own
doc comment.

This doesn't have to mean copying a whole file verbatim, either — `multiRecordEntry` also has its
own `graphqlMultiRecordEntrySharedUtils`, which consolidates what would otherwise have been two
more vendored copies (of `datatableUtils` and `graphqlRecordFormUtils`) into one file, trimmed down
to only the functions that package actually calls. Prefer trimming a vendored copy to what's
actually used over carrying along an entire unrelated API surface.

If a future topic needs one of these same helpers, copy (and trim) it in rather than introducing a
shared dependency between topic folders — that's the convention this repo is built around.

The duplication doesn't have to stay small, either: `salesforceInspectorNative`'s Create Records
tab needs the *entire* `multiRecordEntry` record-entry engine plus its six dependencies — CSV
utils, the query bridge, column/mutation utils, shared utils, the mapping dialog, and the
form-field renderer — so all seven bundles are vendored into `salesforceInspectorNative`, each
under its own `inspectorNative`-prefixed name (e.g. `inspectorNativeCsvUtils`,
`inspectorNativeSharedUtils`) rather than reusing `multiRecordEntry`'s bundle names, so none of
them can ever collide if both topics are ever deployed to the same org together. Six of them are
full, logically-identical duplicates of their `multiRecordEntry` originals kept in sync by hand —
unlike a deliberately-trimmed vendored copy (like `graphqlMultiRecordEntrySharedUtils` above). The
seventh — the entry component itself, `inspectorNativeRecordEntry` — was forked, not just copied:
`salesforceInspectorNative` needed it to render inline instead of as a popup modal, so it's a plain
`LightningElement` there rather than a `LightningModal`. See
[`salesforceInspectorNative/README.md`](salesforceInspectorNative/README.md) for the full
naming/forking breakdown.

## Adding a new topic

1. Create `<topicName>/main/default/lwc/` (and any other metadata folders it needs).
2. Move in the LWCs that belong exclusively to it. For any dependency also used elsewhere, copy
   (don't move) it in — trimmed to what's actually used, consolidating multiple small dependencies
   into one file where that makes sense — and leave the original where it is.
3. Copy `force-app/main/default/lwc/jsconfig.json` into the new `lwc/` folder (VS Code's LWC
   tooling expects one per `lwc` root; not deployed or git-tracked, matching the existing folders).
4. Add an entry to `sfdx-project.json`'s `packageDirectories`.
5. Add a row to the topic table above, and write `<topicName>/README.md` covering what it does and
   how to deploy/configure/use it — see `multiRecordEntry/README.md` for the level of detail
   expected.

## Deploying

Deploy a single topic:

```bash
sf project deploy start --source-dir multiRecordEntry
```

Deploy everything registered in `sfdx-project.json`:

```bash
sf project deploy start
```

## Salesforce DX basics

- [Salesforce Extensions Documentation](https://developer.salesforce.com/tools/vscode/)
- [Salesforce CLI Setup Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce DX Project Configuration](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm) (`sfdx-project.json`)
