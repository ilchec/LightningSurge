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
salesforceInspectorNative/ → main/default/lwc/...   (see salesforceInspectorNative/README.md)
relatedListReloaded/       → main/default/lwc/...   (see relatedListReloaded/README.md)
```

### Topics

| Topic | What it is |
|---|---|
| [`salesforceInspectorNative`](salesforceInspectorNative/README.md) | Standalone Lightning app (App Launcher entry point), meant to grow into a home for more than one tool over time. Today it has five tabs — Create Records (a row of object/layout selectors with an inline, not modal, record-entry grid rendered below them, see below), Query Records, Field Creator, Permissions and Groups, and Limits and Licenses — independently deployable like every other topic. |
| [`relatedListReloaded`](relatedListReloaded/README.md) | A Lightning Record Page component standing in for the standard related list - same look/behavior plus an inline Expand toggle and a filter per column. The first topic here with **zero Apex** - column config and records both come from base UI API wire adapters and `lightning/graphql`. |

> This repo used to also have a `force-app` package directory (the original, not-yet-split
> collection of GraphQL components: a datatable, a record form, a map view, and their shared
> helpers) and a `multiRecordEntry` topic (a standalone bulk create/upsert modal). Both have been
> retired now that nothing in this repo still needs them - `multiRecordEntry`'s functionality was
> fully absorbed into `salesforceInspectorNative`'s Create Records tab, and `force-app` had no
> remaining active consumers. Neither was ever a runtime dependency of another topic (every topic
> here vendors what it needs rather than depending cross-folder - see "Why duplication instead of a
> shared common package" below), so removing them didn't require touching any other topic's code -
> only the documentation that referenced them as historical/pattern sources, which has been updated
> to describe the current state directly instead.

## Why duplication instead of a shared common package

No topic here depends on another topic's folder. If a topic needs a helper that conceptually
resembles something in another topic, the convention is to **copy it in, trimmed to what's actually
used**, not to factor it into a third, shared package directory that every topic would then depend
on. That keeps every topic deployable in complete isolation, at the cost of some duplication: a bug
fix in a vendored piece of logic needs to be applied everywhere a copy of it still lives. A vendored
file should say so in its own doc comment.

`salesforceInspectorNative` is the clearest live example: its Create Records tab's record-entry
grid, CSV import, column/mutation utilities, and shared toast/navigation helpers are all its own,
self-contained bundles (`inspectorNativeRecordEntry`, `inspectorNativeCsvUtils`,
`inspectorNativeRecordEntryUtils`, `inspectorNativeSharedUtils`, and so on) - nothing here is
imported from anywhere outside the package. `inspectorNativeSharedUtils` in particular demonstrates
the "trim, don't carry the whole API surface" half of the convention: it consolidates several
narrow toast/navigation/field-model helpers into one file, holding only the functions
`salesforceInspectorNative` actually calls rather than a full generic utility library.
`relatedListReloaded`'s `reloadedListUtils` and `reloadedListPagination` follow the same shape for a
different feature - see [`relatedListReloaded/README.md`](relatedListReloaded/README.md).

If a future topic needs something that looks similar to logic already living in one of these
packages, copy (and trim) it in rather than introducing a shared dependency between topic folders -
that's the convention this repo is built around, and it's what keeps
`sf project deploy start --source-dir <topic>` reliably working on its own for every topic, with no
risk of a topic quietly breaking because some other, unrelated topic changed.

## Adding a new topic

1. Create `<topicName>/main/default/lwc/` (and any other metadata folders it needs).
2. Move in the LWCs that belong exclusively to it. For any dependency also used elsewhere, copy
   (don't move) it in — trimmed to what's actually used, consolidating multiple small dependencies
   into one file where that makes sense — and leave the original where it is.
3. Copy an existing topic's `main/default/lwc/jsconfig.json` (e.g.
   `salesforceInspectorNative/main/default/lwc/jsconfig.json`) into the new `lwc/` folder (VS Code's
   LWC tooling expects one per `lwc` root; not deployed or git-tracked, matching the existing
   folders).
4. Add an entry to `sfdx-project.json`'s `packageDirectories`.
5. Add a row to the topic table above, and write `<topicName>/README.md` covering what it does and
   how to deploy/configure/use it — see `salesforceInspectorNative/README.md` for the level of
   detail expected.

## Deploying

Deploy a single topic:

```bash
sf project deploy start --source-dir salesforceInspectorNative
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
