import { LightningElement } from 'lwc';

/**
 * Shell for the Salesforce Inspector Native app - just the internal tabset chrome. Deliberately
 * owns no feature-specific state (e.g. the object list used by the Create Records tab): each tab
 * is a self-contained child component, and it's premature to design cross-tab shared state before
 * a second tab exists.
 * @alias SalesforceInspectorNativeApp
 * @extends LightningElement
 * @hideconstructor
 */
export default class SalesforceInspectorNativeApp extends LightningElement {}
