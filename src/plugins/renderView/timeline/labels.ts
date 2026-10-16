/**
 * @file renderView timeline — the painters' cached label strings (spec 09 § M11): a label is
 * built once per key (flag text, axis labels, GC labels), never per paint. Typed stub of build
 * wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units
 * build against; build wave 3 (RV2) writes the bodies.
 */
import { notBuilt } from "../stub";

/**
 * The label of a key, built once.
 *
 * @param _cache - The painter's cache.
 * @param _key - The label's key.
 * @param _make - Builds the label the first time.
 * @returns The label.
 * @throws {Error} Until build wave 3: "renderView timeline/cachedLabel is not built yet".
 */
export function cachedLabel(
  _cache: Map<string, string>,
  _key: string,
  _make: () => string
): string {
  return notBuilt("timeline/cachedLabel", 3);
}
