/**
 * @file collector plugin — the per-log writer: each log's queue chains its writes in arrival
 * order (each batch on the previous), one `appendFile` per batch, `rx` on every device line, a
 * `gap` line for lines the device lost, `lost` for every line that could not be written (one
 * warning per failing streak), and the throttled `collector:session`.
 */
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path/posix";
import type { DeviceLines } from "../../hub/types";
import type { PerfGapLine } from "../report";
import type { CollectorCtx, CollectorSessionEvent, LogHandle, LogSession } from "../types";
import { offsetWith, pageTime } from "./clock";
import { readLine } from "./digest";

/** The least time between two `collector:session` of one log, ms. */
export const EMIT_EVERY_MS = 1000;

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
 * @returns The payload.
 */
export function eventOf(session: LogSession): CollectorSessionEvent {
  return {
    device: session.device,
    file: session.file,
    state: session.state,
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
 */
export function emitNow(ctx: CollectorCtx, session: LogSession): void {
  clearTimeout(session.emitTimer);
  session.emitTimer = undefined;
  if (ctx.state.stopped) return;

  session.emittedAt = Date.now();
  ctx.emit("collector:session", eventOf(session));
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
  session.queue = session.queue.then(() => writeText(ctx, session, text, count, io));
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
 * Closes a log after its pending writes (it left or finished), then emits its final counts.
 *
 * @param ctx - Domain context of the collector.
 * @param session - The log.
 * @returns The queue, settled when the handle is closed.
 */
export function closeLog(ctx: CollectorCtx, session: LogSession): Promise<void> {
  session.queue = session.queue.then(async () => {
    await closeHandle(session);
    emitNow(ctx, session);
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
 * Writes a device's batch synchronously into its log's queue: each line moves the page-clock
 * offset, feeds the digest and is written as `{ ...line, rx }`; a gap adds one `gap` line before
 * them; `lost` grows by the gap and the rejected lines.
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
    texts.push(JSON.stringify({ ...item, rx: batch.rx }));
  }
  if (batch.gap > 0) texts.unshift(JSON.stringify(gapLineOf(session, batch, firstT)));
  session.lost += batch.gap + batch.rejected;

  return texts.length === 0
    ? session.queue
    : enqueue(ctx, session, `${texts.join("\n")}\n`, texts.length, io);
}
