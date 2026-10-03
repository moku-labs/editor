/**
 * @file flowView plugin — onInit (register the Flow panel, the palette Commands, the Flow keys and
 * the Esc layers; capture link.files; no I/O) and onStop (wait for a pending layout save at most
 * 1000 ms, clear timers and the rAF, dispose the ELK engine, run every remover).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { actionsOf } from "./actions";
import { escapeLayers, flowKeys } from "./keys";
import { commandItems } from "./palette";
import { createFlowPanel } from "./panel";
import type { FlowCtx, FlowViewState } from "./types";

/**
 * Longest wait for a pending layout save on stop.
 */
const SAVE_WAIT_MS = 1000;

/**
 * onInit: registers the Flow panel (D-04), adds the Commands, binds the Flow keys and the Esc layers
 * and keeps every remover; captures link.files for the stop flush.
 *
 * @param ctx - Domain context of flowView.
 * @example
 * ```ts
 * createToolsPlugin("flowView", { onInit: initFlowView });
 * ```
 */
export function initFlowView(ctx: FlowCtx): void {
  const actions = actionsOf(ctx);
  const workspace = ctx.require(workspacePlugin);
  const { view } = ctx.state;
  ctx.require(panelsPlugin).register(createFlowPanel(ctx));
  view.files = ctx.require(linkPlugin).files;
  view.removers.push(workspace.palette.add(commandItems(ctx, actions)));
  for (const binding of flowKeys(ctx, actions)) view.removers.push(workspace.keys.bind(binding));
  for (const [layer, close] of escapeLayers(actions)) {
    view.removers.push(workspace.keys.escape(layer, close));
  }
}

/**
 * onStop (TeardownContext: own state only): waits for a pending layout save at most 1000 ms, clears
 * the timers, cancels the camera rAF, disposes the ELK engine (worker terminated, Blob URL revoked)
 * and runs every remover.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 * @returns Resolves when torn down.
 * @example
 * ```ts
 * createToolsPlugin("flowView", { onStop: stopFlowView });
 * ```
 */
export async function stopFlowView(ctx: { readonly state: FlowViewState }): Promise<void> {
  const { layout, view, camera } = ctx.state;
  if (layout.saving !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>(resolve => {
      timer = setTimeout(resolve, SAVE_WAIT_MS);
    });
    await Promise.race([layout.saving.catch(() => {}), limit]);
    clearTimeout(timer);
  }
  for (const timer of view.timers) clearTimeout(timer);
  view.timers.clear();
  if (camera.anim !== undefined && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(camera.anim);
  }
  camera.anim = undefined;
  layout.engine?.dispose();
  layout.engine = undefined;
  view.palette.nodes?.();
  view.palette.styles?.();
  view.palette = { nodes: undefined, styles: undefined };
  for (const remove of view.removers.splice(0)) remove();
}
