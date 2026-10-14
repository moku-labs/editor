/**
 * @file perf/protocol barrel — the only barrel of the module. Runtime-free: the engine's monitor
 * types (re-exported from `@moku-labs/game` where it exports them, structural where it does not),
 * the editor's cause ranking, the rate helper, `cleanText` for a phone's text, the window and its
 * wire form, the values of the perf sources and the guards perf reads the engine through. Imported
 * by relative path from any core (collector/report, the hub's types, the overlay, the tools page),
 * never through the perf plugin.
 */
export * from "./causes";
export * from "./engine";
export * from "./guards";
export * from "./rate";
export * from "./text";
export * from "./values";
export * from "./window";
