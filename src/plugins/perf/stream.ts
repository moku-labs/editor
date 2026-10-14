/**
 * @file perf plugin — the monitor.stream listener: keeps references to the newest header, display,
 * sample, the last 64 spike lines, 16 `rate` lines and 32 frame-event lines of the game. Allocates
 * nothing: every line is a fresh frozen engine object, kept as it is (engine fact 7).
 */
import type { PerfEventLine, PerfHeaderLine, PerfLogLine } from "./protocol";
import { isPerfDisplay } from "./protocol";
import { notifyWatchers } from "./state";
import type { PerfState } from "./types";

/** The event names of the game's frame events a record lists (engine fact 11). */
const FRAME_EVENT_NAMES: ReadonlySet<string> = new Set(["overlay", "pool-trim", "warm"]);

/**
 * Keeps a header: its display, and whether the page has a GPU timer.
 *
 * @param state - perf's state.
 * @param line - The header line.
 */
function keepHeader(state: PerfState, line: PerfHeaderLine): void {
  const gpuTimer = line.gpu.timer !== null;
  state.header = line;
  state.display = line.display;
  if (state.window.gpuTimer !== gpuTimer) {
    state.window.gpuTimer = gpuTimer;
    state.window.version += 1;
  }
  notifyWatchers(state);
}

/**
 * Keeps an event line perf reads: a valid `display`, a `rate` line, a frame event of the game.
 * Every other name (`devtools`, `command`, `recorder`, …) changes nothing.
 *
 * @param state - perf's state.
 * @param line - The event line.
 */
function keepEvent(state: PerfState, line: PerfEventLine): void {
  if (line.name === "display") {
    if (!isPerfDisplay(line.detail)) return;
    state.display = line.detail;
    notifyWatchers(state);
    return;
  }

  if (line.name === "rate") {
    state.rateLines[state.rateLineNext % state.rateLines.length] = line;
    state.rateLineNext += 1;
    notifyWatchers(state);
    return;
  }

  if (FRAME_EVENT_NAMES.has(line.name)) {
    state.frameEvents[state.frameEventNext % state.frameEvents.length] = line;
    state.frameEventNext += 1;
  }
}

/**
 * The stream listener: keeps the lines perf reads by reference. A new header, display, sample or
 * `rate` line drops the cached `second()` and calls the source watches.
 *
 * @param state - perf's state.
 * @param line - A line of the monitor's stream.
 */
export function listen(state: PerfState, line: PerfLogLine): void {
  switch (line.kind) {
    case "header": {
      keepHeader(state, line);
      return;
    }
    case "sample": {
      state.sample = line;
      notifyWatchers(state);
      return;
    }
    case "spike": {
      state.spikeLines[state.spikeLineNext % state.spikeLines.length] = line;
      state.spikeLineNext += 1;
      return;
    }
    case "event": {
      keepEvent(state, line);
      return;
    }
    default:
  }
}
