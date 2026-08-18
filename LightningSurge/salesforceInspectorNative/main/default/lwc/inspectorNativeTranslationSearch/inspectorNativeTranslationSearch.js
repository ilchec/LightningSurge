import search from '@salesforce/apex/InspectorNativeTranslationSearch.search';
import { buildResultSetupUrl, groupResultsByType } from 'c/inspectorNativeTranslationSearchUtils';
import { NavigationMixin } from 'lightning/navigation';
import { LightningElement } from 'lwc';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

/**
 * Translation Finder tab: type text and see every place in the org's metadata it could be - Custom
 * Label, Object, Field (label or help text), or Picklist Value - grouped by type, so there's no need
 * to already know what you're looking for before Translation Workbench's own picker-based UI can
 * show it to you. Read-only lookup via InspectorNativeTranslationSearch.search - no per-item deep
 * link into Translation Workbench itself exists (it isn't URL-addressable per item), so Object/Field/
 * Picklist Value results instead link to that item's own Setup detail page
 * (inspectorNativeTranslationSearchUtils.buildResultSetupUrl), the same link-out Schema Explorer
 * already offers.
 * @alias InspectorNativeTranslationSearch
 * @extends LightningElement
 * @hideconstructor
 */
export default class InspectorNativeTranslationSearch extends NavigationMixin(LightningElement) {
  searchTerm = '';
  errorText;
  isSearching = false;

  _hasSearched = false;
  _results = [];
  _searchTimer;

  get trimmedSearchTerm() {
    return this.searchTerm.trim();
  }

  get isSearchTermTooShort() {
    return this.trimmedSearchTerm.length > 0 && this.trimmedSearchTerm.length < MIN_SEARCH_LENGTH;
  }

  // Display-ready section flags computed here (component layer), not in the pure grouping util -
  // same split as every other *Utils/*component pair in this app (e.g. FLS Matrix's cellClass,
  // User Comparison's rowClass) - LWC templates can't compare section.itemType to a string inline.
  get groupedResults() {
    return groupResultsByType(this._results).map((section) => ({
      ...section,
      isCustomLabelSection: section.itemType === 'Custom Label',
      isObjectSection: section.itemType === 'Object',
      items: section.items.map((item, index) => ({
        ...item,
        key: `${section.itemType}-${index}`,
        setupUrl: buildResultSetupUrl(item)
      }))
    }));
  }

  get hasResults() {
    return this._results.length > 0;
  }

  get hasSearchedWithNoMatches() {
    return this._hasSearched && !this.isSearching && !this.hasResults;
  }

  handleSearchChange(event) {
    this.searchTerm = event.target.value;
    this.errorText = undefined;
    window.clearTimeout(this._searchTimer);
    if (this.trimmedSearchTerm.length < MIN_SEARCH_LENGTH) {
      this._results = [];
      this._hasSearched = false;
      this.isSearching = false;
      return;
    }
    this._searchTimer = window.setTimeout(() => this.runSearch(), SEARCH_DEBOUNCE_MS);
  }

  async runSearch() {
    this.isSearching = true;
    const searchTerm = this.trimmedSearchTerm;
    try {
      const results = await search({ searchTerm });
      // The debounced timer can resolve after the user has kept typing past it - only apply a
      // result if it still matches what's currently in the box, so a slow response for an earlier,
      // shorter term can never clobber what's on screen for the current one.
      if (searchTerm === this.trimmedSearchTerm) {
        this._results = results;
      }
    } catch (error) {
      this._results = [];
      this.errorText = error?.body?.message ?? error?.message ?? 'Unknown error searching';
    } finally {
      if (searchTerm === this.trimmedSearchTerm) {
        this.isSearching = false;
        this._hasSearched = true;
      }
    }
  }

  // standard__webPage (rather than a typed PageReference) is the only option here - same reasoning
  // as Schema Explorer's own handleEditFieldClick, there's no dedicated NavigationMixin page type
  // for "a specific field/object's Setup detail page."
  handleResultSetupClick(event) {
    const url = event.currentTarget.dataset.setupUrl;
    if (!url) {
      return;
    }
    this[NavigationMixin.Navigate]({
      type: 'standard__webPage',
      attributes: { url }
    });
  }
}
