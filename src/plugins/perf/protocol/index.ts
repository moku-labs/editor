/**
 * @file perf/protocol barrel — the only barrel of the module. Runtime-free: the engine's monitor
 * types (re-exported from `@moku-labs/game`; `DevtoolsDetail` is the editor's own),
 * the editor's cause ranking, the GPU noise rule and the headline GPU, the rate helper, `cleanText`
 * for a phone's text, the window and its wire form, the values of the perf sources and the guards perf reads the engine through. Imported
 * by relative path from any core (collector/report, the hub's types, the overlay, the tools page),
 * never through the perf plugin.
 */
export * from "./causes";
export * from "./engine";
export * from "./gpu";
export * from "./guards";
export * from "./rate";
export * from "./text";
export * from "./values";
export * from "./window";
