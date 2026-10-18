/* eslint-disable unicorn/no-null -- null is "no label" of a log and "no name" of its starter */
/**
 * @file recorder plugin — the life of a log: its file name, who started it, the start (the context
 * lines first, then the `recorder` start event), the finish shared by `stop` and onStop, `remove`,
 * and the keepFiles bound.
 */

import type { MonitorLike, PerfEventLine, PerfHeaderLine, PerfLogLine } from "../perf/protocol";
import type { WriteFailure } from "./flush";
import { drain, MEGABYTE, moveToMemory, persistAll, utf8Length, warnFailure } from "./flush";
import { clearQueue, enqueue, takeQueue } from "./listener";
import { dropLog, emitStatus, findFile, infoOf } from "./state";
import { messageOf } from "./store";
import type {
  LogFileInfo,
  RecorderCtx,
  RecorderState,
  RecordOrigin,
  RecordStarter,
  Session
} from "./types";

/** The message of a start without a monitor. */
const NO_MONITOR =
  "[moku-editor] recorder.start: this game has no performance monitor.\n  Run a dev or debug build of @moku-labs/game with the monitor (block 2b).";

/** The longest agent name a log keeps (the hub cuts to the same length). */
export const NAME_LENGTH = 64;

/**
 * Who started a log: the starter, and for an agent only its MCP client's name, trimmed and cut to
 * NAME_LENGTH characters (an empty name is none).
 *
 * @param by - The starter; "code" (the game's own code) when not given.
 * @param name - The agent's name, as the run carried it.
 * @returns The origin.
 * @example
 * ```ts
 * originOf("agent", " Claude "); // { by: "agent", name: "Claude" }
 * ```
 */
export function originOf(by: RecordStarter = "code", name?: string | null): RecordOrigin {
  const trimmed = by === "agent" ? (name?.trim() ?? "") : "";
  return { by, name: trimmed === "" ? null : trimmed.slice(0, NAME_LENGTH) };
}

/**
 * What finishing a log did: the finished log (the last continuation when the stop went over the
 * cap), the first write that failed on the way, the continuations' names.
 */
export type Finished = {
  readonly info: LogFileInfo;
  readonly failure: WriteFailure | undefined;
  readonly continued: readonly string[];
};

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
 * Whether the header names a device model.
 *
 * @param model - The header's `device.model`.
 * @returns True for a non-empty model.
 * @example
 * ```ts
 * hasModel(""); // false
 * ```
 */
function hasModel(model: string | null | undefined): model is string {
  return typeof model === "string" && model !== "";
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
  // Slug: the model lower-cased, every character outside [a-z0-9-] a dash; `device` without one.
  const slug = hasModel(model) ? model.toLowerCase().replaceAll(/[^\da-z-]/g, "-") : "device";

  // Stamp: the local day and minute of the start.
  const day = `${at.getFullYear()}${twoDigits(at.getMonth() + 1)}${twoDigits(at.getDate())}`;
  const base = `perf-${day}-${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}-${slug}`;

  // Free-name search: -2, -3, … before `.jsonl` until no log has the name.
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
 * Whether the newest display is news for a log start: there is one, and it came after the header
 * (or there is no header).
 *
 * @param display - The newest `display` event line.
 * @param header - The newest header line.
 * @returns Whether the start repeats the display.
 * @example
 * ```ts
 * isDisplayAfterHeader(undefined, undefined); // false
 * ```
 */
function isDisplayAfterHeader(
  display: PerfEventLine | undefined,
  header: PerfHeaderLine | undefined
): display is PerfEventLine {
  return display !== undefined && (header === undefined || display.t > header.t);
}

/**
 * Queues the context lines of a log start: the newest header, the startup, the newest display
 * when it came after the header, then the newest `rate`, `sections` and `debug` events (a log
 * started mid-run says the rate in force, what is measured and whether the overdraw heat map is
 * on), each only when there is one.
 *
 * @param state - The recorder's state.
 */
function queueContext(state: RecorderState): void {
  const { header, startup, display, rate, sections, debug } = state;
  if (header !== undefined) enqueue(state, header);
  if (startup !== undefined) enqueue(state, startup);
  if (isDisplayAfterHeader(display, header)) enqueue(state, display);
  for (const line of [rate, sections, debug]) {
    if (line !== undefined) enqueue(state, line);
  }
}

/**
 * Writes the `recorder` start event of a log through the engine: its label and who started it.
 *
 * @param monitor - The engine monitor.
 * @param session - The new log.
 * @param origin - Who started it.
 */
function writeStartEvent(monitor: MonitorLike, session: Session, origin: RecordOrigin): void {
  monitor.event("recorder", {
    action: "start",
    label: session.label,
    by: origin.by,
    name: origin.name
  });
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
 * The names a new log may not take: every log in the list and every name given in this run (a log
 * keepFiles or keepMb removed still names lines the computer has).
 *
 * @param state - The recorder's state.
 * @returns The names.
 */
function takenNames(state: RecorderState): Set<string> {
  const taken = new Set(state.named);
  for (const file of state.files) taken.add(file.name);
  return taken;
}

/**
 * A new log's session: its name (remembered in `named`), its label (trimmed; empty is none), zeros, the recorder's store.
 *
 * @param state - The recorder's state.
 * @param label - A name for the run, as given.
 * @param startedAt - Epoch ms of the start.
 * @param taken - The names it may not take (`takenNames`).
 * @param capBytes - The log's hard cap in UTF-8 bytes.
 * @returns The session.
 */
function createSession(
  state: RecorderState,
  label: string | undefined,
  startedAt: number,
  taken: ReadonlySet<string>,
  capBytes: number
): Session {
  const trimmed = label?.trim() ?? "";
  const name = logFileName(state.header?.device.model, new Date(startedAt), taken);
  state.named.add(name);
  return {
    name,
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
    inflight: undefined,
    full: false,
    capBytes
  };
}

/**
 * Makes a session the current log: its origin, its phase (exporting while a share runs), no marks,
 * no failures, no pending autoStart, an empty queue.
 *
 * @param state - The recorder's state.
 * @param session - The new log.
 * @param origin - Who started it.
 */
function resetForNewLog(state: RecorderState, session: Session, origin: RecordOrigin): void {
  state.session = session;
  state.startedBy = origin;
  state.phase = state.exports > 0 ? "exporting" : "recording";
  state.marks = [];
  state.failures = 0;
  state.autoStartWait = 0;
  clearQueue(state);
}

/**
 * Starts a log (`start`, `editor.record`, autoStart, a rotation): the session and who started it,
 * the context lines and the `recorder` start event in the queue, the log in the list, keepFiles,
 * the status. A running log is answered as it is, its origin unchanged.
 *
 * @param ctx - The recorder's context.
 * @param label - A name for the run; trimmed, empty is none.
 * @param origin - Who starts it; the game's own code when not given.
 * @returns The new (or running) log.
 * @throws {Error} When perf found no monitor.
 */
export function startRecording(
  ctx: RecorderCtx,
  label?: string,
  origin: RecordOrigin = originOf()
): LogFileInfo {
  const { state } = ctx;
  // Guard: a running log is answered as it is; without a monitor nothing can be recorded.
  if (state.session !== undefined) return infoOf(state.session);
  const { monitor } = state;
  if (monitor === undefined) throw new Error(NO_MONITOR);

  // Build: the session, named by the local minute and the header's model, never a taken name.
  const taken = takenNames(state);
  const session = createSession(state, label, Date.now(), taken, ctx.config.maxLogMb * MEGABYTE);

  // Reset: the new log is the current one, with its origin, an empty queue and no marks.
  resetForNewLog(state, session, origin);

  // Queue context: the header, startup, newest display, rate, sections and debug first, then the
  // start event.
  queueContext(state);
  writeStartEvent(monitor, session, origin);

  // Announce: the log in the list (keepFiles applied), the status event, the log line.
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
 * Writes the text of a failed write at stop to memory: the failed chunk is back in the pending text;
 * the log moves to memory unless the third failure in a row already moved it.
 *
 * @param state - The recorder's state.
 * @param session - The finishing log.
 * @param failure - The failed write.
 * @returns The failure, the log now in memory.
 */
async function retryInMemory(
  state: RecorderState,
  session: Session,
  failure: WriteFailure
): Promise<WriteFailure> {
  if (!failure.moved) moveToMemory(state, session);
  await persistAll(state, session);
  return { message: failure.message, moved: true };
}

/**
 * Whether a queued line is the `recorder` stop event the stop just wrote.
 *
 * @param line - A queued line.
 * @returns Whether it is the stop event.
 */
function isStopEvent(line: PerfLogLine | undefined): line is PerfEventLine {
  return (
    line?.kind === "event" &&
    line.name === "recorder" &&
    Reflect.get(Object(line.detail), "action") === "stop"
  );
}

/**
 * Opens the continuation of a log a stop closed at its cap: the next name, the same label, cap and
 * origin, the context lines and the start event; listed as current until it is written.
 *
 * @param state - The recorder's state.
 * @param part - The log closed at its cap.
 * @param monitor - The engine monitor.
 * @returns The continuation, now the session.
 */
function openContinuation(state: RecorderState, part: Session, monitor: MonitorLike): Session {
  const taken = takenNames(state);
  const next = createSession(state, part.label ?? undefined, Date.now(), taken, part.capBytes);
  const origin = state.startedBy ?? originOf();
  resetForNewLog(state, next, origin);
  queueContext(state);
  writeStartEvent(monitor, next, origin);
  state.files.push(infoOf(next));
  return next;
}

/**
 * The UTF-8 size of the stop event the stop just queued (the last queued line), with its newline;
 * 0 when it is not queued (no listener).
 *
 * @param state - The recorder's state.
 * @returns The bytes to keep free for it.
 */
function queuedStopSize(state: RecorderState): number {
  if (state.queueSize === 0) return 0;
  const last = state.queue[(state.queueHead + state.queueSize - 1) % state.queue.length];
  return isStopEvent(last) ? utf8Length(JSON.stringify(last)) + 1 : 0;
}

/**
 * Closes the running log at a stop without passing its cap: the stop event, then the queue drained
 * up to the cap less the stop event's own size. Lines that do not fit are kept, not dropped: the
 * stop event closes this log, and the rest goes into a short continuation (the same label, the
 * context lines, its own start and stop events), as often as needed. State-only, so onStop closes
 * the same way.
 *
 * @param state - The recorder's state.
 * @param first - The running log.
 * @param monitor - The engine monitor.
 * @returns Every log closed, the running one first.
 */
function closeWithinCap(state: RecorderState, first: Session, monitor: MonitorLike): Session[] {
  const parts = [first];
  let part = first;
  // Each round takes at least one line into a fresh part, so the queued lines bound the rounds;
  // the last round takes everything left.
  const rounds = state.queueSize + 2;
  for (let round = 1; ; round += 1) {
    // Stop event, then the queue up to the cap (the tick's own full mark does not count here).
    part.full = false;
    monitor.event("recorder", { action: "stop" });
    const budget =
      round < rounds ? part.capBytes - queuedStopSize(state) : Number.POSITIVE_INFINITY;
    drain(state, budget);
    if (!part.full) return parts;

    // Over the cap: the stop event (queued last) closes this part, within the cap.
    const rest = takeQueue(state);
    const stop = rest.at(-1);
    if (isStopEvent(stop)) {
      rest.pop();
      enqueue(state, stop);
      drain(state);
    }
    if (rest.length === 0) return parts;

    // The rest continues in a short log of its own.
    part = openContinuation(state, part, monitor);
    parts.push(part);
    for (const line of rest) enqueue(state, line);
  }
}

/**
 * Writes a closed log: every pending text (to memory when the store fails), then its final info in
 * the list and its meta rewritten `current: false`.
 *
 * @param state - The recorder's state.
 * @param part - The closed log.
 * @returns The final info and the failed write.
 */
async function writeClosed(
  state: RecorderState,
  part: Session
): Promise<{ readonly info: LogFileInfo; readonly failure: WriteFailure | undefined }> {
  const written = await persistAll(state, part);
  const failure = written === undefined ? undefined : await retryInMemory(state, part, written);
  const info: LogFileInfo = {
    ...(findFile(state, part.name) ?? infoOf(part)),
    current: false,
    storage: part.store.kind
  };
  replaceFile(state, info);
  await part.store.describe(info).catch(() => {});
  return { info, failure };
}

/**
 * Writes every closed log in order and makes the last one `last`.
 *
 * @param state - The recorder's state.
 * @param parts - The closed logs, the running one first.
 * @returns The last log's info, the first failed write, the continuations' names.
 */
async function writeAll(state: RecorderState, parts: readonly Session[]): Promise<Finished> {
  let info: LogFileInfo | undefined;
  let failure: WriteFailure | undefined;
  for (const part of parts) {
    const written = await writeClosed(state, part);
    info = written.info;
    failure ??= written.failure;
  }
  const last = info ?? infoOf(parts[0] as Session);
  state.last = last;
  return { info: last, failure, continued: parts.slice(1).map(part => part.name) };
}

/**
 * Finishes the running log (`stop`, onStop and a rotation): the stop event, the queue drained
 * inside the agent span without passing the log's cap (lines over it go into a short continuation,
 * never dropped), every pending text written (to memory when the store fails), the meta rewritten
 * `current: false`. Needs no emit and no log. A continuation is in `state.finishing` until written.
 *
 * @param state - The recorder's state.
 * @returns The finished log (the last continuation when there is one), the failed write and the
 *   continuations; undefined when no log was running.
 */
export async function finishLog(state: RecorderState): Promise<Finished | undefined> {
  // Guard: no log runs, nothing to finish.
  const { session, monitor } = state;
  if (session === undefined || monitor === undefined) return undefined;

  // Close the log: the stop event and the queue, within the cap, inside the agent span.
  monitor.beginAgent();
  let parts: Session[];
  try {
    parts = closeWithinCap(state, session, monitor);
  } finally {
    monitor.endAgent();
  }

  // Detach: the recorder is idle (or exporting) and nobody's log runs; each closed log stays
  // current in the list (keepMb and keepFiles leave it alone) until its text is in the store.
  state.session = undefined;
  state.startedBy = undefined;
  state.phase = state.exports > 0 ? "exporting" : "idle";
  for (const part of parts) replaceFile(state, infoOf(part));

  // Write: each closed log in order; a continuation is waited for like the log itself.
  const writing = writeAll(state, parts);
  for (const part of parts.slice(1)) trackFinish(state, part.name, writing);
  return writing;
}

/**
 * Keeps the finish of a log in `state.finishing` until it settles (whatever its outcome), so a
 * remove or a share of that log, and onStop, wait for it.
 *
 * @param state - The recorder's state.
 * @param name - The log being finished.
 * @param finish - Its finish.
 * @returns The entry: settles with the finish, never rejects.
 */
export function trackFinish(
  state: RecorderState,
  name: string,
  finish: Promise<unknown>
): Promise<void> {
  const entry = finish.then(
    () => {},
    () => {}
  );
  state.finishing.set(name, entry);
  entry.then(() => {
    if (state.finishing.get(name) === entry) state.finishing.delete(name);
  });
  return entry;
}

/**
 * Stops the running log (`stop`, `editor.record { on: false }`): finishes it, warns a failed write,
 * emits the status and logs `recorder:stopped`.
 *
 * @param ctx - The recorder's context.
 * @returns The finished log; undefined when no log was running.
 */
export async function stopRecording(ctx: RecorderCtx): Promise<LogFileInfo | undefined> {
  const name = ctx.state.session?.name;
  const finishing = finishLog(ctx.state);
  if (name !== undefined) trackFinish(ctx.state, name, finishing);
  const finished = await finishing;
  if (finished === undefined) return undefined;
  const { info, failure, continued } = finished;
  let from = name ?? info.name;
  for (const to of continued) {
    ctx.log.info("recorder:rotated", { from, to });
    from = to;
  }
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
  // A log still being finished is removed after its finish, or the finish would write it again;
  // its info is read again (the finish may have moved it to memory).
  await state.finishing.get(name);
  await dropLog(state, findFile(state, name) ?? info);
  state.files = state.files.filter(file => file.name !== name);
  emitStatus(ctx, true);
}
