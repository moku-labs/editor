/**
 * @file activeSource plugin — the state factory: the local source of a page with no session yet,
 * a local preview not seen yet, no markers, notice or lease, and the health and clock-offset rings
 * allocated once.
 */
import type { ActiveSourceState } from "./types";

/**
 * Samples kept in the health ring: one a second, 48 seconds.
 */
export const HEALTH_SAMPLES = 48;

/**
 * Heartbeat clock offsets kept for the median.
 */
export const OFFSET_SAMPLES = 8;

/**
 * Creates the activeSource state: `current` is `{ kind: "local", session: null }` until link lists
 * sessions, the preview "none" until its session appears, every ring allocated once (NaN = no
 * sample), the local command queue resolved.
 *
 * @returns A fresh state.
 */
export function createActiveSourceState(): ActiveSourceState {
  return {
    // eslint-disable-next-line unicorn/no-null -- the spec's "no local preview on this page"
    current: { kind: "local", session: null },
    preview: { state: "none" },
    pausedSession: undefined,
    lost: undefined,
    own: undefined,
    target: undefined,
    local: Promise.resolve(),
    stopping: false,
    waits: new Set(),
    notice: undefined,
    markers: [],
    seen: new Set(),
    off: [],
    timers: { renew: undefined, notice: undefined },
    scans: 0,
    health: {
      samples: new Float32Array(HEALTH_SAMPLES).fill(Number.NaN),
      head: 0,
      // eslint-disable-next-line unicorn/no-null -- the spec's "no latency yet"
      latencyMs: null
    },
    offsets: { values: new Float64Array(OFFSET_SAMPLES), head: 0, count: 0 },
    listeners: new Set(),
    telemetryListeners: new Set(),
    telemetry: undefined,
    switching: 0,
    stopped: false
  };
}
