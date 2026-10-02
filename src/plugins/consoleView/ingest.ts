/**
 * @file consoleView plugin — ingest.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { Config, ConsoleState, IngestResult } from "./types";

/**
 * Skeleton stub for `ingestTrace`; implemented in its wave.
 *
 * @param _state - The state.
 * @param _value - The value.
 * @param _frame - The frame.
 * @param _config - The config.
 * @example
 * ```ts
 * ingestTrace();
 * ```
 */
export function ingestTrace(
  _state: ConsoleState,
  _value: Json,
  _frame: number | undefined,
  _config: Readonly<Config>
): IngestResult {
  throw new Error("not implemented");
}
