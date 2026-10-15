/**
 * @file recorder plugin — rotation at maxLogMb: a log that reached the cap is finished (stop event,
 * every line written, meta rewritten) and the next one starts at once with the same label and the
 * context lines. The switch is synchronous: `finishLog` detaches the full log before its first
 * await, so no line of the stream falls between the two logs or goes into both. The outbox keeps
 * the full log's unsent lines; the bridge ships them first, acked per log.
 */
import { MEGABYTE, warnFailure } from "./flush";
import { finishLog, startRecording } from "./session";
import type { RecorderCtx, Session } from "./types";

/**
 * Whether a log reached the size cap.
 *
 * @param session - The current log, or none.
 * @param maxLogMb - The config's maxLogMb.
 * @returns True for a log of at least maxLogMb.
 */
function isFull(session: Session | undefined, maxLogMb: number): session is Session {
  return session !== undefined && session.bytes >= maxLogMb * MEGABYTE;
}

/**
 * Rotates the current log when it reached maxLogMb: finishes it, starts the next with the same
 * label (status emitted, `recorder:started`), logs `recorder:rotated { from, to }`. A failed write
 * of the finished log is warned when its finish settles.
 *
 * @param ctx - The recorder's context.
 * @returns The finish of the full log (it never rejects); undefined when no log is full.
 */
export function rotateIfFull(ctx: RecorderCtx): Promise<void> | undefined {
  const { state } = ctx;
  const { session } = state;
  if (!isFull(session, ctx.config.maxLogMb)) return undefined;

  // Finish: detaches the full log at once (the rest of its finish is async IO).
  const finishing = finishLog(state);

  // Next: the same label, the context lines again, the start event.
  const next = startRecording(ctx, session.label ?? undefined);
  ctx.log.info("recorder:rotated", { from: session.name, to: next.name });

  return finishing.then(
    finished => warnFailure(ctx, session.name, finished?.failure),
    () => {}
  );
}
