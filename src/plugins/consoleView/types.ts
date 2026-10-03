/**
 * @file consoleView plugin — type definitions: config, log levels and lines, frame marks, counts,
 * the ingest result, state, api, the domain context and the hooks.
 */
import type { Log } from "@moku-labs/common/browser";
import type { EmitFn } from "@moku-labs/core";
import type { Require, ToolsEvents } from "../../config";
import type { Json } from "../registry/protocol";

/**
 * consoleView configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { consoleView: { preserveLog: true } } });
 * ```
 */
export type Config = {
  /** Most lines kept (entries + meta rows); the oldest are dropped first. */
  maxLines: number;
  /** Initial state of the Preserve log toggle. */
  preserveLog: boolean;
  /** How long a fresh error row keeps its highlight, in ms. */
  freshMs: number;
  /** Characters of `data` shown inline in the Message cell. */
  summaryChars: number;
};

/**
 * A log level of the game trace.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * The level filter ("all" includes debug).
 */
export type LevelFilter = "all" | "info" | "warn" | "error";

/**
 * One game.log item after toWireValue.
 */
export type TraceEntry = {
  level: LogLevel;
  event: string;
  data?: Json;
  ts: number;
  plugin?: string;
};

/**
 * The frame of a line: exact from data.frame, else "at or before".
 */
export type FrameMark = { readonly value: number; readonly exact: boolean };

/**
 * One log entry line.
 */
export type EntryLine = {
  readonly kind: "entry";
  readonly key: number;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
  readonly event: string;
  readonly data?: Json;
  readonly ts: number;
  readonly frame: FrameMark | undefined;
  readonly addedAt: number;
};

/**
 * The text of a meta row (F6).
 */
export type MetaText =
  | "Console cleared"
  | "Log cleared: the game page reloaded. Turn on Preserve log to keep it."
  | "Game page reloaded · log preserved";

/**
 * One meta row.
 */
export type MetaLine = {
  readonly kind: "meta";
  readonly key: number;
  readonly text: MetaText;
  readonly addedAt: number;
};

/**
 * Any console line.
 */
export type LogLine = EntryLine | MetaLine;

/**
 * Entry counts per level plus all.
 */
export type LevelCounts = { all: number; debug: number; info: number; warn: number; error: number };

/**
 * What one ingest did.
 */
export type IngestResult = { readonly changed: boolean; readonly invalid?: boolean };

/**
 * consoleView state.
 */
export type ConsoleState = {
  /** Oldest first, ≤ maxLines. */
  lines: LogLine[];
  nextKey: number;
  /** Fingerprint of the current game: its first trace entry. */
  instance: { ts: number; event: string } | undefined;
  /** Trace entries of the current game already ingested. */
  consumed: number;
  preserve: boolean;
  level: LevelFilter;
  query: string;
  selected: number | undefined;
  everConnected: boolean;
  listeners: Set<() => void>;
  stopLog: (() => void) | undefined;
  removePalette: (() => void)[];
  searchEl: HTMLInputElement | undefined;
};

/**
 * The consoleView api (`app.consoleView`): the game log held for the whole session, its filter,
 * Preserve log, the detail-drawer selection and frame links. The view, the palette items and
 * tests use it.
 *
 * @example
 * ```ts
 * app.consoleView.setFilter({ level: "warn" });
 * app.consoleView.visible().length; // 2 on the design log
 * ```
 */
export type ConsoleApi = {
  /**
   * Every held line (entries and meta rows), oldest first, at most `maxLines`. A copy.
   *
   * @returns The lines.
   * @example
   * ```ts
   * // The game logged the 8 lines of the design log since the session started.
   * app.consoleView.lines().length; // 8
   * ```
   */
  lines(): readonly LogLine[];

  /**
   * The lines the table shows: entries of the filter level (`all` includes debug) whose
   * `source + " " + message` contains the query, case-insensitive. Meta rows always show.
   *
   * @returns The visible lines.
   * @example
   * ```ts
   * // Only the warnings that mention a texture.
   * app.consoleView.setFilter({ level: "warn", query: "texture" });
   * app.consoleView.visible().length; // 2
   * ```
   */
  visible(): readonly LogLine[];

  /**
   * Entry counts per level plus `all` (meta rows are not counted). The toolbar shows them.
   *
   * @returns The counts.
   * @example
   * ```ts
   * // The design log: 6 info lines and 2 warnings.
   * app.consoleView.counts(); // { all: 8, debug: 0, info: 6, warn: 2, error: 0 }
   * ```
   */
  counts(): LevelCounts;

  /**
   * The current level filter and search query.
   *
   * @returns A copy of the filter.
   * @example
   * ```ts
   * // Nothing is filtered when the Console opens.
   * app.consoleView.filter(); // { level: "all", query: "" }
   * ```
   */
  filter(): { level: LevelFilter; query: string };

  /**
   * Merges a partial filter into the current one and notifies the view.
   *
   * @param next - The level, the query, or both.
   * @example
   * ```ts
   * // The "warn 2" segment was clicked, then "gear" typed in the search.
   * app.consoleView.setFilter({ level: "warn" });
   * app.consoleView.setFilter({ query: "gear" });
   * app.consoleView.filter(); // { level: "warn", query: "gear" }
   * ```
   */
  setFilter(next: Partial<{ level: LevelFilter; query: string }>): void;

  /**
   * Empties the Console to one meta row "Console cleared" and closes the drawer. The entries
   * already consumed never come back; the rail badge is cleared.
   *
   * @example
   * ```ts
   * // The Clear button, or "Clear console" in the palette.
   * app.consoleView.clear();
   * app.consoleView.lines().map(line => line.kind); // ["meta"]
   * ```
   */
  clear(): void;

  /**
   * Whether Preserve log is on: when on, a game page reload keeps the lines and adds the meta
   * row "Game page reloaded · log preserved".
   *
   * @returns True when the log survives a reload.
   * @example
   * ```ts
   * // Off by default, like Chrome DevTools.
   * app.consoleView.preserve(); // false
   * ```
   */
  preserve(): boolean;

  /**
   * Turns Preserve log on or off and notifies the view.
   *
   * @param on - The new value.
   * @example
   * ```ts
   * // Keep the log across the game page reload of the next code change.
   * app.consoleView.setPreserve(true);
   * app.consoleView.preserve(); // true
   * ```
   */
  setPreserve(on: boolean): void;

  /**
   * Selects the line shown in the detail drawer; no key closes the drawer.
   *
   * @param key - The line key; omitted to close the drawer.
   * @example
   * ```ts
   * // A row was clicked: the drawer shows the missing-texture warning.
   * app.consoleView.select(5);
   * app.consoleView.selected()?.kind; // "entry"
   * app.consoleView.select(); // the drawer closes
   * ```
   */
  select(key?: number): void;

  /**
   * The line in the detail drawer, if it is still held.
   *
   * @returns The line, or undefined.
   * @example
   * ```ts
   * // The drawer is open on the fifth line of the design log.
   * app.consoleView.select(5);
   * app.consoleView.selected(); // { kind: "entry", key: 5, level: "warn", source: "assets", … }
   * ```
   */
  selected(): LogLine | undefined;

  /**
   * Reads `game.log` once and ingests it like a watched value. A manual action, not a poll:
   * ingest is idempotent, and a failed read is logged at debug level.
   *
   * @example
   * ```ts
   * // The watch is live, so this only re-checks: no line is added twice.
   * app.consoleView.refresh();
   * app.consoleView.lines().length; // still 8
   * ```
   */
  refresh(): void;

  /**
   * Emits the global `workspace:focus-frame { frame }` (R4). flowView hooks it and focuses the
   * edge taken at that frame; consoleView calls no flowView api.
   *
   * @param frame - The frame of the clicked frame link.
   * @example
   * ```ts
   * // The frame cell "1778" of the rejected merge was clicked.
   * app.consoleView.focusFrame(1778); // flowView shows Flow at frame 1778
   * ```
   */
  focusFrame(frame: number): void;

  /**
   * Adds a change listener (the view re-renders on it).
   *
   * @param fn - Called after every change of the lines, filter, Preserve log or selection.
   * @returns An idempotent unsubscribe.
   * @example
   * ```ts
   * // An MCP tool streams the error count while it runs.
   * const off = app.consoleView.subscribe(() => report(app.consoleView.counts().error));
   * off();
   * ```
   */
  subscribe(fn: () => void): () => void;
};

/**
 * Domain context of consoleView: the kernel context is assignable to it.
 */
export type ConsoleCtx = {
  readonly config: Readonly<Config>;
  state: ConsoleState;
  readonly emit: EmitFn<Pick<ToolsEvents, "workspace:focus-frame">>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * consoleView's hooks (global tools events, R4).
 */
export type ConsoleHooks = {
  readonly "link:status": (payload: ToolsEvents["link:status"]) => void;
  readonly "workspace:ran": (payload: ToolsEvents["workspace:ran"]) => void;
};
