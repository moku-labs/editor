/**
 * @file renderView view — the keyboard map of Mission control (spec 09 § M16 keys): → steps a
 * frame, Shift+→ jumps a spike, Space toggles live, Esc closes a popover before it clears the
 * selection. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract
 * the other Mission control units build against; build wave 3 (RV1) writes the bodies.
 */
import { notBuilt } from "../stub";

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

/**
 * What a key does.
 *
 * @param _event - The keydown.
 * @param _popoverOpen - A popover is open (Esc closes it first).
 * @returns The action; undefined for a key Mission control does not take.
 * @throws {Error} Until build wave 3: "renderView view/keyOf is not built yet".
 */
export function keyOf(_event: KeyInput, _popoverOpen: boolean): MissionKey | undefined {
  return notBuilt("view/keyOf", 3);
}
