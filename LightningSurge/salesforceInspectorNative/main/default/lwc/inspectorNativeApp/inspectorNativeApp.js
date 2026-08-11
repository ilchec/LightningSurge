import { graphql, gql } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { LightningElement, wire } from 'lwc';

const SETTINGS_NAV_NAME = 'settings';

// Bump this by hand alongside any deploy-worthy change - the whole point is a glance at the nav
// column confirming which build is actually running in the org, especially useful mid-debugging
// when it's not otherwise obvious whether the latest fix actually made it into a deploy.
const APP_VERSION = '0.5 (Beta)';

// One entry per toggleable tab - `developerName` matches a Salesforce_Inspector_Native_Tab__mdt
// record's DeveloperName, `name` is this component's own internal nav/content-switch key,
// `category` groups tabs into their own lightning-vertical-navigation-section (see navSections) -
// a purely client-side, hardcoded grouping, not admin-configurable like Is_Enabled__c is, since the
// ask here was "organize the nav logically", not "let admins reorganize it themselves".
//
// Schema Explorer, Relationship Map, Data Export, and Org Chart are pure UI API/GraphQL, no new
// Apex; FLS Matrix adds one narrow, callout-free Apex exception (InspectorNativeFlsMatrix) in the
// same low-risk category as InspectorNativeFieldPermissions - see salesforceInspectorNative/README.md.
const CATEGORY_DATA = 'Data';
const CATEGORY_SCHEMA = 'Schema';
const CATEGORY_USERS_SECURITY = 'Users & Security';
const CATEGORY_ORG_INFO = 'Org Info';
const CATEGORY_ORDER = [CATEGORY_DATA, CATEGORY_SCHEMA, CATEGORY_USERS_SECURITY, CATEGORY_ORG_INFO];

const TABS = [
  { name: 'createRecords', label: 'Create Records', developerName: 'Create_Records', category: CATEGORY_DATA },
  { name: 'queryRecords', label: 'Query Records', developerName: 'Query_Records', category: CATEGORY_DATA },
  { name: 'dataExport', label: 'Data Export', developerName: 'Data_Export', category: CATEGORY_DATA },
  { name: 'schemaExplorer', label: 'Schema Explorer', developerName: 'Schema_Explorer', category: CATEGORY_SCHEMA },
  { name: 'relationshipMap', label: 'Relationship Map', developerName: 'Relationship_Map', category: CATEGORY_SCHEMA },
  { name: 'fieldCreator', label: 'Field Creator', developerName: 'Field_Creator', category: CATEGORY_SCHEMA },
  { name: 'permissionsGroups', label: 'Permissions and Groups', developerName: 'Permissions_And_Groups', category: CATEGORY_USERS_SECURITY },
  { name: 'flsMatrix', label: 'FLS Matrix', developerName: 'Fls_Matrix', category: CATEGORY_USERS_SECURITY },
  { name: 'orgChart', label: 'Org Chart', developerName: 'Org_Chart', category: CATEGORY_USERS_SECURITY },
  { name: 'recordAccess', label: 'Record Access Inspector', developerName: 'Record_Access', category: CATEGORY_USERS_SECURITY },
  { name: 'limitsLicenses', label: 'Limits and Licenses', developerName: 'Limits_And_Licenses', category: CATEGORY_ORG_INFO }
];

const TAB_CONFIG_QUERY = gql`
  query {
    uiapi {
      query {
        Salesforce_Inspector_Native_Tab__mdt {
          edges {
            node {
              DeveloperName {
                value
              }
              Is_Enabled__c {
                value
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Shell for the Salesforce Inspector Native app: a vertical nav on the left (not the previous
 * horizontal tabset - more room for tab labels as more tabs get added over time), grouped into
 * Data / Schema / Users & Security / Org Info sections (see navSections) rather than one flat list -
 * with ten tabs now spanning record data, object structure, and user/permission administration,
 * a flat list had become a mixture that was hard to scan. And the active tab's content on the
 * right. Unlike the original stateless shell, this one does own state now -
 * which tabs are enabled comes from Salesforce_Inspector_Native_Tab__mdt (one record per tab, a
 * plain Is_Enabled__c checkbox), read via a GraphQL query so toggling a tab is a Setup-only change,
 * no redeploy needed. A tab whose record doesn't exist yet, or whose config failed to load,
 * defaults to visible - a missing/failed read should never silently hide a feature.
 *
 * Field Creator ships disabled by default (see the custom metadata record) - not because the tab
 * itself is broken, but because its one write path (the Tooling API field-creation callout) is,
 * as of this writing, still unresolved despite several rounds of fixes; see
 * salesforceInspectorNative/README.md for the full story. Disabling it hides a known-broken
 * feature without deleting the code, so it can be re-enabled the moment it's actually fixed.
 *
 * The "Tab Settings" nav item doesn't render its own settings UI - custom metadata records can
 * only really be edited through Setup anyway, so it just links there via NavigationMixin rather
 * than reinventing a form Setup already provides.
 * @alias InspectorNativeApp
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeApp extends NavigationMixin(LightningElement) {
  selectedTab;
  isLoadingConfig = true;
  configErrorText;
  appVersion = APP_VERSION;

  _enabledByDeveloperName = {};

  @wire(graphql, { query: TAB_CONFIG_QUERY })
  wiredTabConfig({ data, errors }) {
    this.isLoadingConfig = false;
    if (data) {
      const edges = data.uiapi.query.Salesforce_Inspector_Native_Tab__mdt.edges;
      const map = {};
      edges.forEach(({ node }) => {
        map[node.DeveloperName.value] = node.Is_Enabled__c.value;
      });
      this._enabledByDeveloperName = map;
    } else if (errors) {
      this.configErrorText = errors[0]?.message ?? 'Unknown error loading tab configuration';
    }
    this.ensureSelectedTabIsVisible();
  }

  isTabEnabled(developerName) {
    const value = this._enabledByDeveloperName[developerName];
    return value !== false;
  }

  get navItems() {
    return TABS.map((tab) => ({ ...tab, visible: this.isTabEnabled(tab.developerName) }));
  }

  get visibleNavItems() {
    return this.navItems.filter((item) => item.visible);
  }

  // Groups visibleNavItems into one lightning-vertical-navigation-section per category, in
  // CATEGORY_ORDER - a category with nothing currently visible in it (every tab in it disabled)
  // doesn't render an empty section header.
  get navSections() {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: this.visibleNavItems.filter((item) => item.category === category)
    })).filter((section) => section.items.length > 0);
  }

  // Runs once config first loads (or fails to) - picks a sensible default tab rather than leaving
  // the content area blank, and moves off a tab that turned out to be disabled.
  ensureSelectedTabIsVisible() {
    const isCurrentSelectionVisible = this.visibleNavItems.some((item) => item.name === this.selectedTab);
    if (this.selectedTab && isCurrentSelectionVisible) {
      return;
    }
    this.selectedTab = this.visibleNavItems[0]?.name ?? SETTINGS_NAV_NAME;
  }

  handleSelect(event) {
    this.selectedTab = event.detail.name;
  }

  get isCreateRecordsActive() {
    return this.selectedTab === 'createRecords';
  }

  get isQueryRecordsActive() {
    return this.selectedTab === 'queryRecords';
  }

  get isFieldCreatorActive() {
    return this.selectedTab === 'fieldCreator';
  }

  get isPermissionsGroupsActive() {
    return this.selectedTab === 'permissionsGroups';
  }

  get isLimitsLicensesActive() {
    return this.selectedTab === 'limitsLicenses';
  }

  get isSchemaExplorerActive() {
    return this.selectedTab === 'schemaExplorer';
  }

  get isRelationshipMapActive() {
    return this.selectedTab === 'relationshipMap';
  }

  get isDataExportActive() {
    return this.selectedTab === 'dataExport';
  }

  get isFlsMatrixActive() {
    return this.selectedTab === 'flsMatrix';
  }

  get isOrgChartActive() {
    return this.selectedTab === 'orgChart';
  }

  get isRecordAccessActive() {
    return this.selectedTab === 'recordAccess';
  }

  get isSettingsActive() {
    return this.selectedTab === SETTINGS_NAV_NAME;
  }

  handleOpenTabSettings() {
    this[NavigationMixin.Navigate]({
      type: 'standard__webPage',
      attributes: {
        url: '/lightning/setup/CustomMetadata/home'
      }
    });
  }
}
