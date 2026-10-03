/**
 * @file consoleView plugin — ingest of a game.log value (pure over state): reload detection by
 * the first-entry fingerprint and the consumed count, the F6 meta rows, incremental append and
 * the maxLines trim.
 */
import type { Json } from "../registry/protocol";
import { frameMarkOf, isTraceEntry, toEntryLine } from "./lines";
import type { Config, ConsoleState, IngestResult, LogLine, MetaText, TraceEntry } from "./types";

/**
 * The F6 meta row of a reload with Preserve log off.
 */
const RELOAD_CLEARED: MetaText =
  "Log cleared: the game page reloaded. Turn on Preserve log to keep it.";

/**
 * The F6 meta row of a reload with Preserve log on.
 */
const RELOAD_PRESERVED: MetaText = "Game page reloaded · log preserved";

/**
 * Appends one line and drops the oldest lines above `maxLines`.
 *
 * @param state - consoleView state.
 * @param line - The new line.
 * @param maxLines - Most lines kept.
 * @example
 * ```ts
 * pushLine(ctx.state, line, 5000); // ctx.state.lines.at(-1) === line
 * ```
 */
export function pushLine(state: ConsoleState, line: LogLine, maxLines: number): void {
  state.lines.push(line);
  if (state.lines.length > maxLines) state.lines = state.lines.slice(-maxLines);
}

/**
 * Appends a meta row with the next key.
 *
 * @param state - consoleView state.
 * @param text - The meta text.
 * @param maxLines - Most lines kept.
 * @example
 * ```ts
 * pushMeta(ctx.state, "Console cleared", 5000); // a meta row with the next key
 * ```
 */
export function pushMeta(state: ConsoleState, text: MetaText, maxLines: number): void {
  pushLine(state, { kind: "meta", key: state.nextKey, text, addedAt: Date.now() }, maxLines);
  state.nextKey += 1;
}

/**
 * Whether a trace belongs to another game instance than the one ingested so far.
 *
 * @param state - consoleView state.
 * @param length - The trace length.
 * @param first - The first trace entry, if valid.
 * @returns True on a game page reload.
 * @example
 * ```ts
 * isNewInstance(state, 2, undefined); // true once a game was ingested: the trace lost its first entry
 * ```
 */
function isNewInstance(
  state: ConsoleState,
  length: number,
  first: TraceEntry | undefined
): boolean {
  const { instance } = state;
  if (instance === undefined) return false;
  return (
    length < state.consumed ||
    first === undefined ||
    first.ts !== instance.ts ||
    first.event !== instance.event
  );
}

/**
 * Ingests one game.log value: a reload adds its meta row (and clears the lines unless Preserve
 * log is on), then the entries past `consumed` become lines, framed exactly from `data.frame` or
 * "at or before" the arrival frame. Items that are not trace entries are skipped.
 *
 * @param state - consoleView state.
 * @param value - The game.log value (the whole trace).
 * @param frame - The link frame at which the value arrived, if known.
 * @param config - Resolved plugin config.
 * @returns Whether the lines changed; `invalid` when the value is not an array.
 * @example
 * ```ts
 * ingestTrace(ctx.state, designLog, 1840, ctx.config); // { changed: true }, 8 lines
 * ```
 */
export function ingestTrace(
  state: ConsoleState,
  value: Json,
  frame: number | undefined,
  config: Readonly<Config>
): IngestResult {
  if (!Array.isArray(value)) return { changed: false, invalid: true };

  const head: unknown = value[0];
  const first = isTraceEntry(head) ? head : undefined;
  let changed = false;

  if (isNewInstance(state, value.length, first)) {
    if (!state.preserve) state.lines = [];
    pushMeta(state, state.preserve ? RELOAD_PRESERVED : RELOAD_CLEARED, config.maxLines);
    state.consumed = 0;
    state.selected = undefined;
    changed = true;
  }
  state.instance = first === undefined ? undefined : { ts: first.ts, event: first.event };

  const fresh: unknown[] = value.slice(state.consumed);
  state.consumed = value.length;
  for (const entry of fresh) {
    if (!isTraceEntry(entry)) continue;
    const line = toEntryLine(entry, state.nextKey, frameMarkOf(entry, frame), config.summaryChars);
    state.nextKey += 1;
    pushLine(state, line, config.maxLines);
    changed = true;
  }
  return { changed };
}
