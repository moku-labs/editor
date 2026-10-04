/**
 * @file flowView plugin — the data path (R6): one `link.watch` each of game.graph, game.position
 * and game.history {last: historyLast} for the whole session, whatever workspace shows (link keeps
 * them while disconnected and sends them again after a reconnect or a session change). The values
 * go in once all three arrived, then one by one; an intent that waited for them runs after.
 */
import { linkPlugin } from "../link";
import type { Json } from "../registry/protocol";
import { ingest } from "./data";
import { runPendingIntent } from "./intents";
import type { FlowCtx, FlowSources, FlowValues } from "./types";

/**
 * The sources flowView watches.
 *
 * @param ctx - Domain context of flowView.
 * @returns The three source refs.
 */
function flowSources(ctx: FlowCtx): FlowSources {
  return {
    graph: "game.graph",
    position: "game.position",
    history: ["game.history", { last: ctx.config.historyLast }]
  };
}

/**
 * Keeps one watch value; once every source has a value, ingests them and runs a waiting intent.
 *
 * @param ctx - Domain context of flowView.
 * @param key - Which source.
 * @param value - Its new value.
 */
function take(ctx: FlowCtx, key: keyof FlowValues, value: Json): void {
  const { values } = ctx.state.data;
  values[key] = value;
  const { graph, position, history } = values;
  if (graph === undefined || position === undefined || history === undefined) return;

  ingest(ctx, { graph, position, history });
  runPendingIntent(ctx);
}

/**
 * Starts the three session watches; their unsubscribes join the removers onStop runs.
 *
 * @param ctx - Domain context of flowView.
 */
export function startDataWatches(ctx: FlowCtx): void {
  const link = ctx.require(linkPlugin);
  const { graph, position, history } = flowSources(ctx);
  ctx.state.view.removers.push(
    link.watch(graph, undefined, value => take(ctx, "graph", value)),
    link.watch(position, undefined, value => take(ctx, "position", value)),
    link.watch(history[0], history[1], value => take(ctx, "history", value))
  );
}
