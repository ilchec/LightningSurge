import { LightningElement } from 'lwc';

/**
 * Shell for the Limits and Licenses tab - just the inner tabset chrome. Same "owns no state"
 * convention as inspectorNativeApp: each sub-tab (Limits, Licenses) fetches and owns its own data.
 * @alias InspectorNativeLimitsAndLicenses
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeLimitsAndLicenses extends LightningElement {}
