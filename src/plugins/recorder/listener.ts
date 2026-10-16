/**
 * @file recorder plugin — the monitor.stream listener. The engine calls it synchronously inside its
 * commit or flush (it may run before `stream` returns, with the header). It allocates nothing and
 * never serializes: every line is a fresh, deeply frozen engine object, kept as a reference.
 */
import type { PerfEventLine, PerfLogLine, TimelineEventLine } from "../perf/protocol";
import type { RecorderState } from "./types";

/**
 * Pushes a line reference into the queue ring; a full ring drops its oldest reference and counts
 * it (the next flush tick warns once per streak).
 *
 * @param state - The recorder's state.
 * @param line - The line.
 */
export function enqueue(state: RecorderState, line: PerfLogLine): void {
  const { queue } = state;
  if (state.queueSize === queue.length) {
    queue[state.queueHead] = undefined;
    state.queueHead = (state.queueHead + 1) % queue.length;
    state.queueSize -= 1;
    state.dropped += 1;
  }
  queue[(state.queueHead + state.queueSize) % queue.length] = line;
  state.queueSize += 1;
}

/**
 * Takes every queued reference out, oldest first, and empties the ring (a rotation carries them
 * into the next log).
 *
 * @param state - The recorder's state.
 * @returns The queued lines.
 */
export function takeQueue(state: RecorderState): PerfLogLine[] {
  const lines: PerfLogLine[] = [];
  for (let index = 0; index < state.queueSize; index += 1) {
    const line = state.queue[(state.queueHead + index) % state.queue.length];
    if (line !== undefined) lines.push(line);
  }
  clearQueue(state);
  return lines;
}

/**
 * Empties the queue ring (a new log starts with its context lines).
 *
 * @param state - The recorder's state.
 */
export function clearQueue(state: RecorderState): void {
  const { queue } = state;
  for (let index = 0; index < state.queueSize; index += 1) {
    queue[(state.queueHead + index) % queue.length] = undefined;
  }
  state.queueHead = 0;
  state.queueSize = 0;
}

/**
 * Keeps an event line that is context for the next log start, by reference: the newest `display`,
 * `rate`, `sections` and `debug` event. Any other event is not context.
 *
 * @param state - The recorder's state.
 * @param line - An event line of the stream.
 */
function keepContext(state: RecorderState, line: PerfEventLine): void {
  // The next change sends `sections`, a name the engine's PerfEventName does not list yet (`debug`
  // is in it from 0.15.1, not in the peer floor's): read the line as the newer engine's event line.
  const event: TimelineEventLine = line;
  switch (event.name) {
    case "display": {
      state.display = line;
      break;
    }
    case "rate": {
      state.rate = line;
      break;
    }
    case "sections": {
      state.sections = line;
      break;
    }
    case "debug": {
      state.debug = line;
      break;
    }
    default: {
      break;
    }
  }
}

/**
 * The stream listener: keeps the newest header, startup and `display`, `rate`, `sections` and
 * `debug` events for the next log start, and queues every line while a log runs (also while it is
 * exported), whatever its kind or name: an engine's new lines pass through unchanged. Without a log
 * (also while a finished log is exported), every other line is ignored.
 *
 * @param state - The recorder's state.
 * @param line - A line of the monitor's stream.
 */
export function listen(state: RecorderState, line: PerfLogLine): void {
  switch (line.kind) {
    case "header": {
      state.header = line;
      break;
    }
    case "startup": {
      state.startup = line;
      break;
    }
    case "event": {
      keepContext(state, line);
      break;
    }
    default: {
      break;
    }
  }

  if (state.session !== undefined) enqueue(state, line);
}
