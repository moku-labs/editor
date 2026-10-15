/**
 * @file recorder plugin — the outbox: the serialized lines the computer has not confirmed, in
 * serialization order (a log's lines are contiguous, logs follow each other). The bridge peeks a
 * run of one log with `unsentRun` and confirms by index with `ack`; only the head is ever removed,
 * so the indices of one run are consecutive.
 */
import type { OutboxRun, RecorderState } from "./types";

/** A consumed head longer than this is spliced off once more than half the outbox is consumed. */
const COMPACT_AFTER = 4096;

/**
 * Appends a serialized line to the outbox.
 *
 * @param state - The recorder's state.
 * @param text - The line's JSON text.
 * @param owner - The log it belongs to.
 * @param index - Its index within that log.
 */
export function pushOutbox(state: RecorderState, text: string, owner: string, index: number): void {
  state.outbox.push(text);
  state.outboxOwner.push(owner);
  state.outboxIndex.push(index);
  state.outboxBytes += text.length + 1;
}

/**
 * Splices off the consumed head when it is long and more than half the outbox.
 *
 * @param state - The recorder's state.
 */
function compact(state: RecorderState): void {
  const head = state.outboxHead;
  if (head <= COMPACT_AFTER || head * 2 <= state.outbox.length) return;
  state.outbox.splice(0, head);
  state.outboxOwner.splice(0, head);
  state.outboxIndex.splice(0, head);
  state.outboxHead = 0;
}

/**
 * Takes the outbox's oldest line out unconfirmed (the keepMb bound): it leaves a jump in its log's
 * indices, which the hub reports as a gap.
 *
 * @param state - The recorder's state.
 * @returns False when the outbox was empty.
 */
export function dropOldestLine(state: RecorderState): boolean {
  const text = state.outbox[state.outboxHead];
  if (text === undefined) return false;
  state.outboxHead += 1;
  state.outboxBytes -= text.length + 1;
  compact(state);
  return true;
}

/**
 * The oldest unconfirmed lines of the log of the outbox's oldest line, without taking them.
 *
 * @param state - The recorder's state.
 * @param max - Most lines; anything but a whole number from 1 counts as 1.
 * @returns The run; undefined when the outbox is empty.
 */
export function unsentRun(state: RecorderState, max: number): OutboxRun | undefined {
  const head = state.outboxHead;
  const log = state.outboxOwner[head];
  const from = state.outboxIndex[head];
  if (log === undefined || from === undefined) return undefined;

  const most = Number.isInteger(max) && max >= 1 ? max : 1;
  let end = head + 1;
  while (end < state.outbox.length && end - head < most && state.outboxOwner[end] === log) end += 1;
  return { log, from, lines: state.outbox.slice(head, end) };
}

/**
 * Adds confirmed lines to their log's `sent`: the session's while it records, else its file's.
 *
 * @param state - The recorder's state.
 * @param log - The log's name.
 * @param count - Lines confirmed.
 */
function credit(state: RecorderState, log: string, count: number): void {
  const { session } = state;
  if (session?.name === log) {
    session.sent += count;
    return;
  }
  state.files = state.files.map(file =>
    file.name === log ? { ...file, sent: file.sent + count } : file
  );
}

/**
 * Confirms every outbox line of `log` below `next` at the head: they leave the outbox and count as
 * sent. An older or repeated ack, or another log's, removes nothing.
 *
 * @param state - The recorder's state.
 * @param log - The log's name.
 * @param next - The hub's next expected index of that log.
 * @throws {TypeError} When `next` is not a whole number from 0.
 */
export function ackLines(state: RecorderState, log: string, next: number): void {
  if (!Number.isInteger(next) || next < 0) {
    throw new TypeError(
      `[moku-editor] recorder.ack(${log}, ${next}) needs a whole line index from 0.\n  Pass the next of the hub's perf.ack, for example 1840.`
    );
  }

  let count = 0;
  while (
    state.outboxOwner[state.outboxHead] === log &&
    (state.outboxIndex[state.outboxHead] ?? next) < next
  ) {
    state.outboxBytes -= (state.outbox[state.outboxHead]?.length ?? 0) + 1;
    state.outboxHead += 1;
    count += 1;
  }
  if (count === 0) return;
  state.sent += count;
  credit(state, log, count);
  compact(state);
}
