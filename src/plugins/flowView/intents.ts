/**
 * @file flowView plugin — the intents of other views (`workspace:select-node`,
 * `workspace:focus-frame`): run at once when the flow values are in, else kept until the first
 * ones arrive (the latest wins). Game is the default workspace, so an intent can come before
 * flowView has seen a graph, and a selection before the canvas has a size.
 */
import { actionsOf } from "./actions";
import type { FlowCtx, FlowIntent } from "./types";

/**
 * Runs an intent: selects its node (an unknown id warns) or focuses its frame (with its toasts).
 * A selection made before the default camera was applied (Flow shown for the first time, the
 * canvas not measured yet) is framed by the first measure instead of the current node.
 *
 * @param ctx - Domain context of flowView.
 * @param intent - The intent.
 */
function runIntent(ctx: FlowCtx, intent: FlowIntent): void {
  const { focus } = actionsOf(ctx);
  if (intent.kind === "frame") {
    focus.focusFrame(intent.frame);
    return;
  }
  if (!focus.select(intent.id)) {
    ctx.log.warn("flowView:unknown-node", { id: intent.id });
    return;
  }
  if (!ctx.state.camera.initialised) ctx.state.camera.frameSelection = true;
}

/**
 * Runs an intent now when the graph is in, else keeps it for `runPendingIntent`.
 *
 * @param ctx - Domain context of flowView.
 * @param intent - The intent.
 */
export function requestIntent(ctx: FlowCtx, intent: FlowIntent): void {
  if (ctx.state.data.graph === undefined) {
    ctx.state.data.pending = intent;
    return;
  }
  runIntent(ctx, intent);
}

/**
 * Runs the kept intent once the flow values are in (after an ingest).
 *
 * @param ctx - Domain context of flowView.
 */
export function runPendingIntent(ctx: FlowCtx): void {
  const { data } = ctx.state;
  const intent = data.pending;
  if (intent === undefined || data.graph === undefined) return;
  data.pending = undefined;
  runIntent(ctx, intent);
}
