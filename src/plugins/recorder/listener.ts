/**
 * @file recorder plugin — the monitor.stream listener. The engine calls it synchronously inside its
 * commit or flush (it may run before `stream` returns, with the header). It allocates nothing and
 * never serializes: every line is a fresh, deeply frozen engine object, kept as a reference.
 */
import type { PerfLogLine } from "../perf/protocol";
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
 * The stream listener: keeps the newest header, startup and `display` event for the next log
 * start, and queues every line while a log runs (also while it is exported). Idle, every other line
 * is ignored.
 *
 * @param state - The recorder's state.
 * @param line - A line of the monitor's stream.
 */
export function listen(state: RecorderState, line: PerfLogLine): void {
  if (line.kind === "header") state.header = line;
  else if (line.kind === "startup") state.startup = line;
  else if (line.kind === "event" && line.name === "display") state.display = line;

  if (state.phase !== "idle") enqueue(state, line);
}
