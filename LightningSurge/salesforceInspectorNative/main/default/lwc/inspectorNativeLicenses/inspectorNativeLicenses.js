import getLicenseUsage from '@salesforce/apex/InspectorNativeOrgInfo.getLicenseUsage';
import { LightningElement } from 'lwc';

/**
 * Licenses sub-tab of Limits and Licenses: User License and Permission Set License usage, mirroring
 * Company Information's own licensing sections, as bars. Calls InspectorNativeOrgInfo's
 * getLicenseUsage() imperatively (not a cacheable wire) on load and on Refresh, so the counts always
 * reflect current state - see that class's doc comment for why.
 * @alias InspectorNativeLicenses
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeLicenses extends LightningElement {
  isLoading = true;
  errorText;

  _usages = [];

  connectedCallback() {
    this.loadUsages();
  }

  async loadUsages() {
    this.isLoading = true;
    this.errorText = undefined;
    try {
      this._usages = await getLicenseUsage();
    } catch (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading license usage';
    } finally {
      this.isLoading = false;
    }
  }

  handleRefresh() {
    this.loadUsages();
  }

  buildRows(type) {
    return this._usages
      .filter((usage) => usage.type === type)
      .map((usage) => ({
        label: usage.label,
        percent: usage.total ? Math.round((usage.used / usage.total) * 100) : 0,
        usedOfTotal: `${usage.used} / ${usage.total}`
      }));
  }

  get userLicenseRows() {
    return this.buildRows('UserLicense');
  }

  get permissionSetLicenseRows() {
    return this.buildRows('PermissionSetLicense');
  }

  get hasUserLicenses() {
    return this.userLicenseRows.length > 0;
  }

  get hasPermissionSetLicenses() {
    return this.permissionSetLicenseRows.length > 0;
  }

  get hasNoLicenses() {
    return !this.isLoading && !this.errorText && !this.hasUserLicenses && !this.hasPermissionSetLicenses;
  }
}
