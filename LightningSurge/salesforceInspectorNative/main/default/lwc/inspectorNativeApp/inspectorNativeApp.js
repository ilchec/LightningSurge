import { LightningElement } from 'lwc';

/**
 * Shell for the Salesforce Inspector Native app - just the internal tabset chrome. Deliberately
 * owns no feature-specific state: each tab (Create Records, Query Records, Field Creator,
 * Permissions and Groups, Limits and Licenses) is a self-contained child component with its own
 * data-fetching and state, and none has needed anything from another so far - revisit this if a
 * future tab genuinely needs to share state across tabs.
 * @alias InspectorNativeApp
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeApp extends LightningElement {}
