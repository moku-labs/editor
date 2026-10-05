/**
 * @file Shared view module — the one check for "this element types text". The workspace keymap
 * uses it to let single keys reach a field; gameView uses it to keep Escape for a focused field.
 */

/**
 * Elements in which single keys type text.
 */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * True when the event target types text (an input, a textarea, a select, contenteditable).
 *
 * @param target - The event target.
 * @returns Whether single keys belong to the field.
 * @example
 * ```ts
 * const field = document.createElement("input");
 * isEditableTarget(field); // true
 * isEditableTarget(document.body); // false
 * isEditableTarget(null); // false
 * ```
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (globalThis.Element === undefined || !(target instanceof Element)) return false;
  return target.closest(EDITABLE) !== null;
}
