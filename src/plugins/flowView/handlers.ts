/**
 * @file flowView plugin — hooks of the global tools events (R4): link:status (stale marking,
 * first-live loads, empty reset), workspace:changed (active flag, default camera), and the intents
 * of other views: workspace:select-node, workspace:focus-frame, workspace:new-note. The handler of
 * an intent shows its own workspace.
 */
import type { ToolsEvents } from "../../config";
import { workspacePlugin } from "../workspace";
import { actionsOf } from "./actions";
import { notify } from "./state";
import type { FlowCtx, FlowHooks } from "./types";

/**
 * Loads what a session needs once: layout.json, the notes and the style keys (errors → warn).
 *
 * @param ctx - Domain context of flowView.
 * @returns Resolves when the three loads settled.
 * @example
 * ```ts
 * await loadSession(ctx);
 * ```
 */
async function loadSession(ctx: FlowCtx): Promise<void> {
  const actions = actionsOf(ctx);
  const loads: [string, Promise<void>][] = [
    ["layout.json", actions.layout.loadPins()],
    ["notes", actions.notes.load()],
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
 * link:status — stores the status; silent/lost mark the data stale (M13); live/paused clear it and,
 * first in a session, load the session files; empty clears the selection and closes the strip, the
 * menu and the note editor (M4).
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "silent", since: 1_790_000_000_000, lastFrame: 1840 } });
 * ```
 */
export function onLinkStatus(ctx: FlowCtx): (payload: ToolsEvents["link:status"]) => void {
  return ({ status, session }) => {
    const { data } = ctx.state;
    data.status = status;
    if (session !== undefined) data.session = session;

    switch (status.kind) {
      case "silent":
      case "lost": {
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
        actions.notes.close();

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
 * @example
 * ```ts
 * onWorkspaceChanged(ctx)({ ws: "flow" });
 * ```
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
 * an unknown id warns.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 * @example
 * ```ts
 * onSelectNode(ctx)({ id: "board/merge" });
 * ```
 */
export function onSelectNode(
  ctx: FlowCtx
): (payload: ToolsEvents["workspace:select-node"]) => void {
  return ({ id }) => {
    ctx.require(workspacePlugin).show("flow");
    if (!actionsOf(ctx).focus.select(id)) ctx.log.warn("flowView:unknown-node", { id });
  };
}

/**
 * workspace:focus-frame — shows Flow, then focuses the edge taken at the frame (with its toasts).
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 * @example
 * ```ts
 * onFocusFrame(ctx)({ frame: 1778 });
 * ```
 */
export function onFocusFrame(
  ctx: FlowCtx
): (payload: ToolsEvents["workspace:focus-frame"]) => void {
  return ({ frame }) => {
    ctx.require(workspacePlugin).show("flow");
    actionsOf(ctx).focus.focusFrame(frame);
  };
}

/**
 * workspace:new-note — shows Flow, then opens the note editor (D5) with the captures and the
 * origin node.
 *
 * @param ctx - Domain context of flowView.
 * @returns The handler.
 * @example
 * ```ts
 * onNewNote(ctx)({ captures: [".moku/captures/2026-09-24-1012-board.png"] });
 * ```
 */
export function onNewNote(ctx: FlowCtx): (payload: ToolsEvents["workspace:new-note"]) => void {
  return ({ captures, from }) => {
    ctx.require(workspacePlugin).show("flow");
    actionsOf(ctx).notes.edit({
      ...(captures === undefined ? {} : { captures: [...captures] }),
      ...(from === undefined ? {} : { from: { ...from } })
    });
  };
}

/**
 * flowView's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of flowView.
 * @returns The five hooks.
 * @example
 * ```ts
 * createHandlers(ctx)["workspace:select-node"]({ id: "board/merge" });
 * ```
 */
export function createHandlers(ctx: FlowCtx): FlowHooks {
  return {
    "link:status": onLinkStatus(ctx),
    "workspace:changed": onWorkspaceChanged(ctx),
    "workspace:select-node": onSelectNode(ctx),
    "workspace:focus-frame": onFocusFrame(ctx),
    "workspace:new-note": onNewNote(ctx)
  };
}
