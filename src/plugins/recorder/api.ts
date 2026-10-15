/**
 * @file recorder plugin — the API factory: thin calls into the domain files (session, marks,
 * share, outbox, state). The contract and the examples live on `RecorderApi` in types.ts.
 */

import { commandMark, markLog } from "./marks";
import { ackLines, unsentRun } from "./outbox";
import { removeLog, startRecording, stopRecording } from "./session";
import { shareLog } from "./share";
import { filesOf, statusOf } from "./state";
import type { RecorderApi, RecorderCtx } from "./types";

/**
 * Builds the recorder API over its context.
 *
 * @param ctx - The recorder's context.
 * @returns The recorder API.
 */
export function createRecorderApi(ctx: RecorderCtx): RecorderApi {
  const { state } = ctx;
  return {
    start: options => startRecording(ctx, options?.label),
    stop: () => stopRecording(ctx),
    mark: label => markLog(state, label),
    command: (id, input, label) => commandMark(state, id, input, label),
    status: () => statusOf(state),
    marks: () => [...state.marks],
    files: () => filesOf(state),
    share: name => shareLog(ctx, name),
    remove: name => removeLog(ctx, name),
    unsentRun: max => unsentRun(state, max),
    ack: (log, next) => {
      ackLines(state, log, next);
    }
  };
}
