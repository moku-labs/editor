/**
 * @file consoleView plugin — pure line builders: the source and message of a trace entry, the
 * inline data summary, the trace-entry guard, frame marks, the command error line of D1 and the
 * drawer time format.
 */

import type { Json, LinkStatus } from "../registry/protocol";
import { bareMessage } from "../registry/protocol";
import type { RanEvent } from "../workspace/types";
import type { EntryLine, FrameMark, LogLevel, TraceEntry } from "./types";

/**
 * A source head: a letter, then up to 23 word characters, dots or dashes.
 */
const SOURCE_HEAD = /^[A-Za-z][\w.-]{0,23}$/;

/**
 * The log levels of a trace entry.
 */
const LEVELS: ReadonlySet<string> = new Set<LogLevel>(["debug", "info", "warn", "error"]);

/**
 * The separator between a message and string data.
 */
const DOT = " · ";

/**
 * The source head and the rest of an event, when the head is a valid source.
 *
 * @param event - The raw event.
 * @returns The head and the trimmed rest, or undefined.
 * @example
 * ```ts
 * splitEvent("assets: missing texture"); // { head: "assets", rest: "missing texture" }
 * ```
 */
function splitEvent(event: string): { head: string; rest: string } | undefined {
  const colon = event.indexOf(":");
  if (colon === -1) return undefined;

  const head = event.slice(0, colon).trim();
  return SOURCE_HEAD.test(head) ? { head, rest: event.slice(colon + 1).trim() } : undefined;
}

/**
 * The separator and the text of a data summary.
 *
 * @param data - The entry data.
 * @param max - Characters of non-string JSON shown before the ellipsis.
 * @returns The parts, or undefined without data.
 * @example
 * ```ts
 * summaryParts({ key: "ui.gear" }, 160); // { separator: " ", text: '{"key":"ui.gear"}' }
 * ```
 */
function summaryParts(
  data: Json | undefined,
  max: number
): { separator: string; text: string } | undefined {
  if (data === undefined) return undefined;
  if (typeof data === "string") return { separator: DOT, text: data };

  const text = JSON.stringify(data);
  return { separator: " ", text: text.length > max ? `${text.slice(0, max)}…` : text };
}

/**
 * The source of an entry: the event head before the first colon when it looks like a source,
 * else the entry's plugin, else "game".
 *
 * @param entry - A trace entry.
 * @returns The source.
 * @example
 * ```ts
 * sourceOf({ level: "warn", event: "assets: missing texture", ts: 1 }); // "assets"
 * ```
 */
export function sourceOf(entry: TraceEntry): string {
  return splitEvent(entry.event)?.head ?? entry.plugin ?? "game";
}

/**
 * The inline data summary: string data joined with " · ", other JSON stringified and cut at
 * `max` characters with "…", nothing without data.
 *
 * @param data - The entry data.
 * @param max - Characters of non-string JSON shown.
 * @returns The summary with its leading separator.
 * @example
 * ```ts
 * summarize({ key: "ui.gear" }, 160); // ' {"key":"ui.gear"}'
 * ```
 */
export function summarize(data: Json | undefined, max: number): string {
  const parts = summaryParts(data, max);
  return parts === undefined ? "" : parts.separator + parts.text;
}

/**
 * The message of an entry: the event after its source (or the whole event) plus the data
 * summary.
 *
 * @param entry - A trace entry.
 * @param summaryChars - Characters of non-string data shown.
 * @returns The message.
 * @example
 * ```ts
 * messageOf({ level: "warn", event: "assets: missing texture", data: { key: "ui.gear" }, ts: 1 }, 160); // 'missing texture {"key":"ui.gear"}'
 * ```
 */
export function messageOf(entry: TraceEntry, summaryChars: number): string {
  const rest = splitEvent(entry.event)?.rest ?? entry.event;
  const parts = summaryParts(entry.data, summaryChars);
  if (parts === undefined) return rest;
  return rest === "" ? parts.text : rest + parts.separator + parts.text;
}

/**
 * Whether a value is a plain object (not null, not an array).
 *
 * @param value - Any value.
 * @returns True for `{ … }`.
 * @example
 * ```ts
 * isPlainObject([1]); // false
 * ```
 */
function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is one of the four log levels.
 *
 * @param value - Any value.
 * @returns True for "debug", "info", "warn" or "error".
 * @example
 * ```ts
 * isLevel("trace"); // false
 * ```
 */
function isLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LEVELS.has(value);
}

/**
 * Whether a wire value is one game.log entry.
 *
 * @param value - Any value.
 * @returns True for `{ level, event, ts, data?, plugin? }`.
 * @example
 * ```ts
 * isTraceEntry({ level: "info", event: "a" }); // false: no ts
 * ```
 */
export function isTraceEntry(value: unknown): value is TraceEntry {
  if (!isPlainObject(value)) return false;

  const { level, event, ts, plugin } = value;
  const pluginOk = plugin === undefined || typeof plugin === "string";
  return isLevel(level) && typeof event === "string" && typeof ts === "number" && pluginOk;
}

/**
 * The frame mark of an entry: exact from a numeric `data.frame`, else "at or before" the frame
 * at which the value arrived, else none.
 *
 * @param entry - A trace entry.
 * @param frame - The arrival frame, if known.
 * @returns The mark, or undefined.
 * @example
 * ```ts
 * frameMarkOf({ level: "info", event: "a", data: { frame: 1778 }, ts: 1 }, 1840); // { value: 1778, exact: true }
 * ```
 */
export function frameMarkOf(entry: TraceEntry, frame: number | undefined): FrameMark | undefined {
  const { data } = entry;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const exact = data.frame;
    if (typeof exact === "number") return { value: exact, exact: true };
  }
  return frame === undefined ? undefined : { value: frame, exact: false };
}

/**
 * The frame a link status reports.
 *
 * @param status - The link status.
 * @returns The frame, or undefined while connecting or empty.
 * @example
 * ```ts
 * statusFrame({ kind: "silent", since: 1, lastFrame: 1840 }); // 1840
 * ```
 */
export function statusFrame(status: LinkStatus): number | undefined {
  if (status.kind === "live" || status.kind === "paused") return status.frame;
  if (status.kind === "silent" || status.kind === "lost") return status.lastFrame;
  return undefined;
}

/**
 * Builds an entry line, stamped with the tools-page time of the ingest.
 *
 * @param entry - A trace entry.
 * @param key - The line key.
 * @param frame - Its frame mark.
 * @param summaryChars - Characters of non-string data shown inline.
 * @returns The line.
 * @example
 * ```ts
 * toEntryLine({ level: "info", event: "flow: boot", ts: 1 }, 1, undefined, 160).source; // "flow"
 * ```
 */
export function toEntryLine(
  entry: TraceEntry,
  key: number,
  frame: FrameMark | undefined,
  summaryChars: number
): EntryLine {
  return {
    kind: "entry",
    key,
    level: entry.level,
    source: sourceOf(entry),
    message: messageOf(entry, summaryChars),
    event: entry.event,
    ...(entry.data === undefined ? {} : { data: entry.data }),
    ts: entry.ts,
    frame,
    addedAt: Date.now()
  };
}

/**
 * The D1 line of a failed command run: level error, source "editor", the code and the wire
 * message without the `[moku-editor]` prefix (R7).
 *
 * @param ran - The failed run.
 * @param key - The line key.
 * @param frame - The link frame when it settled, if known.
 * @returns The line.
 * @example
 * ```ts
 * toCommandLine({ id: "game.step", input: undefined, origin: "topbar", at: 1, ok: false, error: { code: -32602, message: "[moku-editor] game.step: frames must be a number" } }, 1, 1840).message; // "-32602 game.step: frames must be a number"
 * ```
 */
export function toCommandLine(
  ran: Extract<RanEvent, { ok: false }>,
  key: number,
  frame: number | undefined
): EntryLine {
  const data: { [field: string]: Json } = { command: ran.id };
  for (const [field, value] of Object.entries(ran.error.data ?? {})) {
    if (value !== undefined) data[field] = value;
  }
  return {
    kind: "entry",
    key,
    level: "error",
    source: "editor",
    message: `${ran.error.code} ${bareMessage(ran.error.message)}`,
    event: ran.id,
    data,
    ts: ran.at,
    frame: frame === undefined ? undefined : { value: frame, exact: false },
    addedAt: Date.now()
  };
}

/**
 * A number with leading zeros.
 *
 * @param value - The number.
 * @param width - The digits.
 * @returns The padded text.
 * @example
 * ```ts
 * pad(7, 3); // "007"
 * ```
 */
function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * A timestamp as local `HH:MM:SS.mmm` (the detail drawer).
 *
 * @param ts - Epoch milliseconds.
 * @returns The time text.
 * @example
 * ```ts
 * formatTime(new Date(2026, 8, 24, 10, 12, 3, 45).getTime()); // "10:12:03.045"
 * ```
 */
export function formatTime(ts: number): string {
  const date = new Date(ts);
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => pad(part, 2));
  return `${clock.join(":")}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * The shared F13 tag atom of a level: info and debug muted, warn amber, error red.
 *
 * @param level - The log level.
 * @returns The `data-tag` value.
 * @example
 * ```ts
 * tagOf("error"); // "err"
 * ```
 */
export function tagOf(level: LogLevel): "mut" | "warn" | "err" {
  if (level === "warn") return "warn";
  return level === "error" ? "err" : "mut";
}

/**
 * The text of a frame link: the frame when exact, "≤frame" when "at or before".
 *
 * @param frame - The frame mark.
 * @returns The link text.
 * @example
 * ```ts
 * frameText({ value: 1840, exact: false }); // "≤1840"
 * ```
 */
export function frameText(frame: FrameMark): string {
  return frame.exact ? String(frame.value) : `≤${frame.value}`;
}

/**
 * The tooltip of a frame link.
 *
 * @param frame - The frame mark.
 * @returns The title text.
 * @example
 * ```ts
 * frameTitle({ value: 1778, exact: true }); // "Show frame 1778 in Flow"
 * ```
 */
export function frameTitle(frame: FrameMark): string {
  return frame.exact
    ? `Show frame ${frame.value} in Flow`
    : `Logged at or before frame ${frame.value}. The engine log carries no frame yet.`;
}
