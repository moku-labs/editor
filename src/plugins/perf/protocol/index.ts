/**
 * @file perf/protocol barrel — the only barrel of the module. Runtime-free: the engine's monitor
 * types (structural copies until the engine exports them), the editor's cause ranking and the rate
 * helper. Imported by relative path from any core (collector/report, the hub's types, the overlay,
 * the tools page), never through the perf plugin. Unit 03 adds window, values and guards.
 */
export * from "./causes";
export * from "./engine";
export * from "./rate";
