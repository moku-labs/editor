/**
 * @file overlay plugin — builds the domain context from the plugin context, once per plugin
 * state: the api, the hooks and the lifecycle share one context, so one set of visitors and one
 * set of view actions exists per app.
 */
import { channelPlugin } from "../channel";
import { perfPlugin } from "../perf";
import {
  createGraphState,
  msToPx,
  paintGraph,
  resetGraphText,
  rowAt,
  spikeAt
} from "../perf/graph";
import { recorderPlugin } from "../recorder";
import { registryPlugin } from "../registry";
import { createVisitors } from "./paint/graph";
import type { GraphSeam, OverlayCtx, OverlayPluginCtx, OverlayState } from "./types";

/**
 * The painter seam of the app: `perf/graph` on the canvas's own 2D context.
 */
export const GRAPH: GraphSeam = {
  context: canvas => canvas.getContext("2d") ?? undefined,
  paint: paintGraph,
  spikeAt,
  rowAt,
  createState: createGraphState,
  resetText: resetGraphText,
  msToPx
};

/** The domain context of each plugin state. */
const contexts = new WeakMap<OverlayState, OverlayCtx>();

/**
 * `{ config, state, log, emit, registry, channel, perf, recorder, graph, visitors }`, made once per
 * plugin state. The real apis satisfy the narrower OverlayCtx shapes structurally.
 *
 * @param ctx - Plugin context of the overlay.
 * @returns The domain context of the overlay modules.
 */
export function overlayCtxOf(ctx: OverlayPluginCtx): OverlayCtx {
  const known = contexts.get(ctx.state);
  if (known !== undefined) return known;

  const octx: OverlayCtx = {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    emit: ctx.emit,
    registry: ctx.require(registryPlugin),
    channel: ctx.require(channelPlugin),
    perf: ctx.require(perfPlugin),
    recorder: ctx.require(recorderPlugin),
    graph: GRAPH,
    visitors: createVisitors(ctx.state, GRAPH)
  };
  contexts.set(ctx.state, octx);
  return octx;
}
