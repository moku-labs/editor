/**
 * @file perf plugin — the API factory: status, the window visitor, second(), the spike summaries and
 * records, and the monitor for the recorder. Member docs live on `PerfApi` in types.ts.
 */
import { secondOf, spikeRecord, spikeSummaries, statusOf } from "./records";
import type { PerfApi, PerfCtx } from "./types";

/**
 * Builds the perf API over the plugin state. Every member reads the state at call time (the
 * monitor is found in onInit).
 *
 * @param ctx - The plugin context.
 * @returns The perf API.
 */
export function createPerfApi(ctx: PerfCtx): PerfApi {
  const { state, config } = ctx;
  return {
    status: () => statusOf(state),
    readWindow: visit => {
      visit(state.window);
    },
    second: () => secondOf(state),
    spikes: query => spikeSummaries(state, config, query),
    spike: frame => spikeRecord(state, frame),
    monitor: () => state.monitor
  };
}
