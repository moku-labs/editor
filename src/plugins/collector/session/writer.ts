/**
 * @file collector plugin — the per-log writer: each log's queue chains its writes in arrival
 * order (each batch on the previous), one `appendFile` per batch, `rx` on every device line, a
 * `gap` line for lines the device lost, `lost` for every line that could not be written (one
 * warning per failing streak), at most QUEUE_MAX_BYTES waiting per log (a write beyond it is
 * dropped and counted lost, one warning per streak), whether the log records (its `recorder`
 * start and stop lines), and the throttled `collector:session`.
 */
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path/posix";
import type { DeviceLines } from "../../hub/types";
import type { PerfLogLine } from "../../perf/protocol";
import type { PerfGapLine } from "../report";
import type { CollectorCtx, CollectorSessionEvent, LogHandle, LogSession } from "../types";
import { offsetWith, pageTime } from "./clock";
import { readLine } from "./digest";

/** The least time between two `collector:session` of one log, ms. */
export const EMIT_EVERY_MS = 1000;

/** The most bytes that may wait in one log's queue (a stuck disk must not fill the memory). */
export const QUEUE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The file seam of the writer: node's `fs/promises` in the plugin, a fake in tests.
 *
 * @example
 * ```ts
 * const io: WriterIo = { mkdir: async () => undefined, open: async () => ({ appendFile: async () => undefined, close: async () => undefined }) };
 * ```
 */
export type WriterIo = {
  /**
   * Creates a folder and its parents.
   *
   * @param dir - The folder.
   * @returns When it exists.
   */
  mkdir(dir: string): Promise<unknown>;
  /**
   * Opens a file in append mode.
   *
   * @param file - The file.
   * @returns Its handle.
   */
  open(file: string): Promise<LogHandle>;
};

/** The writer's io on the real file system. */
export const nodeIo: WriterIo = {
  mkdir: dir => mkdir(dir, { recursive: true }),
  open: file => open(file, "a")
};

/**
 * The `collector:session` payload of a log, a fresh object.
 *
 * @param session - The log.
 * @param state - The state to report (the log's state now by default).
 * @returns The payload.
 */
export function eventOf(
  session: LogSession,
  state: LogSession["state"] = session.state
): CollectorSessionEvent {
  return {
    device: session.device,
    file: session.file,
    state,
    lines: session.lines,
    lost: session.lost,
    last: session.digest
  };
}

/**
 * Emits `collector:session` for a log now and cancels its pending trailing emit. Nothing after
 * stop.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @param state - The state to report (the log's state now by default).
 */
export function emitNow(
  ctx: CollectorCtx,
  session: LogSession,
  state: LogSession["state"] = session.state
): void {
  clearTimeout(session.emitTimer);
  session.emitTimer = undefined;
  if (ctx.state.stopped) return;

  session.emittedAt = Date.now();
  ctx.emit("collector:session", eventOf(session, state));
}

/**
 * Emits a log's state of now after its pending queue steps, so a close that is still pending
 * (away) is reported before this change (live again).
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @returns The queue, settled when the emit ran.
 */
export function emitQueued(ctx: CollectorCtx, session: LogSession): Promise<void> {
  const { state } = session;
  session.queue = session.queue.then(() => emitNow(ctx, session, state));
  return session.queue;
}

/**
 * The throttled emit of a live log: at once when the last emit is a second old, else one trailing
 * emit when the second is over (it carries the newest counts). A log that left or finished emits
 * from its close instead.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 */
export function emitSoon(ctx: CollectorCtx, session: LogSession): void {
  if (session.emitTimer !== undefined || session.state !== "live" || ctx.state.stopped) return;

  const wait = session.emittedAt + EMIT_EVERY_MS - Date.now();
  if (wait <= 0) {
    emitNow(ctx, session);
    return;
  }
  session.emitTimer = setTimeout(() => {
    session.emitTimer = undefined;
    emitNow(ctx, session);
  }, wait);
}

/**
 * Opens a log's file in append mode, its folder created first.
 *
 * @param session - The log.
 * @param io - The file seam.
 * @returns The handle, kept on the session.
 */
async function openLog(session: LogSession, io: WriterIo): Promise<LogHandle> {
  await io.mkdir(dirname(session.file));
  const handle = await io.open(session.file);
  session.handle = handle;
  return handle;
}

/**
 * Writes one batch: the handle opened when absent, one append. Success counts the lines; a failure
 * counts them lost and warns once per failing streak. Then the throttled emit. Never rejects.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @param text - The lines, each ending in `\n`.
 * @param count - How many lines.
 * @param io - The file seam.
 */
async function writeText(
  ctx: CollectorCtx,
  session: LogSession,
  text: string,
  count: number,
  io: WriterIo
): Promise<void> {
  try {
    const handle = session.handle ?? (await openLog(session, io));
    await handle.appendFile(text);
    session.lines += count;
    session.failing = false;
  } catch (error) {
    session.lost += count;
    if (!session.failing) {
      ctx.log.warn("collector:write-failed", {
        file: session.file,
        lines: count,
        error: String(error)
      });
    }
    session.failing = true;
  }
  emitSoon(ctx, session);
}

/**
 * Chains a write on a log's queue, so writes land in the order they were asked for.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @param text - The lines, each ending in `\n`.
 * @param count - How many lines.
 * @param io - The file seam (node's by default).
 * @returns The queue, settled when this write is done.
 */
export function enqueue(
  ctx: CollectorCtx,
  session: LogSession,
  text: string,
  count: number,
  io: WriterIo = nodeIo
): Promise<void> {
  const bytes = Buffer.byteLength(text);
  if (session.queued + bytes > QUEUE_MAX_BYTES) {
    session.lost += count;
    if (!session.queueFull) {
      ctx.log.warn("collector:queue-full", { file: session.file, bytes: QUEUE_MAX_BYTES });
    }
    session.queueFull = true;
    emitSoon(ctx, session);
    return session.queue;
  }

  session.queueFull = false;
  session.queued += bytes;
  session.queue = session.queue.then(async () => {
    await writeText(ctx, session, text, count, io);
    session.queued -= bytes;
  });
  return session.queue;
}

/**
 * Closes a log's handle now (onStop, and the queue step of `closeLog`). A failing close loses no
 * line: every write before it was awaited.
 *
 * @param session - The log.
 * @returns When the handle is closed.
 */
export async function closeHandle(session: Pick<LogSession, "handle">): Promise<void> {
  const { handle } = session;
  session.handle = undefined;
  await handle?.close().catch(() => {});
}

/**
 * Closes a log's file after its pending writes, without an emit (the device started another
 * log); the next write reopens it.
 *
 * @param session - The log.
 * @returns The queue, settled when the handle is closed.
 */
export function closeFile(session: LogSession): Promise<void> {
  session.queue = session.queue.then(() => closeHandle(session));
  return session.queue;
}

/**
 * Closes a log after its pending writes (it left or finished), then emits its final counts with
 * the state it had when it was closed.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @returns The queue, settled when the handle is closed.
 */
export function closeLog(ctx: CollectorCtx, session: LogSession): Promise<void> {
  const { state } = session;
  session.queue = session.queue.then(async () => {
    await closeHandle(session);
    emitNow(ctx, session, state);
  });
  return session.queue;
}

/**
 * The gap line of a batch: before its lines, at the first line's `t`, else on the log's page
 * clock.
 *
 * @param session - The log.
 * @param batch - The batch.
 * @param firstT - The first finite `t` of the batch.
 * @returns The line.
 */
function gapLineOf(
  session: LogSession,
  batch: DeviceLines,
  firstT: number | undefined
): PerfGapLine {
  return {
    v: 1,
    kind: "gap",
    t: firstT ?? pageTime(session.offset, batch.rx),
    build: session.build,
    rx: batch.rx,
    device: session.model,
    lines: batch.gap
  };
}

/**
 * Whether a log records after one of its lines: a `recorder` event line with `action: "start"`
 * turns it on, one with `action: "stop"` off; every other line leaves it as it was. The detail is
 * read defensively (the hub vouches for `v` and `kind` only).
 *
 * @param recording - Whether the log recorded before the line.
 * @param item - The line.
 * @returns Whether it records after it.
 */
function recordingAfter(recording: boolean, item: PerfLogLine): boolean {
  if (item.kind !== "event" || item.name !== "recorder") return recording;

  const action = item.detail?.action;
  if (action === "start") return true;
  return action === "stop" ? false : recording;
}

/**
 * Writes a device's batch synchronously into its log's queue: each line moves the page-clock
 * offset, feeds the digest, sets whether the log records and is written as `{ ...line, rx }`; a
 * gap adds one `gap` line before them; `lost` grows by the gap and the rejected lines (a batch that
 * only lost lines still emits).
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @param batch - The batch as the hub accepted it.
 * @param io - The file seam (node's by default).
 * @returns The queue, settled when the batch is written.
 */
export function writeLines(
  ctx: CollectorCtx,
  session: LogSession,
  batch: DeviceLines,
  io: WriterIo = nodeIo
): Promise<void> {
  const texts: string[] = [];
  let firstT: number | undefined;
  for (const item of batch.items) {
    session.offset = offsetWith(session.offset, item.t, batch.rx);
    if (firstT === undefined && Number.isFinite(item.t)) firstT = item.t;
    readLine(session, item);
    session.recording = recordingAfter(session.recording, item);
    texts.push(JSON.stringify({ ...item, rx: batch.rx }));
  }
  if (batch.gap > 0) texts.unshift(JSON.stringify(gapLineOf(session, batch, firstT)));
  session.lost += batch.gap + batch.rejected;

  if (texts.length === 0) {
    emitSoon(ctx, session);
    return session.queue;
  }

  return enqueue(ctx, session, `${texts.join("\n")}\n`, texts.length, io);
}
