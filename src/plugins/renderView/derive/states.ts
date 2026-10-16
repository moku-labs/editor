/**
 * @file renderView derive — the overlay a graph shows instead of data (spec 09 § M9): not
 * started, waiting, no monitor, a section off, in that priority. Pure. Typed stub of build wave
 * 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV3) writes the bodies.
 */
import { notBuilt } from "../stub";

/**
 * What is known of the source when a graph picks its overlay: a local preview or device is running,
 * its first second arrived, its agent has the Mission control feeds, the graph's section is on.
 *
 * @example
 * ```ts
 * const input: OverlayInput = { started: true, second: false, monitored: true, sectionOn: true }; // "waiting"
 * ```
 */
export type OverlayInput = {
  readonly started: boolean;
  readonly second: boolean;
  readonly monitored: boolean;
  readonly sectionOn: boolean;
};

/**
 * What a graph shows instead of data.
 *
 * @example
 * ```ts
 * const overlay: MissionOverlay = "waiting"; // "Waiting for the first frames from Galaxy A26"
 * ```
 */
export type MissionOverlay = "not-started" | "waiting" | "no-monitor" | "section-off" | undefined;

/**
 * The overlay, by priority.
 *
 * @param _input - What is known of the source.
 * @returns The overlay; undefined when the graph shows data.
 * @throws {Error} Until build wave 3: "renderView derive/overlayOf is not built yet".
 */
export function overlayOf(_input: OverlayInput): MissionOverlay {
  return notBuilt("derive/overlayOf", 3);
}
