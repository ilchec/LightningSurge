import { LightningElement, api } from 'lwc';

/**
 * Reusable Previous/Next pagination bar for the expanded related list view - deliberately no
 * First/Last: at 15 rows/page a related list's page count stays small enough that jumping straight
 * to the last page isn't worth the extra buttons.
 * @alias ReloadedListPagination
 * @extends LightningElement
 * @hideconstructor
 *
 * @example
 * <c-reloaded-list-pagination
 *   pagination-label={paginationLabel}
 *   is-first-page={isFirstPage}
 *   is-last-page={isLastPage}
 * ></c-reloaded-list-pagination>
 */
export default class ReloadedListPagination extends LightningElement {
  @api paginationLabel = '';
  @api isFirstPage = false;
  @api isLastPage = false;

  handlePrevious() {
    this.dispatchEvent(new CustomEvent('previous'));
  }

  handleNext() {
    this.dispatchEvent(new CustomEvent('next'));
  }
}
