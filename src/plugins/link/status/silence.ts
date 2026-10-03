/**
 * @file link plugin — the silence watch: a 1 s interval that turns live or paused into silent
 * when the chosen session stops beating (R6 silent rule).
 */

import type { LinkCtx } from "../types";
import { SILENCE_CHECK_MS, SILENT_AFTER_MS, SILENT_AFTER_PAUSED_MS } from "../types";
import { applyStatus } from "./machine";

/**
 * Starts the silence interval (an interval, not rAF: a background tools tab still runs it).
 *
 * @param ctx - Domain context of link.
 */
export function startSilenceWatch(ctx: LinkCtx): void {
  ctx.state.silenceTimer = setInterval(() => checkSilence(ctx), SILENCE_CHECK_MS);
}

/**
 * Sends `silence` when the last heartbeat is 6 s old, or 65 s old when it said `paused: true`.
 *
 * @param ctx - Domain context of link.
 */
export function checkSilence(ctx: LinkCtx): void {
  const { state } = ctx;
  const { heartbeat, status } = state;

  if (state.stopped || heartbeat === undefined) return;
  if (status.kind !== "live" && status.kind !== "paused") return;

  const limit = heartbeat.paused ? SILENT_AFTER_PAUSED_MS : SILENT_AFTER_MS;
  if (Date.now() - heartbeat.receivedAt >= limit) {
    applyStatus(ctx, { type: "silence", since: heartbeat.receivedAt });
  }
}
