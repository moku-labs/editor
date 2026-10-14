/**
 * @file collector plugin — onStop: the adb timers and the throttle timers cleared, every log done,
 * every queue awaited and every handle closed within STOP_FLUSH_MS. The teardown context has
 * neither `emit` nor `ctx.log`, so a queue still writing after the bound is recorded on its
 * session (`stopTimedOut`, reported by `sessions()`), never logged.
 */
import { stopAdbLoop } from "./adb/loop";
import { closeHandle } from "./session/writer";
import type { CollectorState, LogSession } from "./types";

/** How long onStop waits for the logs' queues, ms. */
export const STOP_FLUSH_MS = 2000;

/**
 * Waits for a log's queue, then closes its handle; when the bound runs out first, records
 * `stopTimedOut` (the handle closes when the queue is done).
 *
 * @param session - The log.
 * @returns When the log is flushed or the bound ran out.
 */
async function flushLog(session: LogSession): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(true), STOP_FLUSH_MS);
  });
  const flushed = session.queue.then(async () => {
    await closeHandle(session);
    return false;
  });

  const timedOut = await Promise.race([flushed, bound]);
  clearTimeout(timer);
  if (timedOut) session.stopTimedOut = true;
}

/**
 * collector's onStop. Touches the state only: no log, no emit (spec/08-CONTEXT.md §2).
 *
 * @param ctx - The teardown context (only its state is read).
 * @param ctx.state - The collector's state.
 * @returns When every log is flushed or the 2 s bound ran out.
 */
export async function stopCollector(ctx: { readonly state: CollectorState }): Promise<void> {
  const { state } = ctx;
  state.stopped = true;
  stopAdbLoop(ctx);
  state.devices.clear();
  for (const session of state.sessions.values()) {
    clearTimeout(session.emitTimer);
    session.emitTimer = undefined;
    session.state = "done";
  }

  await Promise.all([...state.sessions.values()].map(session => flushLog(session)));
}
