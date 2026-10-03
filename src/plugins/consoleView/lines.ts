/**
 * @file consoleView plugin — lines.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { EntryLine, FrameMark, TraceEntry } from "./types";

/**
 * Skeleton stub for `toEntryLine`; implemented in its wave.
 *
 * @param _entry - The entry.
 * @param _key - The key.
 * @param _frame - The frame.
 * @param _summaryChars - The summaryChars.
 * @example
 * ```ts
 * toEntryLine();
 * ```
 */
export function toEntryLine(
  _entry: TraceEntry,
  _key: number,
  _frame: FrameMark | undefined,
  _summaryChars: number
): EntryLine {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `sourceOf`; implemented in its wave.
 *
 * @param _entry - The entry.
 * @example
 * ```ts
 * sourceOf();
 * ```
 */
export function sourceOf(_entry: TraceEntry): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `messageOf`; implemented in its wave.
 *
 * @param _entry - The entry.
 * @param _summaryChars - The summaryChars.
 * @example
 * ```ts
 * messageOf();
 * ```
 */
export function messageOf(_entry: TraceEntry, _summaryChars: number): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `summarize`; implemented in its wave.
 *
 * @param _data - The data.
 * @param _max - The max.
 * @example
 * ```ts
 * summarize();
 * ```
 */
export function summarize(_data: Json | undefined, _max: number): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `isTraceEntry`; implemented in its wave.
 *
 * @param _value - The value.
 * @example
 * ```ts
 * isTraceEntry();
 * ```
 */
export function isTraceEntry(_value: unknown): _value is TraceEntry {
  throw new Error("not implemented");
}
