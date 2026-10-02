/**
 * @file Protocol — toWireValue: any value to wire-safe Json ($map, $set, $error tags; cycles,
 * functions, symbols and bigint rejected with -32006).
 */
import type { Json } from "./types";

/**
 * Converts a value to Json by the toWireValue table (01-registry); throws -32006 with the path.
 *
 * @param _value - Any value a door returned.
 * @example
 * ```ts
 * toWireValue(new Map([["a", 1]])); // { $map: [["a", 1]] }
 * ```
 */
export function toWireValue(_value: unknown): Json {
  throw new Error("not implemented");
}
