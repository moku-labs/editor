/**
 * @file recorder plugin — marks: a user mark and the overlay's automatic mark of a game command,
 * both written as `mark` lines through the engine (`monitor.mark`) while a log runs. Neither writes
 * a `command` event: the `registry:command` hook writes the one line of a run.
 */
import type { Json } from "../registry/protocol";
import type { RecorderState } from "./types";

/**
 * Writes a user mark into the running log and adds it to the marks.
 *
 * @param state - The recorder's state.
 * @param label - What follows.
 * @returns True when the mark went into a log; false while idle, without a monitor or for an
 *   empty label.
 */
export function markLog(state: RecorderState, label: string): boolean {
  const { session, monitor } = state;
  if (session === undefined || monitor === undefined || label.trim() === "") return false;
  monitor.mark(label);
  state.marks.push({ atMs: Date.now() - session.startedAt, label, auto: false });
  return true;
}

/**
 * Writes the automatic mark of a command the overlay ran into the running log, and adds it with
 * its command to the marks.
 *
 * @param state - The recorder's state.
 * @param id - The command id.
 * @param input - Its input.
 * @param label - The mark's words.
 * @returns True when the mark went into a log; false while idle or without a monitor.
 */
export function commandMark(state: RecorderState, id: string, input: Json, label: string): boolean {
  const { session, monitor } = state;
  if (session === undefined || monitor === undefined) return false;
  monitor.mark(label);
  state.marks.push({
    atMs: Date.now() - session.startedAt,
    label,
    auto: true,
    command: { id, input }
  });
  return true;
}
