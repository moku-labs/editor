/**
 * @file flowView plugin — hooks of the global tools events (R4): link:status (stale marking, none
 * in an expected reload; first-live loads, empty reset), workspace:changed (active flag, default camera),
 * workspace:density (the layout spacing), and the intents of other views: workspace:select-node,
 * workspace:focus-frame. The handler of an intent shows its own workspace; an intent that comes
 * before the first flow values waits for them (intents.ts).
 */
import type { ToolsEvents } from "../../config";
import { isReloading } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import { actionsOf } from "./actions";
import { requestIntent } from "./intents";
import { notify } from "./state";
import type { FlowCtx, FlowHooks } from "./types";

/**
 * Loads what a session needs once: layout.json and the style keys (errors → warn).
 *
 * @param ctx - Domain context of flowView.
 * @returns Resolves when both loads settled.
 */
async function loadSession(ctx: FlowCtx): Promise<void> {
  const actions = actionsOf(ctx);
  const loads: [string, Promise<void>][] = [
    ["layout.json", actions.layout.loadPins()],
    ["style keys", actions.inspector.readStyleKeys()]
  ];
  for (const [what, load] of loads) {
    try {
      await load;
    } catch (error) {
      ctx.log.warn("flowView: load failed", { what, message: String(error) });
    }
  }
}

/**
 * link:status — stores the status; silent/lost mark the data stale (M13), except the `lost` of an
 * expected reload (U9: the graph stays as it is); live/paused clear it and, first in a session, load
 * the session files (the same pins lay out nothing again, B9); empty clears the selection, closes the menu (M4) and
 * drops an intent still waiting for the flow values.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onLinkStatus(ctx: FlowCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status, session }) => {
    const { data } = ctx.state;
    data.status = status;
    if (session !== undefined) data.session = session;

    switch (status.kind) {
      case "silent":
      case "lost": {
        if (isReloading(status)) break;
        data.stale = true;
        data.staleFrame = status.lastFrame;

        break;
      }
      case "live":
      case "paused": {
        data.stale = false;
        data.staleFrame = undefined;
        if (data.loaded?.session !== data.session || data.loaded === undefined) {
          data.loaded = { session: data.session };
          loadSession(ctx).catch(() => {});
        }

        break;
      }
      case "empty": {
        const actions = actionsOf(ctx);
        actions.focus.leave();
        actions.focus.closeMenu();
        data.pending = undefined;

        break;
      }
      // No default
    }
    notify(ctx.state);
  };
}

/**
 * workspace:changed — Flow active applies the default camera once per root (M11); leaving Flow
 * closes the context menu and cancels a camera tween.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onWorkspaceChanged(
  ctx: FlowCtx
): (payload: ToolsEvents["workspace:changed"]) => void {
  return ({ ws }) => {
    const actions = actionsOf(ctx);
    ctx.state.view.active = ws === "flow";
    if (ctx.state.view.active) {
      actions.camera.applyDefault();
    } else {
      actions.focus.closeMenu();
      actions.camera.cancel();
    }
    notify(ctx.state);
  };
}

/**
 * workspace:select-node — shows Flow, then selects the node (a collapsed parent expands first);
 * an unknown id warns. Before the first graph the selection waits for it.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onSelectNode(
  ctx: FlowCtx
): (payload: ToolsEvents["workspace:select-node"]) => void {
  return ({ id }) => {
    ctx.require(workspacePlugin).show("flow");
    requestIntent(ctx, { kind: "select", id });
  };
}

/**
 * workspace:focus-frame — shows Flow, then focuses the edge taken at the frame (with its toasts).
 * Before the first history the focus waits for it.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onFocusFrame(
  ctx: FlowCtx
): (payload: ToolsEvents["workspace:focus-frame"]) => void {
  return ({ frame }) => {
    ctx.require(workspacePlugin).show("flow");
    requestIntent(ctx, { kind: "frame", frame });
  };
}

/**
 * workspace:density — the layout spaces by the applied density and lays out again on a change.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onDensity(ctx: FlowCtx): (payload: ToolsEvents["workspace:density"]) => void {
  return ({ density }) => {
    actionsOf(ctx).layout.setDensity(density);
  };
}

/**
 * flowView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of flowView.
 * @returns The five hooks.
 */
export function createHandlers(ctx: FlowCtx): FlowHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:select-node": onSelectNode(ctx),
    "workspace:focus-frame": onFocusFrame(ctx),
    "workspace:density": onDensity(ctx)
  };
}
