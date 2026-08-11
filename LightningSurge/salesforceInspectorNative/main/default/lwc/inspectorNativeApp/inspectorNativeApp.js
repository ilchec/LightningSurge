import { graphql, gql } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { LightningElement, wire } from 'lwc';

const SETTINGS_NAV_NAME = 'settings';

// One entry per toggleable tab - `developerName` matches a Salesforce_Inspector_Native_Tab__mdt
// record's DeveloperName, `name` is this component's own internal nav/content-switch key.
const TABS = [
  { name: 'createRecords', label: 'Create Records', developerName: 'Create_Records' },
  { name: 'queryRecords', label: 'Query Records', developerName: 'Query_Records' },
  { name: 'fieldCreator', label: 'Field Creator', developerName: 'Field_Creator' },
  { name: 'permissionsGroups', label: 'Permissions and Groups', developerName: 'Permissions_And_Groups' },
  { name: 'limitsLicenses', label: 'Limits and Licenses', developerName: 'Limits_And_Licenses' }
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
 * horizontal tabset - more room for tab labels as more tabs get added over time) and the active
 * tab's content on the right. Unlike the original stateless shell, this one does own state now -
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
