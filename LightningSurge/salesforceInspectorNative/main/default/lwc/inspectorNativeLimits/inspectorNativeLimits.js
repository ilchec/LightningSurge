import getOrgLimits from '@salesforce/apex/InspectorNativeOrgInfo.getOrgLimits';
import { LightningElement } from 'lwc';

const WARNING_THRESHOLD_PERCENT = 70;
const EXPIRED_THRESHOLD_PERCENT = 90;

/**
 * Limits sub-tab of Limits and Licenses: every org limit System.OrgLimits reports as applicable to
 * this org, as gauges - modeled on Salesforce Inspector Reloaded's own Limits page. Calls
 * InspectorNativeOrgInfo's getOrgLimits() imperatively (not a cacheable wire) on load and on
 * Refresh, same "always current" reasoning as the Licenses sub-tab.
 * @alias InspectorNativeLimits
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeLimits extends LightningElement {
  isLoading = true;
  errorText;

  _limits = [];

  connectedCallback() {
    this.loadLimits();
  }

  async loadLimits() {
    this.isLoading = true;
    this.errorText = undefined;
    try {
      this._limits = await getOrgLimits();
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading org limits';
    } finally {
      this.isLoading = false;
    }
  }

  handleRefresh() {
    this.loadLimits();
  }

  get limitRows() {
    return this._limits.map((limit) => {
      const percent = limit.max ? Math.round((limit.used / limit.max) * 100) : 0;
      return {
        name: limit.name,
        percent,
        usedOfMax: `${limit.used} / ${limit.max}`,
        variant: percent >= EXPIRED_THRESHOLD_PERCENT ? 'expired' : percent >= WARNING_THRESHOLD_PERCENT ? 'warning' : 'base'
      };
    });
  }

  get hasLimits() {
    return this.limitRows.length > 0;
  }

  get hasNoLimits() {
    return !this.isLoading && !this.errorText && !this.hasLimits;
  }
}
