/**
 * @file consoleView plugin — filter.ts (skeleton stubs, implemented in its wave).
 */
import type { LevelCounts, LevelFilter, LogLine } from "./types";

/**
 * Skeleton stub for `visibleLines`; implemented in its wave.
 *
 * @param _lines - The lines.
 * @param _level - The level.
 * @param _query - The query.
 * @example
 * ```ts
 * visibleLines();
 * ```
 */
export function visibleLines(
  _lines: readonly LogLine[],
  _level: LevelFilter,
  _query: string
): readonly LogLine[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `countLevels`; implemented in its wave.
 *
 * @param _lines - The lines.
 * @example
 * ```ts
 * countLevels();
 * ```
 */
export function countLevels(_lines: readonly LogLine[]): LevelCounts {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `splitHits`; implemented in its wave.
 *
 * @param _text - The text.
 * @param _query - The query.
 * @example
 * ```ts
 * splitHits();
 * ```
 */
export function splitHits(
  _text: string,
  _query: string
): readonly { readonly text: string; readonly hit: boolean }[] {
  throw new Error("not implemented");
}
