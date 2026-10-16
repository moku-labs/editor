/**
 * @file perf/protocol barrel — the only barrel of the module. Runtime-free: the engine's monitor
 * types (re-exported from `@moku-labs/game`; `DevtoolsDetail` is the editor's own),
 * the editor's cause ranking, the GPU noise rule and the headline GPU, the rate helper, `cleanText`
 * for a phone's text, the window and its wire form, the values of the perf sources and the guards perf reads the engine through,
 * and the Mission control feeds (spec 03 Delta 2026-10-16): monitoring sections, the timeline, the
 * frames feed and range detail, the passes of a second, memory trust and the tools page's 2-minute
 * history. Imported
 * by relative path from any core (collector/report, the hub's types, the overlay, the tools page),
 * never through the perf plugin.
 */
export * from "./causes";
export * from "./engine";
export * from "./frames";
export * from "./gpu";
export * from "./guards";
export * from "./history";
export * from "./memory";
export * from "./passes";
export * from "./rate";
export * from "./sections";
export * from "./text";
export * from "./timeline";
export * from "./values";
export * from "./window";
