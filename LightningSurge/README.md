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
| [`salesforceInspectorNative`](salesforceInspectorNative/README.md) | Standalone Lightning app (App Launcher entry point), meant to grow into a home for more than one tool over time. Today it has five tabs — Create Records (a row of object/layout selectors with an inline, not modal, record-entry grid rendered below them, see below), Query Records, Field Creator, Permissions and Groups, and Limits and Licenses — independently deployable like every other topic. |
| [`relatedListReloaded`](relatedListReloaded/README.md) | A Lightning Record Page component standing in for the standard related list - same look/behavior plus an inline Expand toggle and a filter per column. The first topic here with **zero Apex** - column config and records both come from base UI API wire adapters and `lightning/graphql`. |

## Adding a new topic

1. Create a feature branch for your topic, name it "feature/topic-name"
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
   "Salesforce Inspector Native" → Manage Assignments → Add Assignment.
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
