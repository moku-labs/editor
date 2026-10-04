/**
 * @file flowView plugin — the actions of every module, built once per state, and the services
 * they use: thin closures over `ctx.require(linkPlugin | workspacePlugin | panelsPlugin)` and
 * `ctx.emit`. Modules reach each other only through `env.actions()` (spec/15 §2.5).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createCameraApi } from "./camera/api";
import { createFocusApi } from "./focus/api";
import { createInspectorApi } from "./inspector/api";
import { createFlowsApi, createLayoutApi } from "./layout/api";
import { setStyleItems } from "./palette";
import type { FlowActions, FlowCtx, FlowEnvironment, FlowServices, FlowViewState } from "./types";

/**
 * Actions by state: one set per plugin instance.
 */
const built = new WeakMap<FlowViewState, FlowActions>();

/**
 * The services of flowView over its three dependencies.
 *
 * @param ctx - Domain context of flowView.
 * @param actions - The late-bound actions (for the palette items).
 * @returns The services.
 */
export function servicesOf(ctx: FlowCtx, actions: () => FlowActions): FlowServices {
  return {
    files: () => ctx.require(linkPlugin).files,
    toast: (message, file) => {
      const workspace = ctx.require(workspacePlugin);
      if (file === undefined) workspace.toast(message);
      else workspace.toast(message, file);
    },
    run: (id, input) => ctx.require(panelsPlugin).run(id, input),
    status: () => ctx.require(linkPlugin).status(),
    boot: () => ctx.require(linkPlugin).boot(),
    show: () => {
      ctx.require(workspacePlugin).show("flow");
    },
    active: () => ctx.require(workspacePlugin).active() === "flow",
    reload: () => ctx.require(workspacePlugin).gameFrame().reload({ restore: true }),
    preview: () => ctx.require(workspacePlugin).preview("flow"),
    openFile: (path, line) => {
      ctx.emit("workspace:open-file", line === undefined ? { path } : { path, line });
    },
    setStyleItems: keys => {
      setStyleItems(ctx, actions(), keys);
    }
  };
}

/**
 * The actions of flowView for a context, built once per state.
 *
 * @param ctx - Domain context of flowView.
 * @returns The actions.
 */
export function actionsOf(ctx: FlowCtx): FlowActions {
  const existing = built.get(ctx.state);
  if (existing !== undefined) return existing;

  const holder: { actions: FlowActions | undefined } = { actions: undefined };
  /**
   * The actions once built (modules call it from inside an action, never while being built).
   *
   * @returns The actions.
   * @throws {Error} When called while the actions are being built.
   */
  const late = (): FlowActions => {
    if (holder.actions === undefined) {
      throw new Error(
        "[moku-editor] flowView actions are not ready.\n  Call env.actions() from inside an action, not while the actions are built."
      );
    }
    return holder.actions;
  };
  const env: FlowEnvironment = { ...servicesOf(ctx, late), actions: late };
  const actions: FlowActions = {
    camera: createCameraApi(ctx, env),
    focus: createFocusApi(ctx, env),
    flows: createFlowsApi(ctx, env),
    layout: createLayoutApi(ctx, env),
    inspector: createInspectorApi(ctx, env)
  };
  holder.actions = actions;
  built.set(ctx.state, actions);
  return actions;
}
