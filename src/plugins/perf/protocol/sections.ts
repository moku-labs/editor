/**
 * @file perf/protocol — monitoring (spec 03 Delta 2026-10-16 D7): the engine's monitoring sections
 * in its order, the defaults the owner chose, what perf itself reads and sends (its feeds), and the
 * Monitoring popover's data. Runtime-free: types and two constants.
 */

/**
 * The engine's monitoring sections, in the engine's order (TC §2.7); `engine-contract.test.ts`
 * asserts it equals the engine's `MONITOR_SECTIONS` when the engine exports it (ask E7, next change).
 */
export const MONITOR_SECTIONS = [
  "gpu",
  "passes",
  "shaders",
  "problems",
  "memory",
  "systems",
  "nodes",
  "longFrames"
] as const;

/**
 * One monitoring section of the engine.
 *
 * @example
 * ```ts
 * const section: MonitorSectionName = "passes";
 * ```
 */
export type MonitorSectionName = (typeof MONITOR_SECTIONS)[number];

/**
 * The engine's sections on or off (TC §2.7, `monitor.sections()`), the mirror of the engine's
 * `MonitorSections` (next change, N1).
 *
 * @example
 * ```ts
 * const sections: MonitorSections = { ...SECTION_DEFAULTS, passes: true };
 * ```
 */
export type MonitorSections = Readonly<Record<MonitorSectionName, boolean>>;

/**
 * The engine's defaults (owner 2026-10-16: "defaults as the engine proposes"): passes, shaders,
 * nodes and all systems off.
 */
export const SECTION_DEFAULTS: MonitorSections = {
  gpu: true,
  passes: false,
  shaders: false,
  problems: true,
  memory: true,
  systems: true,
  nodes: false,
  longFrames: true
};

/**
 * What perf itself reads and sends (its own cost), independent of the engine's sections: the pass
 * window, the top 5 systems per frame and the demand marks per frame. Initialised from perf's flat
 * config (`feedPasses`, `feedSystems`, `feedNodes`), switched by `editor.perf.sections`.
 *
 * @example
 * ```ts
 * const feeds: PerfFeeds = { passes: false, systems: true, nodes: false };
 * ```
 */
export type PerfFeeds = {
  readonly passes: boolean;
  readonly systems: boolean;
  readonly nodes: boolean;
};

/**
 * The Monitoring popover's data: which sections are on (the engine's, when it can switch), what perf
 * reads, and the measured cost. "systems: true" means the top 5 per frame; all systems is the
 * engine's next change (sysAll).
 *
 * @example
 * ```ts
 * const state: PerfMonitorState = { engine: true, sections: { ...SECTION_DEFAULTS, passes: true }, feeds: { passes: true, systems: true, nodes: false },
 *   costMs: { gpu: 0.01, passes: 0.01, problems: 0.004, memory: 0.005, systems: 0.04, longFrames: 0 }, monitorMs: 0.21, editorMs: 0.12, overdraw: false };
 * ```
 */
export type PerfMonitorState = {
  /** The engine has `monitor.sections` (next change). False: `sections` mirrors SECTION_DEFAULTS and only `feeds` switch. */
  readonly engine: boolean;
  readonly sections: MonitorSections;
  readonly feeds: PerfFeeds;
  /** sample.sectionsMs: ms per drawn frame per section, page clock (next change); null before. */
  readonly costMs: Readonly<Partial<Record<MonitorSectionName, number>>> | null;
  /** sample.monitorMs (exists): the listeners' cost of the second. */
  readonly monitorMs: number | null;
  /** perf's own read and feed time per second, ms (measured around readTick with the monitor's clock; an EMA). */
  readonly editorMs: number | null;
  /**
   * The overdraw heat map is on (header `debug.overdraw` and the `debug` event, engine U6, RE1);
   * null on an engine that does not report it.
   */
  readonly overdraw: boolean | null;
};
