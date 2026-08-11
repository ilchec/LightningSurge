import getQueryableObjects from '@salesforce/apex/InspectorNativeObjectPicker.getQueryableObjects';
import { buildChildRelationships, buildParentRelationships, limitRows } from 'c/inspectorNativeRelationshipMapUtils';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { LightningElement, wire } from 'lwc';

const INITIAL_ROWS_SHOWN = 25;
const ROWS_SHOWN_INCREMENT = 25;

/**
 * Relationship Map tab: pick an object and see what it looks up to (its own Reference fields) and
 * what looks up to it (its childRelationships), as a three-column hub-and-spoke layout - not a
 * force-directed graph. That's a deliberate scope choice: precise node-to-node line drawing would
 * need either a charting library (this repo has none, and doesn't load external scripts - see the
 * top-level README) or runtime DOM measurement to position SVG lines, neither of which can be
 * verified without a live org to render in. A static column layout needs neither, and every
 * relationship is still one glance away. Clicking any node re-centers the map on it, so a whole
 * object graph is still explorable one hop at a time.
 *
 * Each column renders inside a fixed-height, independently-scrolling list (not the whole page
 * growing) - starting with the first 25 rows and revealing another 25 per "Show More" click, so an
 * object with dozens of relationships (Task/Event-style polymorphic children are common on nearly
 * everything) never renders an unreadably long, all-at-once list, but every relationship is still
 * reachable - repeated clicks exhaust the full list rather than capping it.
 * @alias InspectorNativeRelationshipMap
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeRelationshipMap extends LightningElement {
  isLoadingObjects = true;
  errorText;

  _objectOptions = [];
  _selectedObjectApiName;
  _objectInfo;
  _parentShowCount = INITIAL_ROWS_SHOWN;
  _childShowCount = INITIAL_ROWS_SHOWN;

  @wire(getQueryableObjects)
  wiredObjects({ data, error }) {
    this.isLoadingObjects = false;
    if (data) {
      this._objectOptions = data.map((option) => ({ label: option.label, value: option.apiName }));
    } else if (error) {
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading the object list';
    }
  }

  get objectOptions() {
    return this._objectOptions;
  }

  get selectedObjectApiName() {
    return this._selectedObjectApiName;
  }

  get hasSelectedObject() {
    return Boolean(this._selectedObjectApiName);
  }

  @wire(getObjectInfo, { objectApiName: '$selectedObjectApiName' })
  wiredObjectInfo({ data, error }) {
    if (data) {
      this._objectInfo = data;
    } else if (error) {
      this._objectInfo = undefined;
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error loading object relationships';
    }
  }

  get hasSchemaLoaded() {
    return Boolean(this._objectInfo);
  }

  get isLoadingSchema() {
    return this.hasSelectedObject && !this.hasSchemaLoaded && !this.errorText;
  }

  get objectLabel() {
    return this._objectInfo?.label ?? this._selectedObjectApiName ?? '';
  }

  get parentLimited() {
    return this._objectInfo ? limitRows(buildParentRelationships(this._objectInfo), this._parentShowCount) : { visible: [], hiddenCount: 0 };
  }

  get parentRows() {
    return this.parentLimited.visible;
  }

  get parentHiddenCount() {
    return this.parentLimited.hiddenCount;
  }

  get hasHiddenParents() {
    return this.parentHiddenCount > 0;
  }

  get hasNoParents() {
    return this.hasSchemaLoaded && this.parentRows.length === 0;
  }

  get childLimited() {
    return this._objectInfo ? limitRows(buildChildRelationships(this._objectInfo), this._childShowCount) : { visible: [], hiddenCount: 0 };
  }

  get childRows() {
    return this.childLimited.visible;
  }

  get childHiddenCount() {
    return this.childLimited.hiddenCount;
  }

  get hasHiddenChildren() {
    return this.childHiddenCount > 0;
  }

  get hasNoChildren() {
    return this.hasSchemaLoaded && this.childRows.length === 0;
  }

  handleObjectSelect(event) {
    this.selectObject(event.detail.value);
  }

  handleShowMoreParents() {
    this._parentShowCount += ROWS_SHOWN_INCREMENT;
  }

  handleShowMoreChildren() {
    this._childShowCount += ROWS_SHOWN_INCREMENT;
  }

  // A parent/child node's targetApiName might not be in this app's own object list
  // (getQueryableObjects deliberately excludes system-suffixed objects like __History/__Share,
  // but those can still be legitimate lookup targets) - re-centering the map still works
  // regardless, since getObjectInfo doesn't depend on this app's own picker list. The combobox
  // just won't show a matching selection highlighted for that edge case.
  handleNodeClick(event) {
    this.selectObject(event.currentTarget.dataset.object);
  }

  selectObject(objectApiName) {
    if (!objectApiName || objectApiName === this._selectedObjectApiName) {
      return;
    }
    this._selectedObjectApiName = objectApiName;
    this._objectInfo = undefined;
    this._parentShowCount = INITIAL_ROWS_SHOWN;
    this._childShowCount = INITIAL_ROWS_SHOWN;
    this.errorText = undefined;
  }
}
