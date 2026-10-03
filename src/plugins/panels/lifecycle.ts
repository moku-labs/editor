/**
 * @file panels plugin — onStart (mount the active workspace, palette items, manifest recheck) and
 * onStop (unmount every panel, run cleanup).
 */
import { linkPlugin } from "../link";
import { workspacePlugin } from "../workspace";
import { mountWorkspace, paletteItemOf, unmountRecord } from "./api";
import type { PanelsCtx, PanelsState } from "./types";

/**
 * onStart: takes the link status, mounts the active workspace into its host (attached by the
 * shell once the tools page entry calls `workspace.mount`, R3), adds one palette item per panel,
 * subscribes onManifest → recheck on every mounted panel, sets started. Removers go to cleanup.
 *
 * @param ctx - Domain context of panels.
 */
export function startPanels(ctx: PanelsCtx): void {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const workspace = ctx.require(workspacePlugin);

  state.status = link.status();
  const active = workspace.active();
  mountWorkspace(ctx, active, workspace.host(active));

  if (state.panels.length > 0) {
    state.cleanup.push(workspace.palette.add(state.panels.map(spec => paletteItemOf(ctx, spec))));
  }
  state.cleanup.push(
    link.onManifest(manifest => {
      for (const record of state.mounted.values()) {
        for (const panel of record.panels.values()) panel.recheck(manifest);
      }
    })
  );
  state.started = true;
}

/**
 * onStop: unmounts every mounted panel (every unwatch runs), runs cleanup, clears mounted.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopPanels(ctx: { readonly state: PanelsState }): void {
  const { state } = ctx;

  for (const record of state.mounted.values()) unmountRecord(record);
  state.mounted.clear();
  for (const remove of state.cleanup) remove();
  state.cleanup = [];
  state.started = false;
}
