<img width="1584" height="672" alt="Gemini_Generated_Image_te24a5te24a5te24" src="https://github.com/user-attachments/assets/9d138cc9-4a43-440a-821f-5dfee8b8b8bb" />

# Lightning Surge

A collection of independent Lightning Web Component packages for Salesforce, built around the UI
API GraphQL wire adapter (`lightning/graphql`) instead of Apex wherever possible.

## Who this is for

Built for **enterprise users on managed, locked-down devices** - the kind of environment where
installing Data Loader or a browser extension like Salesforce Inspector Reloaded isn't an option at
all, whether that's IT policy, a lack of local admin rights, or a browser extension allowlist that
doesn't include it. Every tool here runs entirely as Salesforce metadata deployed straight into the
org - a Lightning app (`salesforceInspectorNative`) launched from the App Launcher like any other
tab, or a Lightning page component (`relatedListReloaded`) dropped onto a record page in App
Builder. Nothing to install locally, nothing running outside Salesforce's own domain, nothing that
needs local admin rights or an approved-extensions list to get through - nothing to explain to IT
beyond "this is a deployed managed component," the same conversation as any other custom Lightning
page or app.

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
| [`salesforceInspectorNative`](salesforceInspectorNative/README.md) | Standalone Lightning app (App Launcher entry point) bundling eleven admin/developer tabs — record data (Create Records, Query Records, Data Export), schema (Schema Explorer, Relationship Map, Field Creator), and users/security (Permissions and Groups, FLS Matrix, Org Chart, Record Access Inspector), plus Limits and Licenses — independently deployable like every other topic. |
| [`relatedListReloaded`](relatedListReloaded/README.md) | A Lightning Record Page component standing in for the standard related list - same look/behavior plus an inline Expand toggle and a filter per column. The first topic here with **zero Apex** - column config and records both come from base UI API wire adapters and `lightning/graphql`. |

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
imported from anywhere outside the package. `relatedListReloaded`'s `reloadedListUtils` and
`reloadedListPagination` follow the same shape for a different feature - see
[`relatedListReloaded/README.md`](relatedListReloaded/README.md).

If a future topic needs something that looks similar to logic already living in one of these
packages, copy (and trim) it in rather than introducing a shared dependency between topic folders -
that's the convention this repo is built around, and it's what keeps
`sf project deploy start --source-dir <topic>` reliably working on its own for every topic, with no
risk of a topic quietly breaking because some other, unrelated topic changed.

## Adding a new topic

1. Create a feature branch for your topic, named `feature/topic-name`.
2. Create `<topicName>/main/default/lwc/` (and any other metadata folders it needs).
3. Move in the LWCs that belong exclusively to it. For any dependency also used elsewhere, copy
   (don't move) it in — trimmed to what's actually used, consolidating multiple small dependencies
   into one file where that makes sense — and leave the original where it is.
4. Copy an existing topic's `main/default/lwc/jsconfig.json` (e.g.
   `salesforceInspectorNative/main/default/lwc/jsconfig.json`) into the new `lwc/` folder (VS Code's
   LWC tooling expects one per `lwc` root; not deployed or git-tracked, matching the existing
   folders).
5. Add an entry to `sfdx-project.json`'s `packageDirectories`.
6. Add a row to the topic table above, and write `<topicName>/README.md` covering what it does and
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

Requires the Salesforce CLI (`sf`) authenticated against the target org (`sf org login web
--alias myorg`, then `--target-org myorg` on the deploy command, or `sf config set
target-org=myorg` to avoid repeating it). See "Salesforce DX basics" below if the CLI itself isn't
set up yet.

### Salesforce Inspector Native

1. Deploy the package:
   ```bash
   sf project deploy start --source-dir salesforceInspectorNative
   ```
   This also deploys its bundled **Salesforce Inspector Native** permission set.
2. Assign that permission set to whoever should use the app: Setup → Permission Sets →
   "Salesforce Inspector Native" → Manage Assignments → Add Assignment. A few tabs (Field Creator,
   FLS Matrix) additionally need the assigned user to hold the org-level "Customize Application"
   system permission - a real Salesforce platform rule, not this app's own restriction. Full
   permission-by-tab breakdown is in
   [`salesforceInspectorNative/README.md`](salesforceInspectorNative/README.md#setting-it-up).
3. App Launcher → search "Salesforce Inspector Native".

### Related List Reloaded

1. Deploy the package (no permission set, no Remote Site Setting, no extra system permission - see
   [`relatedListReloaded/README.md`](relatedListReloaded/README.md#setting-it-up) for why):
   ```bash
   sf project deploy start --source-dir relatedListReloaded
   ```
2. Lightning App Builder → open the record page you want it on → drag **Related List Reloaded**
   from the component palette onto the page.
3. Set its **Relationship API Name** property to the child relationship to show (e.g. `Contacts`,
   `Opportunities`, or a custom relationship name ending in `__r`) - the same thing you'd type
   configuring the standard "Related List - Single" component. Optionally adjust **Rows Shown When
   Collapsed** (default 4).
4. Save and activate the page.

## Salesforce DX basics

- [Salesforce Extensions Documentation](https://developer.salesforce.com/tools/vscode/)
- [Salesforce CLI Setup Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce DX Project Configuration](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm) (`sfdx-project.json`)
