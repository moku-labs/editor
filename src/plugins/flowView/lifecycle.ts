/**
 * @file flowView plugin — onInit (register the Flow panel, palette items, keys and Esc layers;
 * no I/O) and onStop (await a pending save at most 1000 ms, clear timers and rAF, dispose the
 * ELK engine, run every remover).
 */
import type { FlowCtx, FlowViewState } from "./types";

/**
 * onInit: panels.register(createFlowPanel(ctx)), palette Commands and Nodes, keys, Esc layers.
 *
 * @param _ctx - Domain context of flowView.
 * @example
 * ```ts
 * createToolsPlugin("flowView", { onInit: initFlowView });
 * ```
 */
export function initFlowView(_ctx: FlowCtx): void {
  throw new Error("not implemented");
}

/**
 * onStop: flushes the layout save (≤ 1000 ms), clears timers, cancels the tween, disposes the engine.
 *
 * @param _ctx - Teardown context.
 * @param _ctx.state - Own state.
 * @example
 * ```ts
 * createToolsPlugin("flowView", { onStop: stopFlowView });
 * ```
 */
export function stopFlowView(_ctx: { readonly state: FlowViewState }): Promise<void> {
  throw new Error("not implemented");
}
