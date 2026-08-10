import LightningModal from 'lightning/modal';
import { api } from 'lwc';

/**
 * New/Edit modal for one related list record - a thin wrapper around the base
 * `lightning-record-form` with `layout-type="Full"`, so it shows exactly the fields the object's
 * real page layout shows (the same "default New/Edit behavior" the standard related list gives
 * you), including its own built-in Save/Cancel buttons - not a hand-picked field subset.
 *
 * The parent relationship field isn't pre-filled here - `lightning-record-form` doesn't support
 * default field values at all (only the lower-level `lightning-record-edit-form` does, which would
 * mean giving up the automatic layout in exchange). If the parent field is part of the child
 * object's layout, it's shown like any other field; the caller already scoped the record list to
 * this parent, so leaving it to the standard form to handle is the more honest "default behavior"
 * choice than silently reintroducing a hidden, non-standard field.
 *
 * Resolves `true` (caller should refresh the list) on successful save, `null` on Cancel.
 * @alias ReloadedListRecordForm
 * @extends LightningModal
 * @hideconstructor
 */
export default class ReloadedListRecordForm extends LightningModal {
  @api objectApiName;
  @api objectLabel;
  @api recordId; // undefined/null = create mode

  get isEditMode() {
    return Boolean(this.recordId);
  }

  get modalLabel() {
    const label = this.objectLabel || this.objectApiName;
    return this.isEditMode ? `Edit ${label}` : `New ${label}`;
  }

  handleSuccess() {
    this.close(true);
  }

  handleCancel() {
    this.close(null);
  }
}
