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
 * The consoleView api (`app.consoleView`).
 *
 * @example
 * ```ts
 * app.consoleView.setFilter({ level: "warn" });
 * ```
 */
export type ConsoleApi = {
  lines(): readonly LogLine[];
  visible(): readonly LogLine[];
  counts(): LevelCounts;
  filter(): { level: LevelFilter; query: string };
  setFilter(next: Partial<{ level: LevelFilter; query: string }>): void;
  clear(): void;
  preserve(): boolean;
  setPreserve(on: boolean): void;
  select(key: number | undefined): void;
  selected(): LogLine | undefined;
  refresh(): void;
  /** Emits the global workspace:focus-frame (R4). */
  focusFrame(frame: number): void;
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
