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
import { createNotesApi } from "./notes/api";
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
 * @example
 * ```ts
 * servicesOf(ctx, () => actionsOf(ctx)).toast("Layout saved", ".moku/editor/layout.json");
 * ```
 */
export function servicesOf(ctx: FlowCtx, actions: () => FlowActions): FlowServices {
  return {
    /**
     * link.files.
     *
     * @returns The files client.
     * @example
     * ```ts
     * await services.files().read("nodes/merge.ts");
     * ```
     */
    files: () => ctx.require(linkPlugin).files,

    /**
     * workspace.toast.
     *
     * @param message - The message.
     * @param file - The file it names.
     * @example
     * ```ts
     * services.toast("Saved", "nodes/merge.ts");
     * ```
     */
    toast: (message, file) => {
      const workspace = ctx.require(workspacePlugin);
      if (file === undefined) workspace.toast(message);
      else workspace.toast(message, file);
    },

    /**
     * panels.run (R9).
     *
     * @param id - Command id.
     * @param input - Command input.
     * @returns The run result.
     * @example
     * ```ts
     * await services.run("game.step", { frames: 1 });
     * ```
     */
    run: (id, input) => ctx.require(panelsPlugin).run(id, input),

    /**
     * link.status.
     *
     * @returns The link status.
     * @example
     * ```ts
     * services.status().kind; // "paused"
     * ```
     */
    status: () => ctx.require(linkPlugin).status(),

    /**
     * link.read.
     *
     * @param id - Source id.
     * @returns The value.
     * @example
     * ```ts
     * await services.read("game.ui");
     * ```
     */
    read: id => ctx.require(linkPlugin).read(id),

    /**
     * link.boot.
     *
     * @returns The tools boot, or undefined.
     * @example
     * ```ts
     * services.boot()?.root;
     * ```
     */
    boot: () => ctx.require(linkPlugin).boot(),

    /**
     * workspace.show("flow").
     *
     * @example
     * ```ts
     * services.show();
     * ```
     */
    show: () => {
      ctx.require(workspacePlugin).show("flow");
    },

    /**
     * Whether Flow is the shown workspace.
     *
     * @returns True while workspace.active() is "flow".
     * @example
     * ```ts
     * services.active(); // true
     * ```
     */
    active: () => ctx.require(workspacePlugin).active() === "flow",

    /**
     * workspace.gameFrame().reload({ restore: true }).
     *
     * @returns The reload result.
     * @example
     * ```ts
     * (await services.reload()).restored; // true
     * ```
     */
    reload: () => ctx.require(workspacePlugin).gameFrame().reload({ restore: true }),

    /**
     * workspace.preview("flow").
     *
     * @returns The preview state.
     * @example
     * ```ts
     * services.preview().visible;
     * ```
     */
    preview: () => ctx.require(workspacePlugin).preview("flow"),

    /**
     * Emits workspace:open-file (R4).
     *
     * @param path - The file.
     * @param line - The line.
     * @example
     * ```ts
     * services.openFile("nodes/merge.ts", 3);
     * ```
     */
    openFile: (path, line) => {
      ctx.emit("workspace:open-file", line === undefined ? { path } : { path, line });
    },

    /**
     * Replaces the palette group Styles.
     *
     * @param keys - The text-style keys.
     * @example
     * ```ts
     * services.setStyleItems(["ui.number"]);
     * ```
     */
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
 * @example
 * ```ts
 * actionsOf(ctx).focus.select("board/merge");
 * ```
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
   * @example
   * ```ts
   * env.actions().camera.fitAll();
   * ```
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
    notes: createNotesApi(ctx, env),
    inspector: createInspectorApi(ctx, env)
  };
  holder.actions = actions;
  built.set(ctx.state, actions);
  return actions;
}
