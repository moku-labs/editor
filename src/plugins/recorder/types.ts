/**
 * @file recorder plugin — type definitions. The Wave 0 skeleton declares only the config; unit 05
 * adds the api, state, outbox, store and event types.
 */

/**
 * recorder configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, recorder: { autoStart: false, keepMb: 32 } } });
 * ```
 */
export type RecorderConfig = {
  /** Start a log when the plugin starts: a debug build is for measuring, and the bridge ships only what is recorded. true. */
  autoStart: boolean;
  /** Most MB kept in memory: lines the computer has not confirmed, plus the logs of the memory store. 64. 1 to 512. */
  keepMb: number;
  /** How often the queue is serialized, ms: 1000. 100 to 10000. */
  flushEveryMs: number;
  /** How often serialized text is written to the store, ms: 5000; also when 64 KB wait, and at stop. 1000 to 60000. */
  persistEveryMs: number;
  /** "auto": OPFS when the page has it, memory otherwise; "memory": never on disk. */
  storage: "auto" | "memory";
  /** Finished logs kept in the store; the oldest beyond are removed when a log starts. 10. 1 to 100. */
  keepFiles: number;
};
