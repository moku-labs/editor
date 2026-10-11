/**
 * @file flowView plugin — hooks of the global tools events (R4): link:status (stale marking, none
 * in an expected reload; first-live loads, empty reset), link:project (the inspector follows the
 * project index), workspace:changed (active flag, default camera),
 * workspace:density (the layout spacing), and the intents of other views: workspace:select-node,
 * workspace:focus-frame. The handler of an intent shows its own workspace; an intent that comes
 * before the first flow values waits for them (intents.ts). Also the handler of the editor
 * request `node` the hub relays through link (D-60): it selects at once and answers, or refuses.
 */
import type { ToolsEvents } from "../../config";
import type { LinkStatus, NodeInfo, NodeParams } from "../registry/protocol";
import { errorCode, isReloading, wireError } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import { actionsOf } from "./actions";
import { nodeOf } from "./focus/graph";
import { requestIntent } from "./intents";
import { notify } from "./state";
import type { FlowCtx, FlowHooks, FlowViewState, GraphJson, NodeId } from "./types";

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
 * True when the session files were not loaded for the current session yet: none loaded, or the
 * ones of another session.
 *
 * @param data - The data slice of flowView state.
 * @returns Whether the session needs its files.
 * @example
 * ```ts
 * isNewSession({ session: "s-2", loaded: { session: "s-1" } }); // true
 * isNewSession({ session: "s-1", loaded: { session: "s-1" } }); // false
 * ```
 */
function isNewSession(data: Pick<FlowViewState["data"], "session" | "loaded">): boolean {
  return data.loaded === undefined || data.loaded.session !== data.session;
}

/**
 * Applies one status to flowView: silent/lost mark the data stale (M13), except the `lost` of an
 * expected reload (U9: the graph stays as it is); live/paused clear it and, first in a session,
 * load the session files (the same pins lay out nothing again, B9); empty clears the selection,
 * closes the menu (M4) and drops an intent still waiting for the flow values.
 *
 * @param ctx - Domain context of flowView.
 * @param status - The link status.
 */
function applyStatus(ctx: FlowCtx, status: LinkStatus): void {
  const { data } = ctx.state;
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
      if (isNewSession(data)) {
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
}

/**
 * The link:status hook: stores the status and its session, applies it (`applyStatus`) and
 * re-renders.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onLinkStatus(ctx: FlowCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status, session }) => {
    const { data } = ctx.state;
    data.status = status;
    if (session !== undefined) data.session = session;
    applyStatus(ctx, status);
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
 * link:project — the inspector follows an agent's edits and moves (D-46): the Code tab reads its
 * node again, the Styles group the text styles, the Info tab re-renders with the indexed file.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 */
export function onProject(ctx: FlowCtx): (payload: ToolsEvents["link:project"]) => void {
  return change => {
    actionsOf(ctx).inspector.followProject(change);
  };
}

/**
 * Selects the node of a `node` request. A node of the graph that the entered sub-flow does not
 * show is tried once more from the root: the canvas goes up as by the first breadcrumb segment
 * (`flows.up(0)`). An id of no node is refused where the canvas is.
 *
 * @param ctx - Domain context of flowView.
 * @param graph - The graph.
 * @param id - The asked node id.
 * @returns Whether the node is selected now.
 */
function selectNode(ctx: FlowCtx, graph: GraphJson, id: NodeId): boolean {
  const { focus, flows } = actionsOf(ctx);
  if (focus.select(id)) return true;

  const entered = ctx.state.layout.enter.length > 0;
  if (!entered || nodeOf(graph, id) === undefined) return false;
  flows.up(0);
  return focus.select(id);
}

/**
 * The editor request `node` (MCP `moku_select { node }`, D-60), given to `link.handle`: selects
 * the node as `focus.select` does (a collapsed parent expands first; a node outside an entered
 * sub-flow takes the canvas back to the root first) and answers the item key the Flow view
 * focused. It does not show Flow: the caller asks `editor.show` first. Nothing waits for the
 * graph, unlike the workspace:select-node intent: the caller needs the answer now. A select made
 * before the default camera was applied (the canvas not measured yet, or a new root) is framed by
 * that camera instead of the current node, as for an intent.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler. It throws -32003 `no_graph` (retryable) before the first graph, and -32602
 *   `invalid_input` on the field `id` for a node the Flow view cannot select; the selection stays.
 */
export function answerNode(ctx: FlowCtx): (params: NodeParams) => NodeInfo {
  return ({ id }) => {
    const { graph } = ctx.state.data;
    if (graph === undefined) {
      throw wireError(errorCode.noSession, "the Flow view has no graph yet", {
        reason: "no_graph",
        retryable: true
      });
    }

    if (!selectNode(ctx, graph, id)) {
      throw wireError(errorCode.invalidInput, `unknown node ${id}`, {
        reason: "invalid_input",
        retryable: false,
        field: "id"
      });
    }
    if (!ctx.state.camera.initialised) ctx.state.camera.frameSelection = true;
    return { id, selected: actionsOf(ctx).focus.selected() ?? id };
  };
}

/**
 * flowView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of flowView.
 * @returns The six hooks.
 */
export function createHandlers(ctx: FlowCtx): FlowHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "link:project": onProject(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:select-node": onSelectNode(ctx),
    "workspace:focus-frame": onFocusFrame(ctx),
    "workspace:density": onDensity(ctx)
  };
}
