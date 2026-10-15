/* eslint-disable unicorn/no-null -- null is "no label" of a log */
/**
 * @file recorder plugin — the life of a log: its file name, the start (the context lines first,
 * then the `recorder` start event), the finish shared by `stop` and onStop, `remove`, and the
 * keepFiles bound.
 */
import type { WriteFailure } from "./flush";
import { drain, moveToMemory, persistAll, warnFailure } from "./flush";
import { clearQueue, enqueue } from "./listener";
import { dropLog, emitStatus, findFile, infoOf } from "./state";
import { messageOf } from "./store";
import type { LogFileInfo, RecorderCtx, RecorderState, Session } from "./types";

/** The message of a start without a monitor. */
const NO_MONITOR =
  "[moku-editor] recorder.start: this game has no performance monitor.\n  Run a dev or debug build of @moku-labs/game with the monitor (block 2b).";

/** What finishing a log did: the finished log, and the write that failed on the way. */
export type Finished = { readonly info: LogFileInfo; readonly failure: WriteFailure | undefined };

/**
 * Two digits.
 *
 * @param value - A whole number.
 * @returns It, padded with a zero.
 * @example
 * ```ts
 * twoDigits(4); // "04"
 * ```
 */
function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The file name of a log: `perf-<yyyymmdd>-<hhmm>-<model>.jsonl` in local time, the model lower-cased
 * with every character outside `[a-z0-9-]` turned into `-`, `device` without one; a name already
 * taken gains `-2`, `-3`, … before `.jsonl`.
 *
 * @param model - The header's `device.model`.
 * @param at - The start.
 * @param taken - The names in the store.
 * @returns The name.
 * @example
 * ```ts
 * logFileName("SM-A266B", new Date(2026, 9, 14, 15, 32), new Set()); // "perf-20261014-1532-sm-a266b.jsonl"
 * ```
 */
export function logFileName(
  model: string | null | undefined,
  at: Date,
  taken: ReadonlySet<string>
): string {
  const slug =
    model === null || model === undefined || model === ""
      ? "device"
      : model.toLowerCase().replaceAll(/[^\da-z-]/g, "-");
  const day = `${at.getFullYear()}${twoDigits(at.getMonth() + 1)}${twoDigits(at.getDate())}`;
  const base = `perf-${day}-${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}-${slug}`;
  let name = `${base}.jsonl`;
  let copy = 1;
  while (taken.has(name)) {
    copy += 1;
    name = `${base}-${copy}.jsonl`;
  }
  return name;
}

/**
 * The message of an unknown log name.
 *
 * @param method - The API member, e.g. "recorder.share".
 * @param name - The name asked for.
 * @returns The two-line message.
 * @example
 * ```ts
 * unknownLog("recorder.remove", "x.jsonl"); // '[moku-editor] recorder.remove: no log named "x.jsonl".\n  Pick a name from recorder.files().'
 * ```
 */
export function unknownLog(method: string, name: string): string {
  return `[moku-editor] ${method}: no log named "${name}".\n  Pick a name from recorder.files().`;
}

/**
 * Queues the context lines of a log start: the newest header, the startup, and the newest display
 * when it came after the header.
 *
 * @param state - The recorder's state.
 */
function queueContext(state: RecorderState): void {
  const { header, startup, display } = state;
  if (header !== undefined) enqueue(state, header);
  if (startup !== undefined) enqueue(state, startup);
  if (display !== undefined && (header === undefined || display.t > header.t)) {
    enqueue(state, display);
  }
}

/**
 * Removes the finished logs beyond keepFiles, oldest first: from the list at once, from their store
 * asynchronously (a failure is warned).
 *
 * @param ctx - The recorder's context.
 */
function pruneLogs(ctx: RecorderCtx): void {
  const { state, config } = ctx;
  const finished = state.files.filter(file => !file.current);
  const extra = new Set(finished.slice(0, Math.max(0, finished.length - config.keepFiles)));
  if (extra.size === 0) return;
  state.files = state.files.filter(file => !extra.has(file));
  for (const file of extra) {
    dropLog(state, file).catch((error: unknown) => {
      ctx.log.warn("recorder:remove-failed", { file: file.name, message: messageOf(error) });
    });
  }
}

/**
 * Starts a log (`start`, `editor.record`, autoStart): the session, the context lines and the
 * `recorder` start event in the queue, the log in the list, keepFiles, the status. A running log
 * is answered as it is.
 *
 * @param ctx - The recorder's context.
 * @param label - A name for the run; trimmed, empty is none.
 * @returns The new (or running) log.
 * @throws {Error} When perf found no monitor.
 */
export function startRecording(ctx: RecorderCtx, label?: string): LogFileInfo {
  const { state } = ctx;
  if (state.session !== undefined) return infoOf(state.session);
  const { monitor } = state;
  if (monitor === undefined) throw new Error(NO_MONITOR);

  const startedAt = Date.now();
  const trimmed = label?.trim() ?? "";
  const taken = new Set(state.files.map(file => file.name));
  const session: Session = {
    name: logFileName(state.header?.device.model, new Date(startedAt), taken),
    label: trimmed === "" ? null : trimmed,
    startedAt,
    lines: 0,
    bytes: 0,
    sent: 0,
    pending: [],
    pendingBytes: 0,
    lastPersistAt: startedAt,
    chunks: 0,
    store: state.store,
    inflight: undefined
  };
  state.session = session;
  state.phase = state.exports > 0 ? "exporting" : "recording";
  state.marks = [];
  state.failures = 0;
  state.autoStartWait = 0;
  clearQueue(state);
  queueContext(state);
  monitor.event("recorder", { action: "start", label: session.label });
  state.files.push(infoOf(session));
  pruneLogs(ctx);
  emitStatus(ctx, true);
  ctx.log.info("recorder:started", {
    file: session.name,
    label: session.label,
    storage: session.store.kind
  });
  return infoOf(session);
}

/**
 * Puts a log's info in the list in place of the entry with its name.
 *
 * @param state - The recorder's state.
 * @param info - The info.
 */
function replaceFile(state: RecorderState, info: LogFileInfo): void {
  state.files = state.files.map(file => (file.name === info.name ? info : file));
}

/**
 * Finishes the running log (`stop` and onStop): the `recorder` stop event, the queue drained inside
 * the agent span, every pending text written (to memory when the store fails), the meta rewritten
 * `current: false`. Needs no emit and no log.
 *
 * @param state - The recorder's state.
 * @returns The finished log and the failed write; undefined when no log was running.
 */
export async function finishLog(state: RecorderState): Promise<Finished | undefined> {
  const { session, monitor } = state;
  if (session === undefined || monitor === undefined) return undefined;

  monitor.event("recorder", { action: "stop" });
  monitor.beginAgent();
  try {
    drain(state);
  } finally {
    monitor.endAgent();
  }
  state.session = undefined;
  state.phase = state.exports > 0 ? "exporting" : "idle";
  // Still current (keepMb and keepFiles leave it alone) until its text is in the store.
  replaceFile(state, infoOf(session));

  let failure = await persistAll(state, session);
  if (failure !== undefined) {
    // The failed chunk is back in the pending text: write it to memory (where the third failure in
    // a row already moved the log).
    if (!failure.moved) moveToMemory(state, session);
    await persistAll(state, session);
    failure = { message: failure.message, moved: true };
  }
  const info: LogFileInfo = {
    ...(findFile(state, session.name) ?? infoOf(session)),
    current: false,
    storage: session.store.kind
  };
  replaceFile(state, info);
  state.last = info;
  await session.store.describe(info).catch(() => {});
  return { info, failure };
}

/**
 * Stops the running log (`stop`, `editor.record { on: false }`): finishes it, warns a failed write,
 * emits the status and logs `recorder:stopped`.
 *
 * @param ctx - The recorder's context.
 * @returns The finished log; undefined when no log was running.
 */
export async function stopRecording(ctx: RecorderCtx): Promise<LogFileInfo | undefined> {
  const finished = await finishLog(ctx.state);
  if (finished === undefined) return undefined;
  const { info, failure } = finished;
  warnFailure(ctx, info.name, failure);
  emitStatus(ctx, true);
  ctx.log.info("recorder:stopped", { file: info.name, lines: info.lines, bytes: info.bytes });
  return info;
}

/**
 * Removes a finished log from its store and the list, and emits the status.
 *
 * @param ctx - The recorder's context.
 * @param name - The log's name.
 * @throws {TypeError} For an unknown name.
 * @throws {Error} For the log being recorded.
 */
export async function removeLog(ctx: RecorderCtx, name: string): Promise<void> {
  const { state } = ctx;
  const info = findFile(state, name);
  if (info === undefined) throw new TypeError(unknownLog("recorder.remove", name));
  if (state.session?.name === name) {
    throw new Error(
      `[moku-editor] recorder.remove: ${name} is being recorded.\n  Stop the recording first.`
    );
  }
  await dropLog(state, info);
  state.files = state.files.filter(file => file.name !== name);
  emitStatus(ctx, true);
}
