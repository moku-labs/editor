/**
 * @file renderView timeline — the canvas colours (spec 09 § M11): the scope root's custom
 * properties resolved once per theme into one palette object every painter reuses. Typed stub
 * of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV2) writes the bodies.
 */
import { notBuilt } from "../stub";

/**
 * The colours the painters use, resolved from the workspace tokens.
 *
 * @example
 * ```ts
 * const palette: MissionPalette = { ink: "#1c1b19", muted: "#8a867c", line: "#e3e0d8", accent: "#5b5bd6", live: "#2f9e44", warn: "#d9822b", error: "#d64545" };
 * ```
 */
export type MissionPalette = {
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly accent: string;
  readonly live: string;
  readonly warn: string;
  readonly error: string;
};

/**
 * Reads the palette from the root's computed custom properties (once per theme).
 *
 * @param _root - The Render workspace's scope root.
 * @returns The palette.
 * @throws {Error} Until build wave 3: "renderView timeline/readPalette is not built yet".
 */
export function readPalette(_root: Element): MissionPalette {
  return notBuilt("timeline/readPalette", 3);
}
