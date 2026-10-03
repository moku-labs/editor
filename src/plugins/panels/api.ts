/**
 * @file panels plugin — api factory (register, run, list, mountInto) and the host helpers the
 * hooks and the lifecycle share: the mount deps, mounting a workspace, the palette item of a
 * panel.
 */
import { linkPlugin } from "../link";
import type { Json, RunResult } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import type { PaletteItem, WorkspaceId } from "../workspace/types";
import { WORKSPACE_LABELS } from "../workspace/workspaces";
import { type MountDeps, mountPanel, runFromPanel, scheduleFrame } from "./mount";
import type { MountedWorkspace, PanelRunOrigin, PanelSpec, PanelsApi, PanelsCtx } from "./types";

/**
 * The deps of a mount: link and workspace through require, the stored status, the frame
 * scheduler.
 *
 * @param ctx - Domain context of panels.
 * @returns The deps.
 */
export function depsOf(ctx: PanelsCtx): MountDeps {
  return {
    link: ctx.require(linkPlugin),
    workspace: ctx.require(workspacePlugin),
    log: ctx.log,
    emit: ctx.emit,
    status: ctx.state.status,
    schedule: scheduleFrame
  };
}

/**
 * Unmounts every panel of a mounted workspace (every unwatch runs).
 *
 * @param record - The mounted workspace.
 */
export function unmountRecord(record: MountedWorkspace): void {
  for (const panel of record.panels.values()) panel.unmount();
  record.panels.clear();
}

/**
 * The unmount function of one mount; a no-op once the workspace was unmounted or moved.
 *
 * @param ctx - Domain context of panels.
 * @param ws - The workspace.
 * @param record - The mount it belongs to.
 * @returns Unmount.
 */
function unmountOf(ctx: PanelsCtx, ws: WorkspaceId, record: MountedWorkspace): () => void {
  return () => {
    if (ctx.state.mounted.get(ws) !== record) return;
    unmountRecord(record);
    ctx.state.mounted.delete(ws);
  };
}

/**
 * Mounts every panel of a workspace into an element, in registration order. Idempotent for the
 * same element; another element moves the mount (unmount, then mount).
 *
 * @param ctx - Domain context of panels.
 * @param ws - The workspace.
 * @param element - Its host.
 * @returns The unmount function.
 */
export function mountWorkspace(ctx: PanelsCtx, ws: WorkspaceId, element: HTMLElement): () => void {
  const { mounted } = ctx.state;
  const existing = mounted.get(ws);
  if (existing?.element === element) return unmountOf(ctx, ws, existing);
  if (existing !== undefined) {
    unmountRecord(existing);
    mounted.delete(ws);
  }

  const deps = depsOf(ctx);
  const record: MountedWorkspace = { element, panels: new Map() };
  for (const spec of ctx.state.panels) {
    if (spec.workspace === ws) record.panels.set(spec.id, mountPanel(spec, element, deps));
  }
  mounted.set(ws, record);
  return unmountOf(ctx, ws, record);
}

/**
 * The palette item of a panel: group Panels, label = title, hint = workspace title; running it
 * shows the workspace, then focuses the panel's section.
 *
 * @param ctx - Domain context of panels.
 * @param spec - The panel.
 * @returns The item.
 */
export function paletteItemOf(ctx: PanelsCtx, spec: PanelSpec): PaletteItem {
  return {
    id: `panel:${spec.id}`,
    group: "Panels",
    label: spec.title,
    hint: WORKSPACE_LABELS[spec.workspace],
    // Shows the panel's workspace (which mounts it on first show) and focuses its section.
    run: () => {
      ctx.require(workspacePlugin).show(spec.workspace);
      ctx.state.mounted.get(spec.workspace)?.panels.get(spec.id)?.section.focus();
    }
  };
}

/**
 * Registers a panel; after start it mounts into an already mounted workspace and gets its
 * palette item.
 *
 * @param ctx - Domain context of panels.
 * @param panel - A PanelSpec from definePanel.
 * @throws {Error} `[moku-editor] Panel "<id>" is already registered.`
 */
function registerPanel(ctx: PanelsCtx, panel: PanelSpec): void {
  const { state } = ctx;
  if (state.ids.has(panel.id)) {
    throw new Error(
      `[moku-editor] Panel "${panel.id}" is already registered.\n  Give every panel its own id.`
    );
  }
  state.ids.add(panel.id);
  state.panels.push(panel);
  if (!state.started) return;

  const record = state.mounted.get(panel.workspace);
  if (record !== undefined) {
    record.panels.set(panel.id, mountPanel(panel, record.element, depsOf(ctx)));
  }
  state.cleanup.push(ctx.require(workspacePlugin).palette.add(paletteItemOf(ctx, panel)));
}

/**
 * Creates the panels api. The contract of each member is on `PanelsApi` in `types.ts`.
 *
 * @param ctx - Domain context of panels.
 * @returns The PanelsApi (`app.panels`, `ctx.require(panelsPlugin)`).
 */
export function createPanelsApi(ctx: PanelsCtx): PanelsApi {
  return {
    register: panel => {
      registerPanel(ctx, panel);
    },

    run: (id: string, input?: Json, origin?: PanelRunOrigin): Promise<RunResult> =>
      runFromPanel({ link: ctx.require(linkPlugin), emit: ctx.emit }, id, input, origin ?? "panel"),

    list: () => [...ctx.state.panels],

    mountInto: (ws, element) => mountWorkspace(ctx, ws, element)
  };
}
