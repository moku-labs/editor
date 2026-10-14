/**
 * @file perf plugin — type definitions. The Wave 0 skeleton declares only the config; unit 03 adds
 * the api, state, context and the re-exported wire types of ./protocol.
 */

/**
 * perf configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { registry: { game }, perf: { windowMs: 10_000, frames: 2048 } } });
 * ```
 */
export type PerfConfig = {
  /** How often perf reads the ring, ms: 250 (4 Hz; the overlay never repaints faster). 50 to 1000. */
  readEveryMs: number;
  /** The window the graph, the spike index and every spike count cover, ms: 6000. 1000 to 30000. */
  windowMs: number;
  /** Rows perf keeps: at least windowMs at the fastest display (720 at 120 Hz). 1024. 64 to 16384. */
  frames: number;
};
