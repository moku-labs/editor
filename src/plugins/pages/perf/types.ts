/**
 * @file pages perf sub-domain — the types of the `moku-editor perf` CLI: its four argument shapes,
 * the plugin configs of a run, the discovery record `.moku/perf.json`, the process seam, and what
 * the live lines print through and remember of each log.
 */
import type { createApp } from "../../../server";

/**
 * `moku-editor perf [--lan] [--port 47600] [--out DIR] [--every 10] [--no-ui]`.
 *
 * @example
 * ```ts
 * // moku-editor perf --lan --no-ui
 * const args: PerfArgs = { kind: "perf", lan: true, port: 47600, out: ".moku/perf", every: 10, ui: false };
 * ```
 */
export type PerfArgs = {
  readonly kind: "perf";
  /** Also listen on the LAN address: a phone there pairs by its code. */
  readonly lan: boolean;
  /** The device port: 47600 by default, 0 for a random free port (tests). */
  readonly port: number;
  /** The folder of the logs, relative to the root: ".moku/perf" by default. */
  readonly out: string;
  /** Seconds between two adb readings (heat, system frames): 10 by default. */
  readonly every: number;
  /** False with `--no-ui`: the tools page is not served on the device port. */
  readonly ui: boolean;
};

/**
 * `moku-editor perf mark "<label>"`.
 *
 * @example
 * ```ts
 * const args: PerfMarkArgs = { kind: "perf-mark", label: "boss" };
 * ```
 */
export type PerfMarkArgs = { readonly kind: "perf-mark"; readonly label: string };

/**
 * `moku-editor perf summary <log>`.
 *
 * @example
 * ```ts
 * const args: PerfSummaryArgs = { kind: "perf-summary", log: ".moku/perf/perf-20261014-1532-sm-a266b.jsonl" };
 * ```
 */
export type PerfSummaryArgs = { readonly kind: "perf-summary"; readonly log: string };

/**
 * `moku-editor perf compare <a> <b>`.
 *
 * @example
 * ```ts
 * const args: PerfCompareArgs = { kind: "perf-compare", a: "before.jsonl", b: "after.jsonl" };
 * ```
 */
export type PerfCompareArgs = {
  readonly kind: "perf-compare";
  readonly a: string;
  readonly b: string;
};

/**
 * The plugin configs perfConfigOf returns: every switch is a field of the plugin that owns it.
 *
 * @example
 * ```ts
 * const configs: PerfPluginConfigs = {
 *   files: { root: "/game", project: false }, hub: { devicePort: 47600, deviceLan: true },
 *   collector: { out: ".moku/perf", everyS: 10, appId: "com.example.garden" }, pages: { toolsPage: false }
 * };
 * ```
 */
export type PerfPluginConfigs = {
  readonly files: { readonly root: string; readonly project: false };
  readonly hub: { readonly devicePort: number; readonly deviceLan: boolean };
  readonly collector: { readonly out: string; readonly everyS: number; readonly appId?: string };
  readonly pages: { readonly toolsPage: boolean };
};

/**
 * The `pluginConfigs` of the server entry's createApp (every server plugin's partial config).
 *
 * @example
 * ```ts
 * const extra: ServerPluginConfigs = { collector: { adb: "/no/adb" }, pages: { pageDir: "/tmp/tools" } };
 * ```
 */
export type ServerPluginConfigs = NonNullable<
  NonNullable<Parameters<typeof createApp>[0]>["pluginConfigs"]
>;

/**
 * `.moku/perf.json`: how `perf mark` finds the running perf. Holds the hub token: never printed or
 * logged.
 *
 * @example
 * ```ts
 * const record: PerfDiscovery = { version: 1, pid: 4242, port: 47600, path: "/__editor", token, lan: null, startedAt: 1791986083963 };
 * ```
 */
export type PerfDiscovery = {
  readonly version: 1;
  /** The perf run's process id (`perf mark` treats a dead pid as no run). */
  readonly pid: number;
  /** The real device port on 127.0.0.1. */
  readonly port: number;
  /** `hub.path()`, such as "/__editor". */
  readonly path: string;
  /** The hub token of this run. */
  readonly token: string;
  /** The LAN listener, `<address>:<port>`; null without `--lan`. */
  readonly lan: string | null;
  /** `Date.now()` when the file was written. */
  readonly startedAt: number;
};

/**
 * What a perf run talks to; `processPerfDeps()` is the real process, tests pass stubs.
 *
 * @example
 * ```ts
 * const deps: PerfDeps = {
 *   cwd: () => "/game", pid: 4242, isAlive: () => true,
 *   ask: () => Promise.resolve("4821"), readText: path => Bun.file(path).text(),
 *   fetch: (url, init) => fetch(url, init), appIdOf: () => Promise.resolve(undefined),
 *   extraConfig: { collector: { adb: "/no/adb" } }
 * };
 * ```
 */
export type PerfDeps = {
  /** The process cwd: the root of the run. */
  readonly cwd: () => string;
  /** This process id, written into `.moku/perf.json`. */
  readonly pid: number;
  /** Whether a process id is alive. */
  readonly isAlive: (pid: number) => boolean;
  /** Asks one question on the terminal; rejects when the signal aborts. */
  readonly ask: (question: string, signal: AbortSignal) => Promise<string>;
  /** Reads a text file; rejects when it cannot. */
  readonly readText: (path: string) => Promise<string>;
  /** The HTTP request of `perf mark`. */
  readonly fetch: (
    url: string,
    init: {
      readonly method: "POST";
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  ) => Promise<{ readonly status: number; text(): Promise<string> }>;
  /** The game's base Android identifier from `<root>/config.ts` (`native.identifier`), or undefined. */
  readonly appIdOf: (root: string) => Promise<string | undefined>;
  /**
   * Plugin config merged over perfConfigOf's, one plugin at a time (`mergePluginConfigs`; tests: a
   * missing adb). Typed as the server createApp's `pluginConfigs`, so an unknown plugin or a wrong
   * field type is a type error.
   */
  readonly extraConfig?: ServerPluginConfigs;
};

/**
 * What a perf run prints through: the brand console satisfies it.
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * const output: PerfOutput = { line: text => lines.push(text ?? ""), warn: message => lines.push(`! ${message}`) };
 * ```
 */
export type PerfOutput = {
  /**
   * Prints a plain line.
   *
   * @param text - The line; an empty line without it.
   */
  line(text?: string): void;
  /**
   * Prints a warning.
   *
   * @param message - The warning.
   */
  warn(message: string): void;
};

/**
 * What the live lines remember of one log (key: the log's file).
 */
export type LiveMemory = {
  /** The engine of the last header line; null before one. */
  engine: string | null;
  /** The build of the last header line; null before one. */
  build: string | null;
  /** The digest path of the last stats line. */
  path: string | null;
  /** The digest rate of the last stats line. */
  rate: number | null;
  /** Computer ms of the last stats line. */
  printedAt: number;
  /** `"<phone engine>|<computer engine>"` already warned STALE. */
  staleWarned: string | null;
  /** The state of the last event; undefined before the first. */
  state: "live" | "away" | "done" | undefined;
};
