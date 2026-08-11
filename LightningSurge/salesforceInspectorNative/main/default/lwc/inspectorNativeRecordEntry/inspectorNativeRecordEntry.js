import CURRENT_USER_ID from '@salesforce/user/Id';
import {
  buildCsvTemplate,
  buildResultsCsv,
  buildRowsCsv,
  coerceCsvValue,
  mapCsvRowToValues,
  parseClipboardData,
  parseCsv
} from 'c/inspectorNativeCsvUtils';
import {
  buildAllFieldsColumnGroups,
  buildBulkDeleteMutation,
  buildColumnGroups,
  buildMatchQuery,
  buildRecordTypeQuery,
  buildRequiredFieldsColumnGroups,
  buildUpsertMutation,
  extractDeleteResults,
  extractMatchedIds,
  extractRecordTypes,
  extractSaveResults,
  filterVisibleColumnGroups,
  flattenColumnGroups,
  isValidObjectApiName,
  resolveRecordTypeSelection
} from 'c/inspectorNativeRecordEntryUtils';
import { InspectorNativeQueryBridge } from 'c/inspectorNativeQueryBridge';
import {
  buildFieldModelForEdit,
  buildRelationshipFieldModel,
  getCreateContext,
  getInitialFormValues,
  navigateToRecord,
  showToast
} from 'c/inspectorNativeSharedUtils';
import LightningConfirm from 'lightning/confirm';
import { executeMutation, graphql } from 'lightning/graphql';
import { NavigationMixin } from 'lightning/navigation';
import { getObjectInfo, getPicklistValuesByRecordType } from 'lightning/uiObjectInfoApi';
import { getRecordCreateDefaults } from 'lightning/uiRecordApi';
import { api, LightningElement, wire } from 'lwc';

// Bump on every change so it's visible which deployed version is running in the org.
const COMPONENT_VERSION = 'v3.2.0';

const DEFAULT_INITIAL_ROW_COUNT = 1;
const DEFAULT_MAX_ROWS = 200;
const DEFAULT_BATCH_SIZE = 50;
const UI_STATE_GRID = 'grid';
const UI_STATE_MAPPING = 'mapping';
const UI_STATE_PASTE = 'paste';
const UI_STATE_MATCH_FIELDS = 'matchFields';
const UI_STATE_COLUMN_PICKER = 'columnPicker';
const UI_STATE_SAVE_OPTIONS = 'saveOptions';
const UI_STATE_RESULTS = 'results';
const UI_STATE_RECORD_TYPE_PICKER = 'recordTypePicker';
const SAVE_MODE_SOFT = 'soft';
const SAVE_MODE_ALL_OR_NOTHING = 'allOrNothing';
const NON_MATCHABLE_FIELD_TYPES = new Set(['textarea', 'multipicklist']);
const DEFAULT_LAYOUT_OPTION_VALUE = '__DEFAULT_LAYOUT__';
const ALL_FIELDS_OPTION_VALUE = '__ALL_FIELDS__';
const REQUIRED_ONLY_OPTION_VALUE = '__REQUIRED_ONLY__';
const CSV_PREVIEW_ROW_COUNT = 3;
const VIEW_MODE_FIELD = 'field';
const VIEW_MODE_TABLE = 'table';
const SUCCESS_STATUS_LABEL_BY_OPERATION = { create: 'Created', update: 'Updated', delete: 'Deleted' };

/**
 * Object-agnostic inline surface for creating (or upserting, when match-key fields are selected)
 * many records of the same object at once. Field presence, grouping, required-ness, and
 * editability come from the object's create-mode page layout (respecting field-level security).
 * All reads/writes use the UI API GraphQL wire adapter - no Apex.
 *
 * Unlike the `LightningModal`-based bulk create/upsert dialog this was originally forked from (see
 * `salesforceInspectorNative/README.md`'s "Fully standalone" section), this is a plain inline
 * component: the caller sets `objectApiName` (and, to skip this component's own Record-Type-picker
 * screen, `recordTypeId`/`showAllFields`/`requiredFieldsOnly`) as ordinary `@api` props and renders
 * it directly in markup. It signals completion via `done`/`cancel` events instead of resolving a
 * Promise.
 * @alias InspectorNativeRecordEntry
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeRecordEntry extends NavigationMixin(LightningElement) {
  /** API name of the object to create records for. @type {string} */
  @api objectApiName;

  /** Optional record type applied to every row in this batch. @type {string} */
  @api recordTypeId;

  /**
   * Optional Record Type DeveloperName used to resolve a layout when the object has more than
   * one active Record Type and recordTypeId wasn't given directly (e.g. set via a List View
   * button's URL: ?c__layoutDeveloperName=...). Ignored if recordTypeId is set. If it doesn't
   * match any active Record Type, the layout picker is shown instead. @type {string}
   */
  @api layoutDeveloperName;

  /**
   * Skips the layout picker and goes straight to showing every createable field on the object,
   * ignoring the assigned layout entirely (e.g. set via a List View button's URL:
   * ?c__showAllFields=true). Takes priority over layoutDeveloperName but not recordTypeId.
   * @type {boolean}
   */
  @api showAllFields = false;

  /**
   * Skips the layout picker and shows only fields that are genuinely required by the object
   * itself, ignoring the assigned layout entirely (e.g. set via a List View button's URL:
   * ?c__requiredFieldsOnly=true). The minimal possible create form - also the only way to reach
   * required fields on a layout that was never assigned to any Record Type, since that layout
   * can't be resolved via getRecordCreateDefaults at all. Takes priority over layoutDeveloperName
   * but not recordTypeId or showAllFields. @type {boolean}
   */
  @api requiredFieldsOnly = false;

  /**
   * Skips the layout picker and uses the Default Layout directly (recordTypeId: null - whatever
   * layout the org resolves for the running user with no Record Type specified), the same
   * resolution picking "Default Layout" from the picker reaches, just without showing it. Takes
   * priority over layoutDeveloperName but not recordTypeId/showAllFields/requiredFieldsOnly.
   * @type {boolean}
   */
  @api useDefaultLayout = false;

  /**
   * Query mode: instead of resolving a create-mode layout, seeds the grid with already-queried
   * existing records (queryRecords) and builds columns directly from queryFieldApiNames - no
   * layout, no Record-Type picker. Rows start pre-filled and untouched; only rows the user
   * actually edits get saved, always as an update against that row's own known Id (see
   * resolveMatches). Used by the Query Records tab (inspectorNativeQueryRecords).
   * @type {boolean}
   */
  @api queryMode = false;

  /** Field API names to build columns from in query mode, in display order. @type {string[]} */
  @api queryFieldApiNames = [];

  /** Existing records (flat {apiName: value} maps, including Id) to seed the grid with in query
   *  mode. @type {Array} */
  @api queryRecords = [];

  /** Number of blank rows shown when the modal first opens. @type {number} @default 1 */
  @api initialRowCount = DEFAULT_INITIAL_ROW_COUNT;

  /** Maximum number of rows that can be added in one modal session. @type {number} @default 200 */
  @api maxRows = DEFAULT_MAX_ROWS;

  /** Rows per GraphQL request when saving, to keep individual requests small. @type {number} @default 50 */
  @api batchSize = DEFAULT_BATCH_SIZE;

  isSaving = false;
  isDeleting = false;
  isLoadingMatchPreview = false;
  errorMessage = '';

  _layoutContext;
  _columnGroups = [];
  _flatColumns = [];
  _picklistData;
  _defaultValues = {};
  _rows = [];
  _nextClientId = 1;
  _uiState = UI_STATE_GRID;
  _csvHeaders = [];
  _csvRows = [];
  _saveMode = SAVE_MODE_SOFT;
  _matchFieldApiNames = [];
  _matchPreview;
  _validationErrors = [];
  _saveResults = [];
  _allOrNothingIncomplete = false;
  _queryBridge = new InspectorNativeQueryBridge();
  _pendingQuery;
  _availableRecordTypes = [];
  _resolvedRecordTypeId;
  _recordTypeResolved = false;
  _showAllFields = false;
  _showRequiredOnly = false;
  _ignoreLayoutRequired = false;
  _hiddenColumnApiNames = new Set();
  _viewMode = VIEW_MODE_FIELD;
  _isEditMode = false;
  _selectedClientIds = new Set();

  connectedCallback() {
    // objectApiName is interpolated unescaped into every GraphQL query/mutation this component
    // builds - reject anything that isn't a plain API name before it's ever used to build a query.
    if (!isValidObjectApiName(this.objectApiName)) {
      this.setError({ message: `"${this.objectApiName}" isn't a valid object API name.` });
      return;
    }
    // Query mode has no layout/Record Type to resolve - wiredQueryModeObjectInfo (gated on
    // queryModeObjectApiName) picks up from here reactively once objectApiName is valid.
    if (this.queryMode) return;
    this.resolveRecordType();
  }

  // Gates the create-defaults wire until resolveRecordType() has decided which recordTypeId to
  // use (directly, via layoutDeveloperName, or via the layout picker) - otherwise it would fire
  // immediately with the org's default record type, wasting a fetch (or worse, briefly showing
  // the wrong layout) whenever a picker or a DeveloperName lookup is actually needed.
  get wireObjectApiName() {
    return this._recordTypeResolved ? this.objectApiName : undefined;
  }

  get wireRecordTypeId() {
    return this._resolvedRecordTypeId || undefined;
  }

  @wire(getRecordCreateDefaults, { objectApiName: '$wireObjectApiName', recordTypeId: '$wireRecordTypeId' })
  wiredCreateDefaults({ data, error }) {
    if (data) {
      this._layoutContext = getCreateContext(data, this.objectApiName);
      this._defaultValues = getInitialFormValues(this._layoutContext.record);
      if (CURRENT_USER_ID && this._layoutContext.objectInfo.fields.OwnerId) {
        this._defaultValues = { ...this._defaultValues, OwnerId: CURRENT_USER_ID };
      }
      this.rebuildColumns();
      this.seedInitialRows();
    } else if (error) {
      this.setError(error);
    }
  }

  @wire(getPicklistValuesByRecordType, { objectApiName: '$objectApiName', recordTypeId: '$resolvedRecordTypeId' })
  wiredPicklists({ data }) {
    if (data) {
      this._picklistData = data;
      if (this.queryMode) {
        if (this._layoutContext?.objectInfo) this.rebuildQueryColumns(this._layoutContext.objectInfo);
      } else {
        this.rebuildColumns();
      }
    }
  }

  // Query mode's own data-fetch path: no create context/layout involved, just the object's
  // describe metadata (getObjectInfo, not getRecordCreateDefaults - that one is create-context-
  // specific and requires a Record Type to resolve, neither of which apply to editing already-
  // queried records). Gated on queryMode so it never fires outside query mode.
  get queryModeObjectApiName() {
    return this.queryMode ? this.objectApiName : undefined;
  }

  @wire(getObjectInfo, { objectApiName: '$queryModeObjectApiName' })
  wiredQueryModeObjectInfo({ data, error }) {
    if (data) {
      // Same shape getCreateContext() produces, so every other place that reads _layoutContext
      // (isLoading, modalLabel, saveRowsInBatches, resolveMatches, ...) needs no query-mode-
      // specific branching of its own.
      this._layoutContext = { record: null, objectApiName: this.objectApiName, recordTypeId: null, objectInfo: data, layout: null };
      this.rebuildQueryColumns(data);
      this.seedRowsFromQueryRecords();
    } else if (error) {
      this.setError(error);
    }
  }

  // A queryFieldApiName containing "." is a relationship-traversal field (e.g. "Account.Name",
  // flattened server-side by InspectorNativeSoqlRunner from SOQL dot notation) rather than a real
  // field on this object's own objectInfo - it can't go through buildFieldModelForEdit (which looks
  // the apiName up in objectInfo.fields and would just filter it out), so it gets its own always-
  // read-only column model instead.
  rebuildQueryColumns(objectInfo) {
    const columns = this.queryFieldApiNames
      .map((apiName) =>
        apiName.includes('.') ? buildRelationshipFieldModel(apiName) : buildFieldModelForEdit(apiName, objectInfo, {}, this._picklistData)
      )
      .filter(Boolean);
    this._columnGroups = columns.length ? [{ id: 'group-query', heading: 'Queried Fields', columnCount: columns.length, columns }] : [];
    this._flatColumns = columns;
  }

  seedRowsFromQueryRecords() {
    if (this._rows.length > 0) return;
    this._rows = this.queryRecords.map((record) => this.createRowFromQueryRecord(record));
  }

  createRowFromQueryRecord(record) {
    const clientId = this._nextClientId;
    this._nextClientId += 1;
    // touched: false - an unedited queried row is just for reference/browsing, not resubmitted;
    // existingRecordId is what lets resolveMatches treat this as a known update, no match-fields
    // lookup needed, once the row IS touched. originalValues is the pristine, never-mutated
    // snapshot handleExitEditMode() reverts to when discarding unsaved edits - kept on the row
    // itself (not a separate array) so it's automatically correct even after some rows are
    // removed by a successful save; nothing needs to stay in sync with anything else.
    return {
      clientId,
      values: { ...record },
      originalValues: { ...record },
      touched: false,
      errorMessage: '',
      existingRecordId: record.Id
    };
  }

  // See inspectorNativeQueryBridge for how this bridges the reactive query wire to a
  // Promise. Used for the Record Type lookup (on load), the per-batch match lookup (on save), and
  // the match preview (see loadMatchPreview) - all run one at a time.
  get pendingGraphqlQuery() {
    return this._pendingQuery;
  }

  @wire(graphql, { query: '$pendingGraphqlQuery' })
  wiredPendingQuery(result) {
    this._queryBridge.handleResult(result);
  }

  runGraphqlQuery(query) {
    const promise = this._queryBridge.beginRequest();
    this._pendingQuery = query;
    return promise;
  }

  // Every launch shows the layout picker (Default Layout / each active Record Type / All Fields /
  // Required Only) unless the caller already told us exactly what to use via recordTypeId,
  // showAllFields, requiredFieldsOnly, or a layoutDeveloperName that actually matches an active
  // Record Type. The priority order itself lives in resolveRecordTypeSelection (pure, testable).
  async resolveRecordType() {
    const query = buildRecordTypeQuery(this.objectApiName);
    let recordTypes = [];
    try {
      const data = await this.runGraphqlQuery(query);
      recordTypes = extractRecordTypes({ data });
    } catch (error) {
      // Don't block the whole modal on a secondary lookup failing - the picker still works with
      // just the Default Layout / All Fields / Required Only options if this comes back empty.
      recordTypes = [];
    }
    this._availableRecordTypes = recordTypes;

    const selection = resolveRecordTypeSelection({
      recordTypeId: this.recordTypeId,
      showAllFields: this.showAllFields,
      requiredFieldsOnly: this.requiredFieldsOnly,
      useDefaultLayout: this.useDefaultLayout,
      layoutDeveloperName: this.layoutDeveloperName,
      availableRecordTypes: recordTypes
    });

    if (selection.mode === 'picker') {
      this._uiState = UI_STATE_RECORD_TYPE_PICKER;
      return;
    }
    if (selection.mode === 'allFields') this._showAllFields = true;
    if (selection.mode === 'requiredOnly') this._showRequiredOnly = true;
    this.finishRecordTypeResolution(selection.recordTypeId);
  }

  finishRecordTypeResolution(recordTypeId) {
    this._resolvedRecordTypeId = recordTypeId;
    this._recordTypeResolved = true;
  }

  enableAllFieldsMode() {
    this._showAllFields = true;
    this.finishRecordTypeResolution(null);
  }

  enableRequiredOnlyMode() {
    this._showRequiredOnly = true;
    this.finishRecordTypeResolution(null);
  }

  // "Default Layout" represents recordTypeId: null/undefined, i.e. whatever layout the org
  // resolves for the running user without picking a specific Record Type - the closest the UI
  // API lets us get to a layout that isn't tied to any particular Record Type, since layouts
  // can only be reached through a Record Type (or its absence), never fetched by name directly.
  get recordTypeOptions() {
    return [
      { label: 'Default Layout', value: DEFAULT_LAYOUT_OPTION_VALUE },
      ...this._availableRecordTypes.map((rt) => ({ label: rt.label, value: rt.id })),
      { label: 'All Fields (ignore layout)', value: ALL_FIELDS_OPTION_VALUE },
      { label: 'Required Only (ignore layout)', value: REQUIRED_ONLY_OPTION_VALUE }
    ];
  }

  get isRecordTypePickerState() {
    return this._uiState === UI_STATE_RECORD_TYPE_PICKER;
  }

  handleRecordTypeSelect(event) {
    const value = event.detail.value;
    if (value === ALL_FIELDS_OPTION_VALUE) {
      this.enableAllFieldsMode();
    } else if (value === REQUIRED_ONLY_OPTION_VALUE) {
      this.enableRequiredOnlyMode();
    } else if (value === DEFAULT_LAYOUT_OPTION_VALUE) {
      this.finishRecordTypeResolution(null);
    } else {
      this.finishRecordTypeResolution(value);
    }
    this._uiState = UI_STATE_GRID;
  }

  get resolvedRecordTypeId() {
    return this.recordTypeId || this._layoutContext?.recordTypeId;
  }

  rebuildColumns() {
    if (!this._layoutContext?.objectInfo) return;
    if (this._showAllFields) {
      this._columnGroups = buildAllFieldsColumnGroups(this._layoutContext.objectInfo, this._picklistData);
    } else if (this._showRequiredOnly) {
      this._columnGroups = buildRequiredFieldsColumnGroups(this._layoutContext.objectInfo, this._picklistData);
    } else {
      if (!this._layoutContext?.layout) return;
      this._columnGroups = buildColumnGroups(
        this._layoutContext.layout,
        this._layoutContext.objectInfo,
        this._picklistData
      );
    }
    this._flatColumns = flattenColumnGroups(this._columnGroups);
  }

  seedInitialRows() {
    if (this._rows.length > 0) return;
    const count = Math.min(this.initialRowCount, this.maxRows);
    for (let i = 0; i < count; i += 1) {
      this._rows = [...this._rows, this.createRow()];
    }
  }

  createRow() {
    const clientId = this._nextClientId;
    this._nextClientId += 1;
    return { clientId, values: { ...this._defaultValues }, touched: false, errorMessage: '' };
  }

  setError(error) {
    this.errorMessage = error?.body?.message ?? error?.message ?? 'Unknown error loading the form';
  }

  get modalLabel() {
    const objectLabel = this._layoutContext?.objectInfo?.label || this.objectApiName;
    return `Add or Update ${objectLabel} Records`;
  }

  get componentVersion() {
    return COMPONENT_VERSION;
  }

  // hasError must short-circuit isLoading - otherwise a wire-level load failure (setError()
  // without ever populating _layoutContext, e.g. wiredCreateDefaults' error branch) leaves the
  // spinner running forever, since the error banner only renders in isLoading's lwc:else branch.
  get isLoading() {
    return !this._layoutContext && !this.hasError && !this.isRecordTypePickerState;
  }

  get hasError() {
    return Boolean(this.errorMessage);
  }

  // Column management (F4): visible* getters apply the hidden-columns filter on top of the
  // underlying full column set, so validation/save logic (which reads the un-filtered
  // _flatColumns directly) is unaffected by what's merely hidden from view.
  get columnGroups() {
    return filterVisibleColumnGroups(this._columnGroups, this._hiddenColumnApiNames);
  }

  get visibleFlatColumns() {
    return flattenColumnGroups(this.columnGroups);
  }

  get flatColumns() {
    return this._flatColumns.map((column) => ({ ...column, required: this.effectiveRequired(column) }));
  }

  // When ignoreLayoutRequired is on, a field can only block saving for being genuinely required
  // by the object itself (apiRequired), not because this particular layout marked it required.
  effectiveRequired(column) {
    return this._ignoreLayoutRequired ? column.apiRequired : column.required;
  }

  // View/Edit mode (query mode only - see isViewOnly): every field is forced non-editable while
  // viewing, on top of whatever its own real editability already is, reusing the same disabled-
  // rendering both Field View (inspectorNativeFormField already respects field.editable) and Table
  // View (see the notEditable-driven disabled binding on its raw input) already have - no new
  // display-only renderer needed.
  effectiveEditable(column) {
    return column.editable && !this.isViewOnly;
  }

  // Query mode defaults to read-only to prevent accidental edits; Create mode has no such concept
  // (every row is new/blank, there's nothing to "just view").
  get isViewOnly() {
    return this.queryMode && !this._isEditMode;
  }

  get isNotQueryMode() {
    return !this.queryMode;
  }

  get editModeToggleLabel() {
    return this._isEditMode ? 'View Only' : 'Edit';
  }

  handleToggleEditMode() {
    if (this._isEditMode) {
      this.exitEditMode();
    } else {
      this._isEditMode = true;
    }
  }

  // Discards any unsaved edits, reverting every row still present to its own pristine
  // originalValues snapshot (rows already successfully saved are gone from _rows by this point,
  // per the existing save flow, so they're correctly never touched here). Rows with no
  // originalValues (manually added via Add Row, never came from the query) are dropped entirely -
  // view mode should show exactly what was queried, nothing more.
  exitEditMode() {
    this._rows = this._rows
      .filter((row) => row.originalValues)
      .map((row) => ({ ...row, values: { ...row.originalValues }, touched: false, errorMessage: '' }));
    this._isEditMode = false;
    this._validationErrors = [];
    // Selection is only actionable in Edit mode (see isDeleteSelectedDisabled) - clear it along
    // with the rest of the discarded edit-mode state rather than leaving a stale selection behind
    // for the next time Edit is turned back on.
    this._selectedClientIds = new Set();
  }

  // Query mode adds a leading row-selection checkbox column for bulk delete, on top of the
  // existing row-action (remove) column - Create mode has no persisted records to delete, so it
  // never gets this extra column.
  get columnCountWithAction() {
    return this.visibleFlatColumns.length + (this.queryMode ? 2 : 1);
  }

  get hasNoRows() {
    return this._rows.length === 0;
  }

  get ignoreLayoutRequired() {
    return this._ignoreLayoutRequired;
  }

  handleIgnoreLayoutRequiredChange(event) {
    this._ignoreLayoutRequired = event.target.checked;
    this._validationErrors = [];
  }

  get isColumnPickerState() {
    return this._uiState === UI_STATE_COLUMN_PICKER;
  }

  // Required columns are excluded from the hideable set entirely - hiding one would remove its
  // input from the grid without removing the requirement, leaving no way to satisfy it (and
  // reportValidity() only checks rendered fields, so it wouldn't even catch the omission).
  get columnVisibilityOptions() {
    return this._flatColumns
      .filter((column) => !this.effectiveRequired(column))
      .map((column) => ({ label: column.label, value: column.apiName }));
  }

  get visibleColumnApiNames() {
    return this.columnVisibilityOptions.map((option) => option.value).filter((apiName) => !this._hiddenColumnApiNames.has(apiName));
  }

  get hasHiddenColumns() {
    return this._hiddenColumnApiNames.size > 0;
  }

  handleOpenColumnPicker() {
    this._uiState = UI_STATE_COLUMN_PICKER;
  }

  handleColumnPickerDone() {
    this._uiState = UI_STATE_GRID;
  }

  // Scoped to the hideable (non-required) apiNames only, so a required column - which never
  // appears as an option in the dual-listbox at all - can never end up in _hiddenColumnApiNames.
  handleColumnVisibilityChange(event) {
    const visible = new Set(event.detail.value);
    const hideableApiNames = this.columnVisibilityOptions.map((option) => option.value);
    this._hiddenColumnApiNames = new Set(hideableApiNames.filter((apiName) => !visible.has(apiName)));
  }

  handleShowAllColumns() {
    this._hiddenColumnApiNames = new Set();
  }

  get rows() {
    const visibleApiNames = new Set(this.visibleFlatColumns.map((column) => column.apiName));
    return this._rows.map((row) => ({
      clientId: row.clientId,
      errorRowKey: `${row.clientId}-error`,
      errorMessage: row.errorMessage,
      selected: this._selectedClientIds.has(row.clientId),
      cells: this._flatColumns
        .filter((column) => visibleApiNames.has(column.apiName))
        .map((column) => ({
          ...column,
          required: this.effectiveRequired(column),
          editable: this.effectiveEditable(column),
          notEditable: !this.effectiveEditable(column),
          value: row.values[column.apiName] ?? null,
          rawValue: String(row.values[column.apiName] ?? '')
        }))
    }));
  }

  // Table View (dense, CSV-like raw editing) vs Field View (today's typed-per-field grid) - both
  // render from this same rows/columnGroups data, just with different per-cell markup, so
  // switching modes mid-edit can never lose or duplicate anything.
  get isFieldView() {
    return this._viewMode === VIEW_MODE_FIELD;
  }

  get isTableView() {
    return this._viewMode === VIEW_MODE_TABLE;
  }

  get fieldViewButtonVariant() {
    return this.isFieldView ? 'brand' : 'neutral';
  }

  get tableViewButtonVariant() {
    return this.isTableView ? 'brand' : 'neutral';
  }

  get cellColumnClass() {
    return this.isTableView ? 'raw-cell-col' : 'field-col';
  }

  handleViewModeChange(event) {
    this._viewMode = event.currentTarget.dataset.value;
  }

  get isAddRowDisabled() {
    return this.isViewOnly || this._rows.length >= this.maxRows;
  }

  get isRemoveRowDisabled() {
    return this.isViewOnly;
  }

  // Bulk delete (query mode only - see the queryMode-gated selection column in the markup):
  // selection/delete are only actionable in Edit mode, same as the per-row remove icon above, and
  // while another save/delete isn't already in flight (both mutate the same _rows/_saveResults
  // state, so overlapping them isn't safe).
  get selectedRowCount() {
    return this._selectedClientIds.size;
  }

  get isAllRowsSelected() {
    return this._rows.length > 0 && this._rows.every((row) => this._selectedClientIds.has(row.clientId));
  }

  get isRowSelectionDisabled() {
    return this.isViewOnly || this.isSaving || this.isDeleting;
  }

  get deleteSelectedButtonLabel() {
    return this.selectedRowCount ? `Delete Selected (${this.selectedRowCount})` : 'Delete Selected';
  }

  get isDeleteSelectedDisabled() {
    return this.isRowSelectionDisabled || this.selectedRowCount === 0;
  }

  handleSelectAllToggle(event) {
    this._selectedClientIds = event.target.checked ? new Set(this._rows.map((row) => row.clientId)) : new Set();
  }

  handleRowSelectToggle(event) {
    const clientId = Number(event.currentTarget.dataset.rowId);
    const next = new Set(this._selectedClientIds);
    if (event.target.checked) {
      next.add(clientId);
    } else {
      next.delete(clientId);
    }
    this._selectedClientIds = next;
  }

  get isMappingState() {
    return this._uiState === UI_STATE_MAPPING;
  }

  get isPasteState() {
    return this._uiState === UI_STATE_PASTE;
  }

  get isResultsState() {
    return this._uiState === UI_STATE_RESULTS;
  }

  get isMatchFieldsState() {
    return this._uiState === UI_STATE_MATCH_FIELDS;
  }

  get isSaveOptionsState() {
    return this._uiState === UI_STATE_SAVE_OPTIONS;
  }

  get csvHeadersForMapping() {
    return this._csvHeaders;
  }

  // CSV mapping preview (F1): first few parsed data rows, shown next to the mapping UI so a
  // column can be checked against real data instead of being mapped blind.
  get csvPreviewRows() {
    return this._csvRows.slice(0, CSV_PREVIEW_ROW_COUNT).map((row, rowIndex) => ({
      key: `preview-${rowIndex}`,
      cells: this._csvHeaders.map((header, cellIndex) => ({ key: header, value: row[cellIndex] ?? '' }))
    }));
  }

  get touchedRowCount() {
    return this._rows.filter((row) => row.touched).length;
  }

  get saveButtonLabel() {
    return this.touchedRowCount ? `Save (${this.touchedRowCount})` : 'Save';
  }

  get isSaveDisabled() {
    return this.isSaving || this.isDeleting || this.touchedRowCount === 0;
  }

  // isLoadingMatchPreview holds the query bridge's single slot (see loadMatchPreview) - letting
  // Confirm Save fire while it's still in flight would race it for that slot and fail the whole
  // save with a spurious "one at a time" error unrelated to the actual data.
  get isConfirmSaveDisabled() {
    return this.isSaving || this.isLoadingMatchPreview;
  }

  get validationErrors() {
    return this._validationErrors;
  }

  get saveModeOptions() {
    return [
      {
        value: SAVE_MODE_SOFT,
        label: 'Partial success',
        description: 'Save the rows that pass. Any row that fails stays in the grid with its error so you can fix and retry it.',
        iconName: 'utility:success',
        cardClass: this.saveModeCardClass(SAVE_MODE_SOFT)
      },
      {
        value: SAVE_MODE_ALL_OR_NOTHING,
        label: 'All or nothing',
        description: 'Validate everything first. If a row still fails to save, stop immediately and report exactly what was already committed.',
        iconName: 'utility:lock',
        cardClass: this.saveModeCardClass(SAVE_MODE_ALL_OR_NOTHING)
      }
    ];
  }

  saveModeCardClass(value) {
    return `save-mode-card${this._saveMode === value ? ' save-mode-card_selected' : ''}`;
  }

  get saveMode() {
    return this._saveMode;
  }

  get matchFieldApiNames() {
    return this._matchFieldApiNames;
  }

  get matchFieldOptions() {
    return this._flatColumns
      .filter((column) => !NON_MATCHABLE_FIELD_TYPES.has(column.type))
      .map((column) => ({ label: column.label, value: column.apiName }));
  }

  get hasMatchFields() {
    return this._matchFieldApiNames.length > 0;
  }

  get matchFieldSummary() {
    const labelByApiName = new Map(this._flatColumns.map((column) => [column.apiName, column.label]));
    return this._matchFieldApiNames.map((apiName) => labelByApiName.get(apiName) ?? apiName).join(', ');
  }

  get matchPreview() {
    return this._matchPreview;
  }

  get saveResults() {
    return this._saveResults.map((result) => ({
      ...result,
      statusLabel: result.success ? SUCCESS_STATUS_LABEL_BY_OPERATION[result.operation] : 'Failed',
      statusClass: result.success ? 'slds-text-color_success' : 'slds-text-color_error'
    }));
  }

  // The results screen (UI_STATE_RESULTS) is shared between a save attempt (create/update) and a
  // bulk delete - _saveResults is always reset to [] before either starts, so by the time this
  // screen is showing anything, every entry in it is homogeneously one or the other.
  get resultsHeading() {
    return this._saveResults.length && this._saveResults.every((result) => result.operation === 'delete') ? 'Delete results' : 'Save results';
  }

  get allOrNothingIncomplete() {
    return this._allOrNothingIncomplete;
  }

  get createdBeforeStopCount() {
    return this._saveResults.filter((result) => result.success).length;
  }

  handleAddRow() {
    if (this.isAddRowDisabled) return;
    this._rows = [...this._rows, this.createRow()];
  }

  handleRemoveRow(event) {
    const clientId = Number(event.currentTarget.dataset.rowId);
    this._rows = this._rows.filter((row) => row.clientId !== clientId);
  }

  handleDownloadTemplate() {
    const csv = buildCsvTemplate(this._flatColumns);
    this.downloadCsv(csv, `${this.objectApiName}_import_template.csv`);
  }

  // Query mode's "Export CSV" - exports whatever's currently in the grid (including any unsaved
  // edits), not tied to a save attempt the way handleExportResults is. Available regardless of
  // View/Edit mode, since exporting is read-only and safe either way.
  handleExportCurrentRows() {
    const csv = buildRowsCsv(this._flatColumns, this._rows);
    this.downloadCsv(csv, `${this.objectApiName}_query_results.csv`);
  }

  handleExportResults() {
    const resultRows = this._saveResults.map((result) => ({
      values: result.values,
      status: result.success ? 'Success' : 'Failed',
      name: result.recordName,
      detail: result.detail
    }));
    const csv = buildResultsCsv(this._flatColumns, resultRows);
    this.downloadCsv(csv, `${this.objectApiName}_upsert_results.csv`);
  }

  downloadCsv(csv, fileName) {
    const link = this.template.querySelector('[data-id="download-link"]');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    link.download = fileName;
    link.click();
  }

  handleImportCsvClick() {
    this.template.querySelector('[data-id="csv-file-input"]').click();
  }

  handleCsvFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.handleCsvLoaded(reader.result);
    reader.readAsText(file);
  }

  handleCsvLoaded(text) {
    const { headers, rows } = parseCsv(text);
    if (!headers.length || !rows.length) {
      showToast(this, 'Nothing to import', 'The CSV file has no data rows', 'warning');
      return;
    }
    this._csvHeaders = headers;
    this._csvRows = rows;
    this._uiState = UI_STATE_MAPPING;
  }

  handleMappingBack() {
    this._uiState = UI_STATE_GRID;
  }

  // Paste-from-Excel (F2): reuses the exact same header/row shape and mapping screen as CSV
  // import - only how the raw text gets parsed differs (tab-separated instead of semicolon).
  handleOpenPaste() {
    this._uiState = UI_STATE_PASTE;
  }

  handlePasteBack() {
    this._uiState = UI_STATE_GRID;
  }

  handlePasteContinue() {
    const text = this.template.querySelector('[data-id="paste-textarea"]')?.value;
    if (!text?.trim()) {
      showToast(this, 'Nothing to import', 'Paste some data first', 'warning');
      return;
    }
    const { headers, rows } = parseClipboardData(text);
    if (!headers.length || !rows.length) {
      showToast(this, 'Nothing to import', 'That doesn’t look like tab-separated data with a header row', 'warning');
      return;
    }
    this._csvHeaders = headers;
    this._csvRows = rows;
    this._uiState = UI_STATE_MAPPING;
  }

  handleOpenMatchFields() {
    this._uiState = UI_STATE_MATCH_FIELDS;
  }

  handleMatchFieldsDone() {
    this._uiState = UI_STATE_GRID;
  }

  handleMappingMatchFieldToggle(event) {
    this.toggleMatchField(event.detail.apiName);
  }

  handleMatchFieldChange(event) {
    this._matchFieldApiNames = event.detail.value;
  }

  toggleMatchField(apiName) {
    this._matchFieldApiNames = this._matchFieldApiNames.includes(apiName)
      ? this._matchFieldApiNames.filter((f) => f !== apiName)
      : [...this._matchFieldApiNames, apiName];
  }

  handleSaveModeCardClick(event) {
    this._saveMode = event.currentTarget.dataset.value;
  }

  handleApplyMapping() {
    const mappingDialog = this.template.querySelector('c-inspector-native-mapping');
    const mapping = mappingDialog.getMapping();
    const rowsToAdd = this._csvRows.slice(0, this.maxRows).map((csvRow) => this.buildRowFromCsv(csvRow, mapping));

    this._rows = rowsToAdd;
    this._uiState = UI_STATE_GRID;
    if (rowsToAdd.length < this._csvRows.length) {
      showToast(this, 'Row limit reached', `Only the first ${rowsToAdd.length} row(s) were imported`, 'warning');
    }
  }

  buildRowFromCsv(csvRow, mapping) {
    const row = this.createRow();
    const importedValues = mapCsvRowToValues(csvRow, this._csvHeaders, mapping, this._flatColumns);
    const values = { ...row.values, ...importedValues };
    if (CURRENT_USER_ID && this._layoutContext.objectInfo.fields.OwnerId && !values.OwnerId) {
      values.OwnerId = CURRENT_USER_ID;
    }
    return { ...row, touched: true, values };
  }

  handleFieldChange(event) {
    const clientId = Number(event.currentTarget.dataset.rowId);
    const { apiName, value } = event.detail;
    this.applyFieldValue(clientId, apiName, value);
  }

  // Table View (raw text cells, no per-type Lightning input) - coerced through the same
  // coerceCsvValue used for CSV/paste import, so a typed "true" or a loosely-formatted date
  // behaves identically whether it came from an import or straight from a Table View cell.
  handleRawCellChange(event) {
    const clientId = Number(event.currentTarget.dataset.rowId);
    const apiName = event.currentTarget.dataset.apiName;
    const column = this._flatColumns.find((c) => c.apiName === apiName);
    const value = coerceCsvValue(column, event.target.value);
    this.applyFieldValue(clientId, apiName, value);
  }

  applyFieldValue(clientId, apiName, value) {
    this._rows = this._rows.map((row) => {
      if (row.clientId !== clientId) return row;
      return { ...row, touched: true, errorMessage: '', values: { ...row.values, [apiName]: value } };
    });
    this._validationErrors = [];
  }

  handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  collectFieldViewErrors() {
    const fieldElements = this.template.querySelectorAll('c-inspector-native-form-field');
    const errors = [];
    fieldElements.forEach((fieldEl) => {
      const clientId = Number(fieldEl.dataset.rowId);
      const row = this._rows.find((r) => r.clientId === clientId);
      if (!row?.touched) return;
      if (fieldEl.reportValidity()) return;
      const rowNumber = this._rows.indexOf(row) + 1;
      errors.push({
        key: `${clientId}-${fieldEl.field.apiName}`,
        message: `Row ${rowNumber}: ${fieldEl.field.label} — ${fieldEl.getValidationMessage()}`
      });
    });
    return errors;
  }

  // Table View has no rendered per-field elements to ask for native constraint validation (format
  // checks like a malformed email aren't caught here), so this checks the one thing that matters
  // model-side instead: a required, visible, editable column left blank on a touched row.
  collectTableViewErrors() {
    const visibleApiNames = new Set(this.visibleFlatColumns.map((column) => column.apiName));
    const errors = [];
    this._rows.forEach((row, index) => {
      if (!row.touched) return;
      this._flatColumns
        .filter((column) => column.editable && visibleApiNames.has(column.apiName) && this.effectiveRequired(column))
        .forEach((column) => {
          const value = row.values[column.apiName];
          if (value !== null && value !== undefined && value !== '') return;
          errors.push({
            key: `${row.clientId}-${column.apiName}`,
            message: `Row ${index + 1}: ${column.label} — Complete this field.`
          });
        });
    });
    return errors;
  }

  /**
   * Validates every touched row's fields and builds a "Row N: Label — message" summary (shown
   * next to Save), in addition to the existing inline per-field validation state. On failure,
   * also raises a sticky (manually-dismissed) toast with the same summary so the user can copy
   * it out before fixing the rows.
   */
  reportValidity() {
    const errors = this.isTableView ? this.collectTableViewErrors() : this.collectFieldViewErrors();
    this._validationErrors = errors;
    if (errors.length) {
      showToast(
        this,
        'Fix the highlighted fields before saving',
        errors.map((err) => err.message).join('\n'),
        'error',
        'sticky'
      );
    }
    return errors.length === 0;
  }

  handleSaveClick() {
    if (this.touchedRowCount === 0 || !this.reportValidity()) return;
    this._uiState = UI_STATE_SAVE_OPTIONS;
    this._matchPreview = undefined;
    if (this._matchFieldApiNames.length) {
      this.loadMatchPreview();
    }
  }

  // Match preview (F5): resolves matches for every touched row up front (the same lookup save
  // uses per-batch) so the Save Options screen can show "N will create, M will update" before
  // anything is actually submitted. Non-critical - if it fails, saving still works normally, it
  // just won't show counts; the real match resolution happens again (and can fail loudly) at save.
  //
  // Not reentrant by design: if one is already running (e.g. Back then Save again before a
  // multi-batch preview finished), a second call is a no-op rather than overlapping it - both
  // would share the single-slot query bridge and race for it otherwise.
  async loadMatchPreview() {
    if (this.isLoadingMatchPreview) return;
    this.isLoadingMatchPreview = true;
    try {
      const touchedRows = this._rows.filter((row) => row.touched);
      let willUpdate = 0;
      for (let i = 0; i < touchedRows.length; i += this.batchSize) {
        const batch = touchedRows.slice(i, i + this.batchSize);
        // eslint-disable-next-line no-await-in-loop
        const matchedIdByClientId = await this.resolveMatches(batch);
        willUpdate += matchedIdByClientId.size;
      }
      this._matchPreview = { willCreate: touchedRows.length - willUpdate, willUpdate };
    } catch (error) {
      this._matchPreview = undefined;
    } finally {
      this.isLoadingMatchPreview = false;
    }
  }

  handleBackFromSaveOptions() {
    this._uiState = UI_STATE_GRID;
  }

  async handleConfirmSave() {
    const rowsToSave = this._rows.filter((row) => row.touched);
    if (rowsToSave.length === 0) return;

    const rowNumberByClientId = new Map(this._rows.map((row, index) => [row.clientId, index + 1]));
    const valuesByClientId = new Map(rowsToSave.map((row) => [row.clientId, row.values]));

    this.isSaving = true;
    this.errorMessage = '';
    this._allOrNothingIncomplete = false;
    this._saveResults = [];
    try {
      await this.saveRowsInBatches(rowsToSave, rowNumberByClientId, valuesByClientId);
    } catch (error) {
      this.setError(error);
    } finally {
      this.isSaving = false;
      // Show whatever was actually attempted, even after an error - a batch that already
      // completed before a later one threw is real, committed server-side state, not something
      // to hide. Only fall back to the grid untouched if nothing was attempted at all.
      if (this._saveResults.length > 0) {
        this._uiState = UI_STATE_RESULTS;
      }
    }
  }

  async saveRowsInBatches(rowsToSave, rowNumberByClientId, valuesByClientId) {
    for (let i = 0; i < rowsToSave.length; i += this.batchSize) {
      const batch = rowsToSave.slice(i, i + this.batchSize);
      // eslint-disable-next-line no-await-in-loop
      const matchedIdByClientId = await this.resolveMatches(batch);
      const mutation = buildUpsertMutation(this._layoutContext.objectApiName, this._flatColumns, batch, matchedIdByClientId);
      // eslint-disable-next-line no-await-in-loop
      const result = await executeMutation({ query: mutation });
      const batchResults = extractSaveResults(result, batch, matchedIdByClientId);
      // Applied immediately, per batch, rather than accumulated and only applied once every
      // batch finishes - so if a later batch throws (network error, timeout, ...), the rows this
      // batch already saved are reflected in _rows/_saveResults instead of silently vanishing
      // (which previously left them "touched" in the grid, risking a duplicate create on retry).
      this.applyBatchResults(batchResults, rowNumberByClientId, valuesByClientId);
      if (this._saveMode === SAVE_MODE_ALL_OR_NOTHING && batchResults.some((r) => !r.success)) {
        // Each row is an independent DML operation under the hood - a mid-batch failure can't be
        // rolled back without a transactional API (Composite Graph/Apex), which this component
        // deliberately avoids. The best we can honor is to stop attempting further rows and be
        // explicit in the results report about what was already committed.
        this._allOrNothingIncomplete = true;
        break;
      }
    }
  }

  // A row's own known existingRecordId (query mode) always wins over a match-fields lookup - it's
  // authoritative, not a guess. The lookup only runs for rows that don't already have one, so in
  // query mode (every row has a known Id) it's naturally skipped entirely - no query-mode-specific
  // branching needed here beyond that.
  async resolveMatches(batch) {
    const matchedIdByClientId = new Map(
      batch.filter((row) => row.existingRecordId).map((row) => [row.clientId, row.existingRecordId])
    );
    const rowsNeedingLookup = batch.filter((row) => !row.existingRecordId);
    if (this._matchFieldApiNames.length && rowsNeedingLookup.length) {
      const query = buildMatchQuery(this._layoutContext.objectApiName, this._matchFieldApiNames, this._flatColumns, rowsNeedingLookup);
      if (query) {
        const data = await this.runGraphqlQuery(query);
        const lookedUpIds = extractMatchedIds({ data }, this._layoutContext.objectApiName, this._matchFieldApiNames, rowsNeedingLookup);
        lookedUpIds.forEach((id, clientId) => matchedIdByClientId.set(clientId, id));
      }
    }
    return matchedIdByClientId;
  }

  applyBatchResults(results, rowNumberByClientId, valuesByClientId) {
    const succeededClientIds = new Set(results.filter((r) => r.success).map((r) => r.clientId));
    const failedByClientId = new Map(results.filter((r) => !r.success).map((r) => [r.clientId, r.errorMessage]));

    this._rows = this._rows
      .filter((row) => !succeededClientIds.has(row.clientId))
      .map((row) => (failedByClientId.has(row.clientId) ? { ...row, errorMessage: failedByClientId.get(row.clientId) } : row));

    this._saveResults = [
      ...this._saveResults,
      ...results.map((result) => ({
        clientId: result.clientId,
        rowNumber: rowNumberByClientId.get(result.clientId),
        operation: result.operation,
        success: result.success,
        detail: result.success ? result.recordId : result.errorMessage,
        recordName: this.getRecordDisplayName(valuesByClientId.get(result.clientId)),
        values: valuesByClientId.get(result.clientId)
      }))
    ];
  }

  // Joins whatever the object's own name field(s) are (Account: Name; Contact/Lead: FirstName +
  // LastName; and so on - objectInfo.nameFields is the platform's own list of which fields those
  // are, so this doesn't need to special-case any particular object) from the values actually
  // submitted for this row. Blank if the object has no name fields, or none of them were part of
  // the layout shown - same "don't show something misleading" spirit as everywhere else in this
  // component.
  getRecordDisplayName(values) {
    const nameFields = this._layoutContext?.objectInfo?.nameFields ?? [];
    return nameFields
      .map((apiName) => values?.[apiName])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ')
      .trim();
  }

  // Bulk delete: a real, immediate, irreversible write against the org (unlike the per-row remove
  // icon, which only ever touches the local grid) - gated behind an explicit confirmation dialog
  // before anything is sent, on top of the Edit-mode-only gating isDeleteSelectedDisabled already
  // applies.
  async handleDeleteSelectedClick() {
    if (this.isDeleteSelectedDisabled) return;
    const count = this.selectedRowCount;
    const confirmed = await LightningConfirm.open({
      label: 'Delete Records',
      message: `Delete ${count} record${count === 1 ? '' : 's'}? This can't be undone.`,
      variant: 'headerless'
    });
    if (!confirmed) return;
    await this.deleteSelectedRows();
  }

  async deleteSelectedRows() {
    const rowsToDelete = this._rows.filter((row) => this._selectedClientIds.has(row.clientId) && row.existingRecordId);
    if (rowsToDelete.length === 0) return;

    const rowNumberByClientId = new Map(this._rows.map((row, index) => [row.clientId, index + 1]));
    const valuesByClientId = new Map(rowsToDelete.map((row) => [row.clientId, row.values]));

    this.isDeleting = true;
    this.errorMessage = '';
    this._allOrNothingIncomplete = false;
    this._saveResults = [];
    try {
      for (let i = 0; i < rowsToDelete.length; i += this.batchSize) {
        const batch = rowsToDelete.slice(i, i + this.batchSize);
        const mutation = buildBulkDeleteMutation(this._layoutContext.objectApiName, batch);
        // eslint-disable-next-line no-await-in-loop
        const result = await executeMutation({ query: mutation });
        const batchResults = extractDeleteResults(result, batch);
        this.applyDeleteResults(batchResults, rowNumberByClientId, valuesByClientId);
      }
    } catch (error) {
      this.setError(error);
    } finally {
      this.isDeleting = false;
      if (this._saveResults.length > 0) {
        this._uiState = UI_STATE_RESULTS;
      }
    }
  }

  applyDeleteResults(results, rowNumberByClientId, valuesByClientId) {
    const succeededClientIds = new Set(results.filter((r) => r.success).map((r) => r.clientId));

    this._rows = this._rows.filter((row) => !succeededClientIds.has(row.clientId));
    this._selectedClientIds = new Set([...this._selectedClientIds].filter((clientId) => !succeededClientIds.has(clientId)));

    this._saveResults = [
      ...this._saveResults,
      ...results.map((result) => ({
        clientId: result.clientId,
        rowNumber: rowNumberByClientId.get(result.clientId),
        operation: 'delete',
        success: result.success,
        detail: result.success ? result.recordId : result.errorMessage,
        recordName: this.getRecordDisplayName(valuesByClientId.get(result.clientId)),
        values: valuesByClientId.get(result.clientId)
      }))
    ];
  }

  handleBackToGrid() {
    this._uiState = UI_STATE_GRID;
  }

  handleViewRecord(event) {
    event.preventDefault();
    navigateToRecord(this, event.currentTarget.dataset.recordId, 'view');
  }

  handleDone() {
    const createdRecordIds = this._saveResults
      .filter((result) => result.success && result.operation === 'create')
      .map((result) => result.detail);
    const updatedRecordIds = this._saveResults
      .filter((result) => result.success && result.operation === 'update')
      .map((result) => result.detail);
    const deletedRecordIds = this._saveResults
      .filter((result) => result.success && result.operation === 'delete')
      .map((result) => result.detail);
    this.dispatchEvent(new CustomEvent('done', { detail: { createdRecordIds, updatedRecordIds, deletedRecordIds } }));
  }
}
