/**
 * @file consoleView plugin — pure filtering: the visible lines of a level and query, the counts
 * per level and the search-hit parts of a text.
 */
import type { LevelCounts, LevelFilter, LogLine } from "./types";

/**
 * Regex metacharacters, escaped so a query matches literally.
 */
const SPECIAL = /[$()*+.?[\\\]^{|}]/g;

/**
 * The lines the table shows: entries of the level (`all` = every entry incl. debug) whose
 * `source + " " + message` contains the query, case-insensitive; meta rows always.
 *
 * @param lines - Every held line.
 * @param level - The level filter.
 * @param query - The search text.
 * @returns The visible lines, in order.
 * @example
 * ```ts
 * visibleLines([{ kind: "meta", key: 1, text: "Console cleared", addedAt: 0 }], "warn", "x").length; // 1
 * ```
 */
export function visibleLines(
  lines: readonly LogLine[],
  level: LevelFilter,
  query: string
): readonly LogLine[] {
  const needle = query.trim().toLowerCase();
  return lines.filter(line => {
    if (line.kind === "meta") return true;
    if (level !== "all" && line.level !== level) return false;
    return needle === "" || `${line.source} ${line.message}`.toLowerCase().includes(needle);
  });
}

/**
 * Entry counts per level plus `all`; meta rows are not counted.
 *
 * @param lines - Every held line.
 * @returns The counts.
 * @example
 * ```ts
 * countLevels([]); // { all: 0, debug: 0, info: 0, warn: 0, error: 0 }
 * ```
 */
export function countLevels(lines: readonly LogLine[]): LevelCounts {
  const counts: LevelCounts = { all: 0, debug: 0, info: 0, warn: 0, error: 0 };
  for (const line of lines) {
    if (line.kind === "meta") continue;
    counts.all += 1;
    counts[line.level] += 1;
  }
  return counts;
}

/**
 * Splits a text into alternating plain and hit parts for the query (case-insensitive, regex
 * characters literal). Empty parts are left out.
 *
 * @param text - The cell text.
 * @param query - The search text.
 * @returns The parts, in order.
 * @example
 * ```ts
 * splitHits("missing texture", "TEX"); // [{ text: "missing ", hit: false }, { text: "tex", hit: true }, { text: "ture", hit: false }]
 * ```
 */
export function splitHits(
  text: string,
  query: string
): readonly { readonly text: string; readonly hit: boolean }[] {
  const needle = query.trim();
  if (needle === "") return [{ text, hit: false }];

  const parts: { text: string; hit: boolean }[] = [];
  const pattern = new RegExp(needle.replaceAll(SPECIAL, String.raw`\$&`), "giu");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length === 0 ? [{ text, hit: false }] : parts;
}

/**
 * Empty state when no game was ever connected and nothing is held.
 */
export const NO_GAME_TEXT = "No game connected. The log starts when a game connects.";

/**
 * Empty state when a game is connected but logged nothing yet.
 */
export const EMPTY_LOG_TEXT = "The log is empty. Lines appear here as the game logs.";

/**
 * Empty state when entries exist but the filter hides them all.
 */
export const NO_MATCH_TEXT = "No lines match this filter.";

/**
 * The Console's own F5 empty-state text: no entry held → "No game connected…" until a game was
 * connected, then "The log is empty…"; entries held but none visible → "No lines match this
 * filter."; otherwise none.
 *
 * @param lines - Every held line.
 * @param visible - The visible lines.
 * @param connected - Whether a game was ever connected.
 * @returns The text, or undefined when the table has entries to show.
 * @example
 * ```ts
 * emptyStateOf([], [], false); // "No game connected. The log starts when a game connects."
 * ```
 */
export function emptyStateOf(
  lines: readonly LogLine[],
  visible: readonly LogLine[],
  connected: boolean
): string | undefined {
  if (!lines.some(line => line.kind === "entry")) return connected ? EMPTY_LOG_TEXT : NO_GAME_TEXT;
  return visible.some(line => line.kind === "entry") ? undefined : NO_MATCH_TEXT;
}
