/**
 * @file perf plugin — the monitor.stream listener: keeps references to the newest header, display,
 * sample, the last 64 spike lines, 16 `rate` lines and 32 frame-event lines of the game, the
 * timeline's lines (feeds/timeline), the newest two `passes` lines, the sections and the overdraw
 * switch. Allocates nothing per line: every line is a fresh frozen engine object, kept as it is
 * (engine fact 7).
 */
import { seeCap } from "./feeds/caps";
import { noteHeap } from "./feeds/memory";
import { noteSections } from "./feeds/sections";
import { listenTimeline } from "./feeds/timeline";
import type { PerfEventLine, PerfLogLine, PerfPassesLine } from "./protocol";
import { announcedHzOf, isPerfDisplay, isRateChange } from "./protocol";
import { notifyInSpan } from "./state";
import type { HeaderLine, PerfState, TimelineLine } from "./types";

/** The event names of the game's frame events a record lists (engine fact 11). */
const FRAME_EVENT_NAMES: ReadonlySet<string> = new Set(["overlay", "pool-trim", "warm"]);

/**
 * Keeps a header: its display, the display's rate (the hz it announces, else the header's rate),
 * whether the page has a GPU timer, the timeline's display rate, the overdraw switch and the
 * sections it names; the capabilities are computed again at the next read.
 *
 * @param state - perf's state.
 * @param line - The header line.
 */
function keepHeader(state: PerfState, line: HeaderLine): void {
  const gpuTimer = line.gpu.timer !== null;
  state.header = line;
  state.display = line.display;
  state.displayHz = announcedHzOf(line.display) ?? line.rate?.displayHz ?? state.displayHz;
  state.timelineHz = announcedHzOf(line.display);
  state.overdraw = line.debug?.overdraw ?? state.overdraw;
  state.sections = line.sections ?? state.sections;
  state.capsStale = true;
  if (state.window.gpuTimer !== gpuTimer) {
    state.window.gpuTimer = gpuTimer;
    state.window.version += 1;
  }
  notifyInSpan(state);
}

/**
 * Keeps what an event line changes of perf's model: a valid `display` (with the hz a newer engine
 * announces in it), a `rate` line (its display Hz only while the display announces none), a frame
 * event of the game, a `sections` switch, the overdraw switch of a `debug` line. Every other name
 * (`devtools`, `command`, `recorder`, …) changes nothing here.
 *
 * @param state - perf's state.
 * @param line - The event line.
 */
function keepEvent(state: PerfState, line: PerfEventLine): void {
  const event: TimelineLine = line;
  if (event.name === "display") {
    if (!isPerfDisplay(line.detail)) return;
    state.display = line.detail;
    state.displayHz = announcedHzOf(line.detail) ?? state.displayHz;
    notifyInSpan(state);
    return;
  }

  if (event.name === "rate") {
    if (isRateChange(line.detail)) {
      state.displayHz = announcedHzOf(state.display) ?? line.detail.displayHz ?? state.displayHz;
    }
    state.rateLines[state.rateLineNext % state.rateLines.length] = line;
    state.rateLineNext += 1;
    notifyInSpan(state);
    return;
  }

  if (event.name === "sections") noteSections(state, event);
  if (event.name === "debug" && typeof line.detail.overdraw === "boolean") {
    state.overdraw = line.detail.overdraw;
    state.second = undefined;
  }
  if (FRAME_EVENT_NAMES.has(line.name)) {
    state.frameEvents[state.frameEventNext % state.frameEvents.length] = line;
    state.frameEventNext += 1;
  }
}

/**
 * Keeps a line of a kind the installed engine's type does not list: the per-second `passes`
 * summary of the engine's next change (the newest two, by reference).
 *
 * @param state - perf's state.
 * @param line - The line.
 */
function keepOther(state: PerfState, line: PerfLogLine | PerfPassesLine): void {
  if (line.kind !== "passes") return;
  state.passesLines[state.passesLineNext % state.passesLines.length] = line;
  state.passesLineNext += 1;
  seeCap(state, "passesLine");
  notifyInSpan(state);
}

/**
 * The stream listener: keeps the lines perf reads by reference. A new header, display, sample,
 * `rate` or `passes` line drops the cached `second()` and calls the source watches; event and mark
 * lines also go to the timeline.
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
      noteHeap(state, line);
      notifyInSpan(state);
      return;
    }
    case "spike": {
      state.spikeLines[state.spikeLineNext % state.spikeLines.length] = line;
      state.spikeLineNext += 1;
      return;
    }
    case "event": {
      keepEvent(state, line);
      listenTimeline(state, line);
      return;
    }
    case "mark": {
      listenTimeline(state, line);
      return;
    }
    default: {
      keepOther(state, line);
    }
  }
}
