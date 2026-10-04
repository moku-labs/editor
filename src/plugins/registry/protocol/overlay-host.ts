/**
 * @file Protocol — the DOM marker of the in-game overlay. overlay sets it on its host element; the
 * bridge's tap watch skips any event whose path holds it, so input on the overlay is not a game
 * tap. Runtime-free: one string constant.
 */

/**
 * The attribute that marks the overlay host element.
 *
 * @example
 * ```ts
 * const onOverlay = event.composedPath().some(
 *   node => node instanceof Element && node.hasAttribute(HOST_ATTRIBUTE)
 * );
 * ```
 */
export const HOST_ATTRIBUTE = "data-moku-editor-overlay";
