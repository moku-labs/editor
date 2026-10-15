/**
 * @file recorder plugin — the pipeline after the listener: the flush tick serializes the queue
 * inside `beginAgent` / `endAgent` (so the log never costs a game frame and its own time is left out
 * of the spike rule), bounds memory by keepMb, and hands chunks to the store after the span; a
 * failed write keeps its chunk, and the third failure in a row moves the log to memory.
 */
import { dropOldestLine, pushOutbox } from "./outbox";
import { dropLog, emitStatus, infoOf } from "./state";
import { messageOf } from "./store";
import type { RecorderConfig, RecorderCtx, RecorderState, Session } from "./types";

/** Pending text that is written at once, whatever persistEveryMs says. */
export const PERSIST_BYTES = 65_536;

/** Consecutive failed writes that move a log to the memory store. */
export const MAX_FAILURES = 3;

/** Bytes in a megabyte (keepMb, the native share's limit). */
export const MEGABYTE = 1_048_576;

/** A write that failed: its message, and whether the log moved to memory with it. */
export type WriteFailure = { readonly message: string; readonly moved: boolean };

/**
 * The JSON text of a line; undefined when it cannot be serialized (the engine's lines are plain
 * JSON, so this is defensive).
 *
 * @param line - A queued line.
 * @returns Its text.
 */
function serialize(line: unknown): string | undefined {
  try {
    const text: unknown = JSON.stringify(line);
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serializes the queue in order into the current log: its pending text and the outbox, each line
 * with its index in the log. A line that does not serialize is dropped and counted.
 *
 * @param state - The recorder's state.
 */
export function drain(state: RecorderState): void {
  const { queue, session } = state;
  while (state.queueSize > 0) {
    const line = queue[state.queueHead];
    queue[state.queueHead] = undefined;
    state.queueHead = (state.queueHead + 1) % queue.length;
    state.queueSize -= 1;
    if (session === undefined) continue;

    const text = serialize(line);
    if (text === undefined) {
      state.dropped += 1;
      continue;
    }
    session.pending.push(text);
    session.pendingBytes += text.length + 1;
    pushOutbox(state, text, session.name, session.lines);
    session.lines += 1;
    session.bytes += text.length + 1;
  }
}

/**
 * Keeps the outbox, the memory store and the pending text under keepMb: the oldest finished log of
 * the memory store goes first, then the oldest outbox lines. The current log's text is never
 * removed while it records.
 *
 * @param ctx - The recorder's context (config, state, log).
 */
export function trimToKeepMb(ctx: Pick<RecorderCtx, "config" | "state" | "log">): void {
  const { state } = ctx;
  const limit = ctx.config.keepMb * MEGABYTE;
  const over = (): boolean =>
    state.outboxBytes + state.memory.memoryBytes() + (state.session?.pendingBytes ?? 0) > limit;

  while (over()) {
    const oldest = state.files.find(file => file.storage === "memory" && !file.current);
    if (oldest !== undefined) {
      state.files = state.files.filter(file => file !== oldest);
      dropLog(state, oldest).catch(() => {});
      ctx.log.info("recorder:dropped-log", { file: oldest.name });
      continue;
    }
    if (!dropOldestLine(state)) return;
    state.dropped += 1;
  }
}

/**
 * Takes the pending text of a log as one chunk.
 *
 * @param session - The log.
 * @param now - Epoch ms now.
 * @returns The chunk: every pending line and a newline after each.
 */
function takeChunk(session: Session, now: number): string {
  const chunk = `${session.pending.join("\n")}\n`;
  session.pending = [];
  session.pendingBytes = 0;
  session.lastPersistAt = now;
  return chunk;
}

/**
 * Moves a log to the memory store for the rest of its life. Nothing is copied into the heap: the
 * chunks its store already has stay there (`heads`, so a read and a remove take both parts), and
 * every later write goes to memory. The store's meta keeps the numbers of its last chunk, so the
 * next launch lists that part as a finished log.
 *
 * @param state - The recorder's state.
 * @param session - The log.
 */
export function moveToMemory(state: RecorderState, session: Session): void {
  if (session.chunks > 0) state.heads.set(session.name, session.store);
  session.store = state.memory;
  session.chunks = 0;
  state.failures = 0;
}

/**
 * Writes a chunk of a log to its store. A rejection puts the chunk back in front of the pending
 * text; the third in a row moves the log to memory.
 *
 * @param state - The recorder's state.
 * @param session - The log.
 * @param chunk - The text.
 * @returns The failure; undefined when the chunk was written.
 */
async function writeChunk(
  state: RecorderState,
  session: Session,
  chunk: string
): Promise<WriteFailure | undefined> {
  const info = infoOf(session);
  try {
    await session.store.append(info, chunk);
    state.failures = 0;
    session.chunks += 1;
    return undefined;
  } catch (error) {
    session.pending.unshift(chunk.slice(0, -1));
    session.pendingBytes += chunk.length;
    state.failures += 1;
    const message = messageOf(error);
    if (state.failures < MAX_FAILURES) return { message, moved: false };
    moveToMemory(state, session);
    return { message, moved: true };
  }
}

/**
 * Writes a chunk, reports the outcome, and frees the log's write slot.
 *
 * @param state - The recorder's state.
 * @param session - The log.
 * @param chunk - The text.
 * @param report - Called with the outcome before the slot is freed.
 * @returns The failure; undefined when the chunk was written.
 */
async function write(
  state: RecorderState,
  session: Session,
  chunk: string,
  report: (failure: WriteFailure | undefined) => void
): Promise<WriteFailure | undefined> {
  try {
    const failure = await writeChunk(state, session, chunk);
    report(failure);
    return failure;
  } finally {
    session.inflight = undefined;
  }
}

/**
 * Starts the write of a chunk as the log's one write in flight (`session.inflight`), so the chunks
 * keep their order.
 *
 * @param state - The recorder's state.
 * @param session - The log.
 * @param chunk - The text.
 * @param report - Called with the outcome.
 * @returns The write.
 */
function startWrite(
  state: RecorderState,
  session: Session,
  chunk: string,
  report: (failure: WriteFailure | undefined) => void = () => {}
): Promise<WriteFailure | undefined> {
  const writing = write(state, session, chunk, report);
  session.inflight = writing;
  return writing;
}

/**
 * Writes all pending text of a log to its store, after the write in flight.
 *
 * @param state - The recorder's state.
 * @param session - The log.
 * @returns The failure; undefined when everything was written.
 */
export async function persistAll(
  state: RecorderState,
  session: Session
): Promise<WriteFailure | undefined> {
  while (session.inflight !== undefined) await session.inflight;
  if (session.pending.length === 0) return undefined;
  return startWrite(state, session, takeChunk(session, Date.now()));
}

/**
 * Warns a failed write, and the move to memory it caused.
 *
 * @param ctx - The recorder's log.
 * @param file - The log's name.
 * @param failure - What failed.
 */
export function warnFailure(
  ctx: Pick<RecorderCtx, "log">,
  file: string,
  failure: WriteFailure | undefined
): void {
  if (failure === undefined) return;
  ctx.log.warn("recorder:persist-failed", { file, message: failure.message });
  if (failure.moved) {
    ctx.log.info("recorder:storage", {
      kind: "memory",
      reason: `the store failed: ${failure.message}`
    });
  }
}

/**
 * Warns once per drop streak: a tick that ends with more drops than the last one opens or continues
 * a streak, a tick without drops closes it.
 *
 * @param ctx - The recorder's state and log.
 */
function noteDrops(ctx: Pick<RecorderCtx, "state" | "log">): void {
  const { state } = ctx;
  const dropped = state.dropped - state.droppedTick;
  state.droppedTick = state.dropped;
  if (dropped === 0) {
    state.dropping = false;
    return;
  }
  if (!state.dropping) ctx.log.warn("recorder:dropped", { dropped, total: state.dropped });
  state.dropping = true;
}

/**
 * Whether a log's pending text is due for the store: no write in flight, some text pending, and
 * persistEveryMs passed since the last write or 64 KB waiting.
 *
 * @param session - The current log, or none.
 * @param now - Epoch ms now.
 * @param config - The recorder's config.
 * @returns Whether the tick takes a chunk.
 */
function isChunkDue(
  session: Session | undefined,
  now: number,
  config: Readonly<RecorderConfig>
): session is Session {
  if (session === undefined || session.inflight !== undefined || session.pending.length === 0) {
    return false;
  }
  return (
    now - session.lastPersistAt >= config.persistEveryMs || session.pendingBytes >= PERSIST_BYTES
  );
}

/**
 * One tick of the recorder's timer: inside the agent span, drain the queue, bound memory and take
 * the chunk that is due (persistEveryMs, or 64 KB pending); after the span, start its write, warn a
 * drop streak and emit the status when a number changed.
 *
 * @param ctx - The recorder's context.
 */
export function flushTick(ctx: RecorderCtx): void {
  const { state, config } = ctx;
  const { monitor, session } = state;
  if (monitor === undefined) return;

  const now = Date.now();
  let chunk: string | undefined;
  // Inside the agent span (left out of the spike rule): serialize, bound memory, take the chunk
  // that is due. The span closes also when a step throws.
  monitor.beginAgent();
  try {
    drain(state);
    trimToKeepMb(ctx);
    if (isChunkDue(session, now, config)) chunk = takeChunk(session, now);
  } finally {
    monitor.endAgent();
  }

  // After the span: the write (async IO), the drop streak, the status when a number changed.
  if (session !== undefined && chunk !== undefined) {
    startWrite(state, session, chunk, failure => warnFailure(ctx, session.name, failure)).catch(
      () => {}
    );
  }
  noteDrops(ctx);
  emitStatus(ctx, false);
}
