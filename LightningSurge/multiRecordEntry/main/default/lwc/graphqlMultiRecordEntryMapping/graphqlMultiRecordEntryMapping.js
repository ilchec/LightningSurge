import { buildAutoMapping } from 'c/graphqlMultiRecordEntryCsvUtils';
import { api, LightningElement } from 'lwc';

const DRAG_OVER_CLASS = 'slds-theme_shade';

/**
 * Drag-and-drop dialog for mapping CSV columns onto Salesforce fields before importing them.
 * Fields whose API name exactly matches a CSV header are pre-filled; all other assignment
 * happens by dragging a CSV column chip onto a field's drop zone (or back to the column pool
 * to unmap it). Internal helper component, not intended for standalone use.
 * @alias GraphqlMultiRecordEntryMapping
 * @extends LightningElement
 * @hideconstructor
 */
export default class GraphqlMultiRecordEntryMapping extends LightningElement {
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

  get mappingRows() {
    return this.columns.map((column) => {
      const mappedHeader = this._fieldMapping[column.apiName] || null;
      return {
        apiName: column.apiName,
        label: column.label,
        required: column.required,
        mappedHeader,
        isMapped: Boolean(mappedHeader),
        isMatchField: this.matchFieldApiNames.includes(column.apiName)
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