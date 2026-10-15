/**
 * @file recorder plugin — rotation at maxLogMb. The tick's drain stops before the line that would
 * carry the log past its budget (maxLogMb less the headroom, in UTF-8 bytes) and marks the log
 * full; the rotation carries the lines still queued out, finishes the full log (its stop event,
 * every line written, the meta rewritten) and starts the next one at once with the same label and
 * the context lines, followed by the carried lines. The switch is synchronous: `finishLog`
 * detaches the full log before its first await, so no line falls between the two logs or goes into
 * both. The outbox keeps the full log's unsent lines; the bridge ships them first, acked per log.
 */
import { warnFailure } from "./flush";
import { enqueue, takeQueue } from "./listener";
import { finishLog, startRecording, trackFinish } from "./session";
import { messageOf } from "./store";
import type { RecorderCtx } from "./types";

/**
 * Rotates the current log when the tick marked it full: finishes it, starts the next with the
 * same label (status emitted, `recorder:started`), logs `recorder:rotated { from, to }`. A finish
 * that fails before it detached the log rotates nothing: the carried lines go back to the queue
 * and `recorder:rotate-failed` warns. A failed write of the finished log is warned when its finish
 * settles.
 *
 * @param ctx - The recorder's context.
 * @returns The finish of the full log (it never rejects); undefined when no log is full.
 */
export function rotateIfFull(ctx: RecorderCtx): Promise<void> | undefined {
  const { state } = ctx;
  const { session } = state;
  if (session?.full !== true) return undefined;

  // Carry: the lines that did not fit leave the queue; they follow the next log's start.
  const carry = takeQueue(state);

  // Finish: the stop event goes into the full log, which is detached at once (the rest is IO).
  const failed = (error: unknown): void => {
    ctx.log.warn("recorder:rotate-failed", { file: session.name, message: messageOf(error) });
  };
  const finishing = finishLog(state);

  // Not detached: the finish failed before it let go of the log; nothing rotates and the carried
  // lines go back to the queue.
  const detached = state.session !== session;
  if (!detached) {
    for (const line of carry) enqueue(state, line);
    return finishing.then(() => {}, failed);
  }
  const finished = trackFinish(
    state,
    session.name,
    finishing.then(done => warnFailure(ctx, session.name, done?.failure), failed)
  );

  // Next: the same label, the context lines again, the start event, then the carried lines.
  const next = startRecording(ctx, session.label ?? undefined);
  for (const line of carry) enqueue(state, line);
  ctx.log.info("recorder:rotated", { from: session.name, to: next.name });
  return finished;
}
