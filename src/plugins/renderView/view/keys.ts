/**
 * @file renderView view — the keyboard map of Mission control (spec 09 § M8 Keyboard): on the
 * focused timeline or overview → / ← step a frame, Shift + → / ← jump to the next or previous spike
 * group, Space pauses or goes live, Esc closes a popover first and only then clears the selection.
 */

/**
 * The parts of a keydown Mission control reads.
 *
 * @example
 * ```ts
 * const input: KeyInput = { key: "ArrowRight", shiftKey: true }; // jump to the next spike
 * ```
 */
export type KeyInput = { readonly key: string; readonly shiftKey: boolean };

/**
 * What a key does in Mission control.
 *
 * @example
 * ```ts
 * const key: MissionKey = { kind: "jump", dir: 1 }; // Shift+→
 * ```
 */
export type MissionKey =
  | { readonly kind: "step"; readonly dir: 1 | -1 }
  | { readonly kind: "jump"; readonly dir: 1 | -1 }
  | { readonly kind: "toggle-live" }
  | { readonly kind: "close-popover" }
  | { readonly kind: "clear-selection" };

/** The direction of each arrow key. */
const ARROWS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * What a key does.
 *
 * @param event - The keydown.
 * @param popoverOpen - A popover is open (Esc closes it first).
 * @returns The action; undefined for a key Mission control does not take.
 * @example
 * ```ts
 * keyOf({ key: "Escape", shiftKey: false }, true); // { kind: "close-popover" }
 * ```
 */
export function keyOf(event: KeyInput, popoverOpen: boolean): MissionKey | undefined {
  const dir = ARROWS[event.key];
  if (dir !== undefined) return { kind: event.shiftKey ? "jump" : "step", dir };
  if (event.key === " " || event.key === "Spacebar") return { kind: "toggle-live" };
  if (event.key === "Escape") return { kind: popoverOpen ? "close-popover" : "clear-selection" };
  return undefined;
}
