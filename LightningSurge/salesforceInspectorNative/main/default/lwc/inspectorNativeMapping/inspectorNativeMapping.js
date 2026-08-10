import { buildAutoMapping } from 'c/inspectorNativeCsvUtils';
import { api, LightningElement } from 'lwc';

const DRAG_OVER_CLASS = 'slds-theme_shade';
const NONE_OPTION = { label: '— None —', value: '' };

/**
 * Dialog for mapping CSV columns onto Salesforce fields before importing them. Fields whose API
 * name exactly matches a CSV header are pre-filled. Every field row offers two equivalent ways to
 * assign the rest: a combobox (keyboard/touch friendly), or dragging a CSV column chip onto the
 * field's drop zone (or back to the column pool to unmap it) - both read/write the same mapping
 * state, so they always stay in sync. Internal helper component, not intended for standalone use.
 * @alias InspectorNativeMapping
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeMapping extends LightningElement {
  /** Target columns to map onto: [{ apiName, label, required }]. @type {Array} */
  @api columns = [];

  /** CSV header names available to map. @type {string[]} */
  @api csvHeaders = [];

  /**
   * API names of the fields currently selected as upsert match keys, owned by the parent so the
   * selection stays in sync between this screen and the grid view. @type {string[]}
   */
  @api matchFieldApiNames = [];

  _fieldMapping = {};
  _unmappedHeaders = [];

  connectedCallback() {
    this._fieldMapping = buildAutoMapping(this.csvHeaders, this.columns);
    this.recomputeUnmapped();
  }

  // Drag-and-drop is the only way to assign a mapping otherwise - no keyboard alternative, and
  // native HTML5 drag-and-drop is unreliable on touch devices. Each row also gets a combobox
  // driven by the same _fieldMapping state, so assigning/changing/clearing a mapping works
  // without a mouse, alongside (not instead of) the existing drag-and-drop.
  get mappingRows() {
    const mappedHeaders = new Set(Object.values(this._fieldMapping).filter(Boolean));
    return this.columns.map((column) => {
      const mappedHeader = this._fieldMapping[column.apiName] || null;
      const selectableHeaders = this.csvHeaders.filter((header) => header === mappedHeader || !mappedHeaders.has(header));
      return {
        apiName: column.apiName,
        label: column.label,
        required: column.required,
        mappedHeader,
        isMapped: Boolean(mappedHeader),
        isMatchField: this.matchFieldApiNames.includes(column.apiName),
        comboboxValue: mappedHeader || '',
        comboboxOptions: [NONE_OPTION, ...selectableHeaders.map((header) => ({ label: header, value: header }))]
      };
    });
  }

  get unmappedChips() {
    return this._unmappedHeaders.map((header) => ({ header }));
  }

  get hasNoUnmappedHeaders() {
    return this._unmappedHeaders.length === 0;
  }

  recomputeUnmapped() {
    const mappedHeaders = new Set(Object.values(this._fieldMapping).filter(Boolean));
    this._unmappedHeaders = this.csvHeaders.filter((header) => !mappedHeaders.has(header));
  }

  assignMapping(apiName, header) {
    const nextMapping = { ...this._fieldMapping };
    Object.keys(nextMapping).forEach((key) => {
      if (nextMapping[key] === header) nextMapping[key] = null;
    });
    nextMapping[apiName] = header;
    this._fieldMapping = nextMapping;
    this.recomputeUnmapped();
  }

  unassignMapping(header) {
    const nextMapping = { ...this._fieldMapping };
    Object.keys(nextMapping).forEach((key) => {
      if (nextMapping[key] === header) nextMapping[key] = null;
    });
    this._fieldMapping = nextMapping;
    this.recomputeUnmapped();
  }

  handleChipDragStart(event) {
    event.dataTransfer.setData('text/plain', event.currentTarget.dataset.header);
  }

  handleFieldDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add(DRAG_OVER_CLASS);
  }

  handleFieldDragLeave(event) {
    event.currentTarget.classList.remove(DRAG_OVER_CLASS);
  }

  handleFieldDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove(DRAG_OVER_CLASS);
    const header = event.dataTransfer.getData('text/plain');
    if (header) this.assignMapping(event.currentTarget.dataset.apiName, header);
  }

  handlePoolDragOver(event) {
    event.preventDefault();
  }

  handlePoolDrop(event) {
    event.preventDefault();
    const header = event.dataTransfer.getData('text/plain');
    if (header) this.unassignMapping(header);
  }

  handleUnmapClick(event) {
    this.unassignMapping(event.currentTarget.dataset.header);
  }

  handleMappingSelect(event) {
    const apiName = event.currentTarget.dataset.apiName;
    const header = event.detail.value;
    if (header) {
      this.assignMapping(apiName, header);
    } else {
      const currentHeader = this._fieldMapping[apiName];
      if (currentHeader) this.unassignMapping(currentHeader);
    }
  }

  handleMatchFieldToggle(event) {
    this.dispatchEvent(
      new CustomEvent('matchfieldtoggle', {
        detail: { apiName: event.currentTarget.dataset.apiName }
      })
    );
  }

  @api
  getMapping() {
    return { ...this._fieldMapping };
  }
}